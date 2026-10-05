import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createSsaClient } from '../src/client.js';
import { Shelf } from '../src/shelf.js';
import { createDao } from '../src/dao.js';
import { createHttpClient } from '../src/http.js';
const contract = { version: 1, shelf: { 'demo.note': { type: 'string' }, flag: { type: 'boolean' } }, endpoints: { countries: { method: 'GET', queryFields: { page: { type: 'integer', min: 1 } } } } };
function localStorage() {
  const values = new Map();
  return {
    get length() { return values.size }, key: i => [...values.keys()][i] ?? null,
    getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)
  };
}
async function client(appId, storage, fetch) {
  const { createBrowserTransport } = await import('../src/browser.js');
  const transport = createBrowserTransport({ appId, contract, development: { endpoints: { countries: { url: 'https://example.test/countries' } } }, target: { localStorage: storage, indexedDB, fetch } });
  return { transport, sdk: createSsaClient(transport) };
}
test('browser shelf persists false/empty and clears only own permitted keys', async () => {
  const storage = localStorage(); const a = await client('one', storage), b = await client('two', storage);
  const x = new Shelf(a.sdk), y = new Shelf(b.sdk);
  await x.put('demo.note', ''); await x.put('flag', false); await y.put('demo.note', 'other');
  assert.equal(await x.containsKey('flag'), true); assert.equal(await x.get('flag'), false);
  assert.equal(await x.get('demo.note', 'fallback'), '');
  await assert.rejects(x.put('flag', 'false'), { code: 'INVALID_ARGUMENT' });
  await x.deleteAll(); assert.equal(await x.get('flag', 'missing'), 'missing');
  assert.equal(await y.get('demo.note'), 'other');
  a.sdk.dispose(); b.sdk.dispose(); a.transport.dispose(); b.transport.dispose();
});
test('browser DAO separates stores and persists across adapter replacement', async () => {
  const first = await client('dao-test', localStorage()); const dao = createDao(first.sdk);
  await dao.store('countries').put('cache', { data: [1], savedAt: 42 });
  await dao.store('profile').put('cache', { id: 7 });
  await dao.store('countries').clear();
  assert.equal(await dao.store('countries').get('cache'), null);
  first.sdk.dispose(); first.transport.dispose();
  const second = await client('dao-test', localStorage());
  assert.deepEqual(await createDao(second.sdk).store('profile').get('cache'), { id: 7 });
  second.sdk.dispose(); second.transport.dispose();
});
test('browser HTTP uses named mapping and returns native-style API failures', async () => {
  let url;
  const { sdk, transport } = await client('http-test', localStorage(), async (u) => {
    url = u; return new Response(JSON.stringify([{ name: 'Nepal' }]), { status: 200 });
  });
  assert.deepEqual(await createHttpClient(sdk).get('countries', { queryParams: { page: 2 } }),
    { ok: true, data: { data: [{ name: 'Nepal' }] } });
  assert.equal(String(url), 'https://example.test/countries?page=2');
  const denied = await createHttpClient(sdk).get('https://evil.test');
  assert.equal(denied.error.kind, 'bridge');
  sdk.dispose(); transport.dispose();
  const failed = await client('failed', localStorage(), async () => { throw new TypeError('offline') });
  const result = await createHttpClient(failed.sdk).get('countries');
  assert.equal(result.error.kind, 'api'); assert.equal(result.error.code, 'networkUnreachable');
  failed.sdk.dispose(); failed.transport.dispose();
});
