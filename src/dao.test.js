import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDao } from './dao.js';
import { createSsaClient } from './ssa.js';

test('store methods send scoped native operations and preserve native results', async t => {
  const requests = [];
  const transport = { postMessage: raw => requests.push(JSON.parse(raw)) };
  const client = createSsaClient(transport, {});
  t.after(() => client.dispose());
  const db = createDao(client);
  const countries = db.store('countries');
  const profile = db.store('profile');
  for (const [method, invoke, params, result] of [
    ['dao.put', () => countries.put('cache', { data: [] }), { store: 'countries', key: 'cache', value: { data: [] } }, null],
    ['dao.get', () => countries.get('cache'), { store: 'countries', key: 'cache' }, { data: [] }],
    ['dao.get', () => profile.get('cache'), { store: 'profile', key: 'cache' }, null],
    ['dao.delete', () => countries.delete('cache'), { store: 'countries', key: 'cache' }, null],
    ['dao.clear', () => profile.clear(), { store: 'profile' }, null],
  ]) {
    const pending = invoke();
    const request = requests.at(-1);
    assert.equal(request.method, method);
    assert.deepEqual(request.params, params);
    transport.onmessage({ data: JSON.stringify({ id: request.id, ok: true, result }) });
    assert.deepEqual(await pending, result);
  }
});

test('native errors and unsupported apps propagate without retries or browser storage', async t => {
  const requests = [];
  const transport = { postMessage: raw => requests.push(JSON.parse(raw)) };
  const client = createSsaClient(transport, {});
  t.after(() => client.dispose());
  const pending = createDao(client).store('countries').get('cache');
  transport.onmessage({ data: JSON.stringify({ id: requests[0].id, ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'Unsupported' } }) });
  await assert.rejects(pending, { code: 'METHOD_NOT_FOUND' });
  assert.equal(requests.length, 1);
  const browser = createSsaClient(null, {});
  t.after(() => browser.dispose());
  await assert.rejects(createDao(browser).store('countries').get('cache'), { code: 'BRIDGE_UNAVAILABLE' });
});

test('non-JSON values are rejected before serialization can silently change them', async t => {
  const requests = [];
  const transport = { postMessage: raw => {
    const request = JSON.parse(raw);
    requests.push(request);
    transport.onmessage({ data: JSON.stringify({ id: request.id, ok: true, result: null }) });
  } };
  const client = createSsaClient(transport, {});
  t.after(() => client.dispose());
  const store = createDao(client).store('example');
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [null, [], { n: NaN }, { n: Infinity }, { missing: undefined },
    { fn: () => {} }, { date: new Date() }, cyclic]) {
    await assert.rejects(store.put('key', value), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(requests.length, 0);
});
