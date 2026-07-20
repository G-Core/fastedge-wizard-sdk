import {
    WIZARD_PROTOCOL_VERSION,
    HANDSHAKE_TIMEOUT_MS,
    INTENT_TIMEOUT_MS,
    type HelloMessage,
    type ReadyMessage,
    type IntentMessage,
    type ResultMessage,
    type EventMessage,
} from './protocol.js';
import { WizardError } from './errors.js';
import { SDK_VERSION } from './version.js';
import type {
    WizardContext,
    TemplateSummary,
    TemplateDetail,
    TemplatesListParams,
    AppSummary,
    AppDetail,
    AppCreateParams,
    AppCreateResult,
    AppUpdateParams,
    AppUpdateResult,
    AppLinkParams,
    AppLinkResult,
    SecretSummary,
    SecretCreateParams,
    SecretRef,
    DeploymentPlanParams,
    DeploymentPlan,
    DeploymentApplyResult,
} from './types.js';

export { SDK_VERSION };

function applyTheme(theme: 'light' | 'dark'): void {
    if (typeof document === 'undefined') return;
    document.body.classList.remove('gc-theme-light', 'gc-theme-dark');
    document.body.classList.add(`gc-theme-${theme}`);
}

// Client-side intent timeout is slightly longer than the host's INTENT_TIMEOUT_MS
// (doc 06) so the host's own timeout error always wins the race.
const CLIENT_INTENT_TIMEOUT_MS = INTENT_TIMEOUT_MS + 30_000;

export interface WizardSdkOptions {
    /** Exact origin of the FastEdge portal that is allowed to host this wizard.
     *  The SDK rejects INIT from any other origin (doc 05, guest step 2). Required. */
    expectedHostOrigin: string;
    /** Optional: override handshake timeout (default from doc 05). */
    handshakeTimeoutMs?: number;
}

export interface WizardSession {
    context: { get(): Promise<WizardContext> };

    fastedge: {
        templates: {
            list(params?: TemplatesListParams): Promise<TemplateSummary[]>;
            read(params: { id: number }): Promise<TemplateDetail>;
        };
        apps: {
            list(): Promise<AppSummary[]>;
            get(params: { id: number }): Promise<AppDetail>;
            create(params: AppCreateParams): Promise<AppCreateResult>;
            update(params: AppUpdateParams): Promise<AppUpdateResult>;
            link(params: AppLinkParams): Promise<AppLinkResult>;
        };
        secrets: {
            list(): Promise<SecretSummary[]>;
            create(params: SecretCreateParams): Promise<SecretRef>;
            /** Opens the host's secret picker so the user chooses existing secret(s); only the
             *  selected { id, name } refs cross the bridge (the guest never enumerates the account). */
            pick(): Promise<SecretRef[]>;
        };
    };

    deployment: {
        plan(params: DeploymentPlanParams): Promise<DeploymentPlan>;
        apply(params: { planId: string }): Promise<DeploymentApplyResult>;
    };

    /** Subscribe to host-pushed events (doc 05 EventMessage). Returns an unsubscribe fn. */
    on(event: string, handler: (payload: unknown) => void): () => void;

    /** Close the port and detach listeners. */
    dispose(): void;
}

interface PendingIntent {
    resolve: (data: unknown) => void;
    reject: (err: WizardError) => void;
    timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// Exported for use by the parity test — not part of the public index API.
export class WizardSessionImpl implements WizardSession {
    readonly context: WizardSession['context'];
    readonly fastedge: WizardSession['fastedge'];
    readonly deployment: WizardSession['deployment'];

    private readonly port: MessagePort;
    private readonly pending = new Map<string, PendingIntent>();
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    private nextId = 0;
    private disposed = false;

    constructor(port: MessagePort) {
        this.port = port;

        this.context = { get: () => this.invoke<WizardContext>('context.get', {}) };
        this.fastedge = {
            templates: {
                list: (params) => this.invoke<TemplateSummary[]>('fastedge.templates.list', params ?? {}),
                read: (params) => this.invoke<TemplateDetail>('fastedge.templates.read', params),
            },
            apps: {
                list: () => this.invoke<AppSummary[]>('fastedge.apps.list', {}),
                get: (params) => this.invoke<AppDetail>('fastedge.apps.get', params),
                create: (params) => this.invoke<AppCreateResult>('fastedge.apps.create', params),
                update: (params) => this.invoke<AppUpdateResult>('fastedge.apps.update', params),
                link: (params) => this.invoke<AppLinkResult>('fastedge.apps.link', params),
            },
            secrets: {
                list: () => this.invoke<SecretSummary[]>('fastedge.secrets.list', {}),
                create: (params) => this.invoke<SecretRef>('fastedge.secrets.create', params),
                pick: () => this.invoke<SecretRef[]>('fastedge.secrets.pick', {}),
            },
        };
        this.deployment = {
            plan: (params) => this.invoke<DeploymentPlan>('deployment.plan', params),
            apply: (params) => this.invoke<DeploymentApplyResult>('deployment.apply', params),
        };

        this.port.onmessage = (event) => this.handlePortMessage(event);

        // Auto-apply theme on live toggle — no wizard code needed.
        this.on('theme.changed', (p) => {
            const payload = p as { theme: 'light' | 'dark' };
            applyTheme(payload.theme);
        });
    }

    private handlePortMessage(event: MessageEvent): void {
        const data = event.data;
        if (!isRecord(data) || data['v'] !== WIZARD_PROTOCOL_VERSION) return;

        if (data['type'] === 'result') {
            this.handleResult(data as unknown as ResultMessage);
        } else if (data['type'] === 'event') {
            this.handleEvent(data as unknown as EventMessage);
        }
        // Anything else (init/hello/ready) is not expected post-handshake — ignore.
    }

    private handleResult(msg: ResultMessage): void {
        const pending = this.pending.get(msg.id);
        if (!pending) return; // unknown id, or a second result for an already-settled id — drop
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.ok) {
            pending.resolve(msg.data);
        } else {
            const err = msg.error ?? { code: 'upstream_error' as const, message: 'Unknown error' };
            pending.reject(new WizardError(err.code, err.message));
        }
    }

    private handleEvent(msg: EventMessage): void {
        const handlers = this.eventHandlers.get(msg.event);
        if (!handlers) return;
        for (const handler of handlers) handler(msg.payload);
    }

    private invoke<T>(intent: string, params: unknown): Promise<T> {
        if (this.disposed) {
            return Promise.reject(new WizardError('protocol_error', 'Session is disposed'));
        }

        const id = `req-${this.nextId++}`;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new WizardError('timeout', `Intent "${intent}" timed out`));
            }, CLIENT_INTENT_TIMEOUT_MS);

            this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer });

            const message: IntentMessage = { v: WIZARD_PROTOCOL_VERSION, type: 'intent', id, intent, params };
            this.port.postMessage(message);
        });
    }

    on(event: string, handler: (payload: unknown) => void): () => void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler);
        return () => handlers?.delete(handler);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new WizardError('protocol_error', 'Session disposed'));
        }
        this.pending.clear();
        this.eventHandlers.clear();

        this.port.onmessage = null;
        this.port.close();
    }
}

/** Perform the handshake (doc 05, guest side) and resolve once READY is sent. */
export function connect(options: WizardSdkOptions): Promise<WizardSession> {
    if (typeof window === 'undefined') {
        return Promise.reject(new WizardError('protocol_error', 'connect() requires a browser environment'));
    }

    const { expectedHostOrigin, handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS } = options;

    return new Promise<WizardSession>((resolve, reject) => {
        let settled = false;
        let port: MessagePort | undefined;

        const timeoutTimer = setTimeout(() => {
            finish(() => reject(new WizardError('timeout', 'Handshake did not complete in time')));
        }, handshakeTimeoutMs);

        function finish(fn: () => void): void {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutTimer);
            window.removeEventListener('message', onWindowMessage);
            fn();
        }

        function onWindowMessage(event: MessageEvent): void {
            if (settled) return;
            // Only the parent frame may deliver the capability — never a sibling frame.
            if (event.source !== window.parent) return;
            // The host is not sandboxed, so it has a real, checkable origin (doc 05).
            if (event.origin !== expectedHostOrigin) return;

            const data = event.data;
            if (!isRecord(data) || data['type'] !== 'init') return;

            if (data['v'] !== WIZARD_PROTOCOL_VERSION) {
                finish(() =>
                    reject(
                        new WizardError(
                            'protocol_error',
                            `Protocol version mismatch: host=${String(data['v'])}, sdk=${WIZARD_PROTOCOL_VERSION}`,
                        ),
                    ),
                );
                return;
            }

            const capturedPort = event.ports.length === 1 ? event.ports[0] : undefined;
            if (!capturedPort) return;

            port = capturedPort;
            capturedPort.onmessage = onPortMessage;
            capturedPort.start();
        }

        function onPortMessage(event: MessageEvent): void {
            if (settled) return;

            const data = event.data;
            if (!isRecord(data) || data['type'] !== 'hello') return;

            if (data['v'] !== WIZARD_PROTOCOL_VERSION) {
                finish(() =>
                    reject(
                        new WizardError(
                            'protocol_error',
                            `Protocol version mismatch: host=${String(data['v'])}, sdk=${WIZARD_PROTOCOL_VERSION}`,
                        ),
                    ),
                );
                return;
            }

            const hello = data as unknown as HelloMessage;
            applyTheme(hello.hostContext.theme ?? 'light');
            if (typeof document !== 'undefined') {
                document.documentElement.lang = hello.hostContext.locale ?? 'en';
            }

            const ready: ReadyMessage = { v: WIZARD_PROTOCOL_VERSION, type: 'ready', sdkVersion: SDK_VERSION };
            port!.postMessage(ready);

            finish(() => resolve(new WizardSessionImpl(port!)));
        }

        window.addEventListener('message', onWindowMessage);
    });
}
