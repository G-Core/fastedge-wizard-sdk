/**
 * SDK transport unit tests — fake MessagePort/window, driven by hand.
 * Mirrors the style of wizard-bridge.service.spec.ts on the host side.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { connect, SDK_VERSION } from './sdk';
import { WizardError } from './errors';
import { WIZARD_PROTOCOL_VERSION } from './protocol';

// ---------------------------------------------------------------------------
// Fake port & window helpers
// ---------------------------------------------------------------------------

interface FakePort {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
}

function createFakePort(): FakePort {
    return { onmessage: null, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() };
}

const HOST_ORIGIN = 'https://portal.example.com';

// Distinct symbol acts as the "parent frame" reference for === checks.
const fakeParent = Symbol('fakeParent');

let capturedWindowListener: ((event: unknown) => void) | null = null;
let windowRemoveListenerCalled = false;

beforeEach(() => {
    vi.useFakeTimers();
    capturedWindowListener = null;
    windowRemoveListenerCalled = false;

    Object.defineProperty(globalThis, 'window', {
        value: {
            addEventListener: (type: string, listener: (event: unknown) => void) => {
                if (type === 'message') capturedWindowListener = listener;
            },
            removeEventListener: (type: string) => {
                if (type === 'message') windowRemoveListenerCalled = true;
            },
            parent: fakeParent,
        },
        writable: true,
        configurable: true,
    });

    const bodyClassList = new Set<string>();
    Object.defineProperty(globalThis, 'document', {
        value: {
            body: {
                classList: {
                    add: (...cls: string[]) => cls.forEach((c) => bodyClassList.add(c)),
                    remove: (...cls: string[]) => cls.forEach((c) => bodyClassList.delete(c)),
                    contains: (c: string) => bodyClassList.has(c),
                    _set: bodyClassList,
                },
            },
            documentElement: { lang: '' },
        },
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    vi.useRealTimers();
    for (const key of ['window', 'document']) {
        try {
            delete (globalThis as Record<string, unknown>)[key];
        } catch {
            /* non-configurable */
        }
    }
});

// ---------------------------------------------------------------------------
// Helpers for driving the handshake from the test side
// ---------------------------------------------------------------------------

function sendWindowInit(
    port: FakePort,
    overrides?: { origin?: string; source?: unknown; v?: number; ports?: FakePort[] },
): void {
    capturedWindowListener?.({
        source: overrides?.source ?? fakeParent,
        origin: overrides?.origin ?? HOST_ORIGIN,
        data: { v: overrides?.v ?? WIZARD_PROTOCOL_VERSION, type: 'init' },
        ports: overrides?.ports ?? [port],
    });
}

function sendPortHello(port: FakePort, overrides?: { theme?: 'light' | 'dark'; locale?: string }): void {
    port.onmessage?.({
        data: {
            v: WIZARD_PROTOCOL_VERSION,
            type: 'hello',
            hostContext: { specVersion: '1', theme: overrides?.theme ?? 'light', locale: overrides?.locale ?? 'en' },
        },
    });
}

async function completeHandshake(): Promise<{ session: Awaited<ReturnType<typeof connect>>; port: FakePort }> {
    const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN });
    const port = createFakePort();
    sendWindowInit(port);
    sendPortHello(port);
    const session = await connectPromise;
    return { session, port };
}

// ---------------------------------------------------------------------------
// connect() — handshake
// ---------------------------------------------------------------------------

describe('connect() — handshake', () => {
    it('resolves with a session after INIT→HELLO→READY', async () => {
        const { session, port } = await completeHandshake();

        expect(session).toBeDefined();
        expect(session.context).toBeDefined();

        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ v: WIZARD_PROTOCOL_VERSION, type: 'ready', sdkVersion: SDK_VERSION }),
        );
        expect(windowRemoveListenerCalled).toBe(true);
    });

    it('rejects INIT from wrong origin (times out)', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN, handshakeTimeoutMs: 100 });
        const port = createFakePort();
        sendWindowInit(port, { origin: 'https://evil.com' }); // ignored — origin mismatch
        vi.advanceTimersByTime(150);
        await expect(connectPromise).rejects.toThrow('Handshake');
    });

    it('rejects INIT from non-parent source (times out)', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN, handshakeTimeoutMs: 100 });
        const port = createFakePort();
        sendWindowInit(port, { source: {} }); // ignored — source is not window.parent
        vi.advanceTimersByTime(150);
        await expect(connectPromise).rejects.toThrow('Handshake');
    });

    it('rejects immediately on INIT v mismatch', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN });
        const port = createFakePort();
        sendWindowInit(port, { v: 99 });
        await expect(connectPromise).rejects.toThrow('Protocol version mismatch');
    });

    it('ignores INIT with wrong port count (times out)', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN, handshakeTimeoutMs: 100 });
        sendWindowInit(createFakePort(), { ports: [] }); // no ports — ignored
        vi.advanceTimersByTime(150);
        await expect(connectPromise).rejects.toThrow('Handshake');
    });

    it('rejects on handshake timeout', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN, handshakeTimeoutMs: 100 });
        vi.advanceTimersByTime(150);
        await expect(connectPromise).rejects.toMatchObject({ code: 'timeout' });
    });

    it('rejects immediately on HELLO v mismatch', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN });
        const port = createFakePort();
        sendWindowInit(port);
        port.onmessage?.({
            data: { v: 99, type: 'hello', hostContext: { specVersion: '1' } },
        });
        await expect(connectPromise).rejects.toThrow('Protocol version mismatch');
    });
});

// ---------------------------------------------------------------------------
// invoke() — result routing
// ---------------------------------------------------------------------------

describe('invoke() — result routing', () => {
    it('resolves with data on ok:true result', async () => {
        const { session, port } = await completeHandshake();

        const intentPromise = session.context.get();

        const sentMessage = port.postMessage.mock.calls.at(-1)?.[0] as { id: string };
        port.onmessage?.({
            data: {
                v: WIZARD_PROTOCOL_VERSION,
                type: 'result',
                id: sentMessage.id,
                ok: true,
                data: { specVersion: '1' },
            },
        });

        const result = await intentPromise;
        expect((result as { specVersion: string }).specVersion).toBe('1');
    });

    it('rejects with WizardError on ok:false result', async () => {
        const { session, port } = await completeHandshake();

        const intentPromise = session.context.get();

        const sentMessage = port.postMessage.mock.calls.at(-1)?.[0] as { id: string };
        port.onmessage?.({
            data: {
                v: WIZARD_PROTOCOL_VERSION,
                type: 'result',
                id: sentMessage.id,
                ok: false,
                error: { code: 'denied', message: 'Not granted' },
            },
        });

        await expect(intentPromise).rejects.toMatchObject({ code: 'denied' });
        await expect(intentPromise).rejects.toBeInstanceOf(WizardError);
    });

    it('drops result for unknown id without throwing', async () => {
        const { port } = await completeHandshake();
        expect(() => {
            port.onmessage?.({
                data: { v: WIZARD_PROTOCOL_VERSION, type: 'result', id: 'req-9999', ok: true, data: {} },
            });
        }).not.toThrow();
    });

    it('ignores a second result for an already-settled id', async () => {
        const { session, port } = await completeHandshake();

        const intentPromise = session.context.get();
        const sentMessage = port.postMessage.mock.calls.at(-1)?.[0] as { id: string };

        port.onmessage?.({
            data: {
                v: WIZARD_PROTOCOL_VERSION,
                type: 'result',
                id: sentMessage.id,
                ok: true,
                data: { specVersion: '1' },
            },
        });
        port.onmessage?.({
            data: {
                v: WIZARD_PROTOCOL_VERSION,
                type: 'result',
                id: sentMessage.id,
                ok: true,
                data: { specVersion: '2' },
            },
        });

        const value = await intentPromise;
        expect((value as { specVersion: string }).specVersion).toBe('1'); // first result wins
    });

    it('rejects with timeout code after CLIENT_INTENT_TIMEOUT_MS', async () => {
        const { session } = await completeHandshake();

        const intentPromise = session.context.get();
        // CLIENT_INTENT_TIMEOUT_MS = INTENT_TIMEOUT_MS (60 000) + 30 000 = 90 000 ms
        vi.advanceTimersByTime(91_000);

        await expect(intentPromise).rejects.toMatchObject({ code: 'timeout' });
    });
});

// ---------------------------------------------------------------------------
// on() — event dispatch
// ---------------------------------------------------------------------------

describe('on() — event dispatch', () => {
    it('dispatches an EventMessage payload to a registered handler', async () => {
        const { session, port } = await completeHandshake();

        const handler = vi.fn();
        session.on('deployment.progress', handler);

        port.onmessage?.({
            data: { v: WIZARD_PROTOCOL_VERSION, type: 'event', event: 'deployment.progress', payload: { step: 1 } },
        });

        expect(handler).toHaveBeenCalledWith({ step: 1 });
    });

    it('the returned unsubscribe fn removes the handler', async () => {
        const { session, port } = await completeHandshake();

        const handler = vi.fn();
        const unsub = session.on('deployment.progress', handler);
        unsub();

        port.onmessage?.({
            data: { v: WIZARD_PROTOCOL_VERSION, type: 'event', event: 'deployment.progress', payload: {} },
        });

        expect(handler).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('dispose()', () => {
    it('closes the port and rejects all pending intents with protocol_error', async () => {
        const { session, port } = await completeHandshake();

        const pendingPromise = session.context.get();
        session.dispose();

        await expect(pendingPromise).rejects.toMatchObject({ code: 'protocol_error' });
        expect(port.close).toHaveBeenCalled();
    });

    it('further invoke() calls reject with protocol_error after dispose', async () => {
        const { session } = await completeHandshake();
        session.dispose();
        await expect(session.context.get()).rejects.toMatchObject({ code: 'protocol_error' });
    });

    it('is idempotent — calling dispose() twice does not throw', async () => {
        const { session } = await completeHandshake();
        session.dispose();
        expect(() => session.dispose()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// theme — body class applied from HELLO
// ---------------------------------------------------------------------------

describe('theme — body class from HELLO', () => {
    it('sets gc-theme-dark on body when HELLO carries theme: dark', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN });
        const port = createFakePort();
        sendWindowInit(port);
        sendPortHello(port, { theme: 'dark' });
        await connectPromise;

        expect((globalThis as Record<string, unknown>)['document']).toBeDefined();
        const classList = ((globalThis as Record<string, unknown>)['document'] as { body: { classList: { _set: Set<string> } } }).body.classList._set;
        expect(classList.has('gc-theme-dark')).toBe(true);
        expect(classList.has('gc-theme-light')).toBe(false);
    });

    it('sets gc-theme-light on body when HELLO carries theme: light', async () => {
        const connectPromise = connect({ expectedHostOrigin: HOST_ORIGIN });
        const port = createFakePort();
        sendWindowInit(port);
        sendPortHello(port, { theme: 'light' });
        await connectPromise;

        const classList = ((globalThis as Record<string, unknown>)['document'] as { body: { classList: { _set: Set<string> } } }).body.classList._set;
        expect(classList.has('gc-theme-light')).toBe(true);
    });

    it('updates body class on theme.changed event', async () => {
        const { port } = await completeHandshake(); // defaults to theme: light

        port.onmessage?.({
            data: { v: WIZARD_PROTOCOL_VERSION, type: 'event', event: 'theme.changed', payload: { theme: 'dark' } },
        });

        const classList = ((globalThis as Record<string, unknown>)['document'] as { body: { classList: { _set: Set<string> } } }).body.classList._set;
        expect(classList.has('gc-theme-dark')).toBe(true);
        expect(classList.has('gc-theme-light')).toBe(false);
    });
});
