import type { ErrorCode } from './protocol.js';

export class WizardError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = 'WizardError';
        this.code = code;
    }
}
