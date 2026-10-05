import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserClient } from '../src/browser.js';
const contract = { version: 1, shelf: {}, endpoints: { countries: { method: 'GET' }, login: { method: 'POST', bodyFields: { username: { type: 'string' }, password: { type: 'string' } } } } };
function setup(fetch) {
  const values = new Map();
  const client = createBrowserClient({ appId: 'auth-test', contract, development: { endpoints: {
    countries: { url: 'https://kyc.example.test/countries', bearerSessionKey: 'browser-token' },
    login: { url: 'https://auth.example.test/login' },
  } }, target: { sessionStorage: { getItem: key => values.get(key) ?? null }, fetch } });
  return { client, values };
}
test('protected browser HTTP denies missing tokens without calling the network', async () => {
  let calls = 0;
  const { client } = setup(async () => { calls++; return new Response('{}'); });
  try {
    const result = await client.http.request({ endpoint: 'countries', method: 'GET' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unAuthorized');
    assert.equal(calls, 0);
  } finally { client.dispose(); }
});
test('bearer token is read per request and never attached to login', async () => {
  const requests = [];
  const { client, values } = setup(async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });
    return new Response('{}');
  });
  try {
    values.set('browser-token', 'first-token');
    await client.http.request({ endpoint: 'countries', method: 'GET' });
    values.set('browser-token', 'second-token');
    await client.http.request({ endpoint: 'countries', method: 'GET' });
    await client.http.request({ endpoint: 'login', method: 'POST', data: { username: 'test@example.test', password: 'test-only' } });
    assert.equal(requests[0].headers.Authorization, 'Bearer first-token');
    assert.equal(requests[1].headers.Authorization, 'Bearer second-token');
    assert.equal(requests[2].headers.Authorization, undefined);
  } finally { client.dispose(); }
});
test('logout during a protected request suppresses the old response', async () => {
  let release;
  const { client, values } = setup(() => new Promise(resolve => { release = resolve; }));
  values.set('browser-token', 'first-token');
  try {
    const pending = client.http.request({ endpoint: 'countries', method: 'GET' });
    await new Promise(resolve => setImmediate(resolve));
    values.delete('browser-token');
    release(new Response('{"data":[]}'));
    assert.equal((await pending).error.code, 'unAuthorized');
  } finally { client.dispose(); }
});
