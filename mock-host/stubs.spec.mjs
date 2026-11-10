/**
 * Mock host Re-entry: ?mode=reentry, deployment.current() from live state, Re-entry plan
 * diffing by Ref (create → update → delete), revision checks and the plan guards.
 */
import { it, vi } from 'vitest';
import assert from 'node:assert/strict';

it('mock host supports Re-entry with a stateful live deployment', async () => {
    const store = new Map();
    vi.stubGlobal('sessionStorage', {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k),
    });
    vi.stubGlobal('navigator', { language: 'en' });
    const run = async (search) => {
        vi.stubGlobal('location', { search });
        vi.resetModules();
        return import('./stubs.js');
    };

    // 1. template mode: create, which records live state
    let m = await run('');
    assert.equal(m.stub('context.get', {}, 'light').launchTemplateId, 1);
    assert.equal(m.stub('deployment.current', {}).__error.code, 'denied');
    m.stub('deployment.plan', { fastedgeApps: [{ ref: 'main', name: 'r', api_type: 'wasi-http', source: { fromTemplateId: 5 }, env: { ROUTER_CONFIG: '{}' } }], sharedEnv: { S: '1' } });
    m.stub('deployment.apply', {});
    // 2. re-entry: current() returns it; update; revision bumps
    m = await run('?mode=reentry');
    assert.equal(m.stub('context.get', {}, 'light').launchTemplateId, null);
    const cur = m.stub('deployment.current', {});
    assert.equal(cur.revision, '1');
    assert.deepEqual(cur.fastedgeApps[0].env, { S: '1', ROUTER_CONFIG: '{}' });
    const edited = structuredClone(cur.fastedgeApps); edited[0].env.ROUTER_CONFIG = '{"a":1}';
    let plan = m.stub('deployment.plan', { fastedgeApps: edited, revision: '1' });
    assert.deepEqual(plan.steps.map((s) => s.action), ['fastedge.apps.update']);
    m.stub('deployment.apply', {});
    const after = m.stub('deployment.current', {});
    assert.equal(after.revision, '2');
    assert.equal(after.fastedgeApps[0].env.ROUTER_CONFIG, '{"a":1}');
    // 3. guards
    assert.equal(m.stub('deployment.plan', { fastedgeApps: edited, revision: '1' }).__error.code, 'conflict'); // stale
    assert.equal(m.stub('deployment.plan', { fastedgeApps: [], revision: '2' }).__error.code, 'conflict');     // missing app
    assert.equal(m.stub('deployment.plan', { fastedgeApps: [], remove: { fastedgeApps: ['main'] }, revision: '2' }).__error.code, 'invalid_params'); // anchor
    const renamed = structuredClone(after.fastedgeApps); renamed[0].name = 'x';
    assert.equal(m.stub('deployment.plan', { fastedgeApps: renamed, revision: '2' }).__error.code, 'invalid_params');
    // 4. CDN rules: omitted domain untouched; present domain diffs create/update/delete, ordered
    const withRules = { ...after, cdnRules: [{ ref: 'filter:/a', name: 'a', rule: '^/a' }, { ref: 'filter:/b', name: 'b', rule: '^/b' }] };
    sessionStorage.setItem('mock-host-live-deployment', JSON.stringify(withRules));
    m = await run('?mode=reentry');
    plan = m.stub('deployment.plan', { fastedgeApps: after.fastedgeApps, revision: '2' });
    assert.deepEqual(plan.steps, []);
    plan = m.stub('deployment.plan', { fastedgeApps: after.fastedgeApps, revision: '2', cdnRules: [{ ref: 'filter:/c', name: 'c', rule: '^/c' }, { ref: 'filter:/a', name: 'a', rule: '^/aa' }] });
    assert.deepEqual(plan.steps.map((s) => s.action), ['cdn.rules.create', 'cdn.rules.update', 'cdn.rules.delete']);
    m.stub('deployment.apply', {});
    assert.deepEqual(m.stub('deployment.current', {}).cdnRules.map((r) => r.ref), ['filter:/c', 'filter:/a']);
    // 5. ?reset clears
    m = await run('?mode=reentry&reset');
    assert.equal(m.stub('deployment.current', {}).__error.code, 'conflict');
});
