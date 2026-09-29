import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsaClient } from './ssa.js';
import { createHttpClient } from './http.js';

function harness(t, timeoutMs = 5000, httpTimeoutMs = 120000) {
  const requests = [];
  const transport = { postMessage: message => requests.push(JSON.parse(message)) };
  const client = createSsaClient(transport, {}, timeoutMs, httpTimeoutMs);
  t.after(() => client.dispose());
  const reply = (id, result, error) => transport.onmessage?.({ data: JSON.stringify({
    id, ok: !error, ...(error ? { error } : { result }),
  }) });
  return { requests, client, http: createHttpClient(client), reply };
}

test('HTTP helpers send all five verbs through the single bridge and preserve JSON results', async t => {
  const h = harness(t);
  for (const [name, args, data] of [
    ['get', ['kycCountry'], undefined],
    ['post', ['test', { note: 'value' }], { note: 'value' }],
    ['put', ['test', {}], {}],
    ['patch', ['test', {}], {}],
    ['delete', ['test', { data: { id: '1' } }], { id: '1' }],
  ]) {
    const pending = h.http[name](...args);
    const request = h.requests.at(-1);
    assert.equal(request.method, 'http.request');
    assert.equal(request.params.method, name.toUpperCase());
    assert.equal(request.params.endpoint, args[0]);
    assert.deepEqual(request.params.data, data);
    h.reply(request.id, { ok: true, data: { data: [] } });
    assert.deepEqual(await pending, { ok: true, data: { data: [] } });
  }
  assert.equal(h.requests.length, 5);
});

test('HTTP keeps API failures distinct from transport failures and never retries', async t => {
  const h = harness(t);
  const pending = h.http.get('kycCountry');
  h.reply(h.requests[0].id, { ok: false, error: { kind: 'api', code: 'sessionExpired', message: 'Sign in' } });
  assert.deepEqual(await pending, { ok: false, error: { kind: 'api', code: 'sessionExpired', message: 'Sign in' } });
  const oldApp = h.http.get('kycCountry');
  h.reply(h.requests[1].id, null, { code: 'METHOD_NOT_FOUND', message: 'Unsupported' });
  assert.equal((await oldApp).error.kind, 'bridge');
  assert.equal(h.requests.length, 2);
});

test('invalid native result envelopes become explicit errors', async t => {
  const h = harness(t);
  for (const value of [null, {}, { ok: true }, { ok: true, data: undefined },
    { ok: false, error: {} }, { ok: false, error: { kind: 'api', code: 123, message: 'bad' } }]) {
    const pending = h.http.get('kycCountry');
    h.reply(h.requests.at(-1).id, value);
    assert.equal((await pending).error.code, 'INVALID_RESPONSE');
  }
});

test('unsupported browser and oversized payloads fail explicitly without network fallback', async t => {
  const missing = createSsaClient(undefined, {});
  t.after(() => missing.dispose());
  assert.equal((await createHttpClient(missing).get('kycCountry')).error.code, 'BRIDGE_UNAVAILABLE');
  const h = harness(t);
  assert.equal((await h.http.post('test', { text: 'x'.repeat(8192) })).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(h.requests.length, 0);
});

test('request IDs correlate reversed HTTP replies and preserve storage channel ownership', async t => {
  const h = harness(t);
  const first = h.http.get('kycCountry');
  const second = h.http.get('kycCountry');
  h.reply(h.requests[1].id, { ok: true, data: 2 });
  h.reply(h.requests[0].id, { ok: true, data: 1 });
  assert.equal((await first).data, 1);
  assert.equal((await second).data, 2);
  const storage = h.client.storage.get({ key: 'demo.note' });
  h.reply(h.requests[2].id, 'saved');
  assert.equal(await storage, 'saved');
});

test('HTTP uses its longer deadline and ignores late replies without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  const pending = h.http.get('kycCountry');
  let settled = false;
  pending.then(() => { settled = true; });
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(115000);
  assert.equal((await pending).error.code, 'TIMEOUT');
  const next = h.http.get('kycCountry');
  h.reply(h.requests[0].id, { ok: true, data: 'late' });
  h.reply(h.requests[1].id, { ok: true, data: 'current' });
  assert.equal((await next).data, 'current');
  assert.equal(h.requests.length, 2);
});

test('disposing settles HTTP requests as results and keeps existing storage rejection behavior', async t => {
  const h = harness(t);
  const pending = h.http.get('kycCountry');
  const storage = assert.rejects(h.client.storage.get({ key: 'demo.note' }), { code: 'DISPOSED' });
  h.client.dispose();
  assert.equal((await pending).error.code, 'DISPOSED');
  await storage;
});

test('HTTP options cannot replace the chosen endpoint or method', async t => {
  const h = harness(t);
  const pending = h.http.get('kycCountry', { method: 'POST', endpoint: 'auth', headers: { token: 'secret' } });
  assert.equal((await pending).error.code, 'INVALID_ARGUMENT');
  assert.equal(h.requests.length, 0);
});

