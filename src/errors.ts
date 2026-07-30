import type { ErrorCode } from './protocol.js';

export class WizardError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = 'WizardError';
        this.code = code;
    }
}

/**
 * Run a write/picker intent that the user can dismiss, returning `null` on
 * cancel instead of throwing. Every other error still propagates.
 *
 *   const picked = await optional(() => session.fastedge.secrets.pickOrCreate());
 *   if (picked) set({ secret: picked });
 *
 * Without this, every consent/picker call site needs its own try/catch just to
 * tell a genuine failure apart from a dismissed dialog (`user_cancelled`).
 */
export async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof WizardError && err.code === 'user_cancelled') return null;
        throw err;
    }
}
