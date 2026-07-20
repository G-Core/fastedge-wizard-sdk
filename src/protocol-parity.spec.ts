/**
 * Walks a fake WizardSessionImpl to verify the SDK exposes a method for
 * every entry in INTENT_NAMES, so a newly-listed intent can't be left unwired.
 *
 * Note: host ↔ SDK constants parity (WIZARD_PROTOCOL_VERSION, INTENT_NAMES,
 * etc.) is tested in the monorepo where both sides are present.
 */
import { describe, it, expect } from 'vitest';

import * as sdk from './protocol';
import { WizardSessionImpl } from './sdk';

// ---------------------------------------------------------------------------
// SDK session exposes a method for every INTENT_NAMES entry
//
// Creates a minimal fake port so WizardSessionImpl can be instantiated without
// a handshake. Checks that every dot-path in INTENT_NAMES resolves to a
// function on the session object — so listing a new intent without wiring it
// causes this test to fail, not Phase 4 runtime behaviour.
// ---------------------------------------------------------------------------

describe('SDK session method coverage', () => {
    function createFakePort() {
        return {
            onmessage: null as ((event: { data: unknown }) => void) | null,
            postMessage: () => {},
            close: () => {},
            start: () => {},
        } as unknown as MessagePort;
    }

    it('session has a callable method for every INTENT_NAMES entry', () => {
        const session = new WizardSessionImpl(createFakePort());

        for (const intentName of sdk.INTENT_NAMES) {
            const parts = intentName.split('.');
            const obj = session as unknown as Record<string, unknown>;

            if (parts.length === 3) {
                // e.g. fastedge.templates.list → session.fastedge.templates.list
                const [ns, subgroup, method] = parts;
                const nsObj = obj[ns] as Record<string, unknown>;
                expect(nsObj, `namespace "${ns}" missing on session (intent: "${intentName}")`).toBeTruthy();
                const subObj = nsObj[subgroup] as Record<string, unknown>;
                expect(
                    subObj,
                    `subgroup "${ns}.${subgroup}" missing on session (intent: "${intentName}")`,
                ).toBeTruthy();
                expect(typeof subObj[method], `method "${intentName}" is not a function on session`).toBe('function');
            } else {
                // e.g. context.get, deployment.plan → session.context.get
                const [group, method] = parts;
                const groupObj = obj[group] as Record<string, unknown>;
                expect(groupObj, `group "${group}" missing on session (intent: "${intentName}")`).toBeTruthy();
                expect(typeof groupObj[method], `method "${intentName}" is not a function on session`).toBe('function');
            }
        }
    });
});
