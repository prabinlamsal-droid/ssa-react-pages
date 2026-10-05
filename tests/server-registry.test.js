import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBridge } from '../vite/plugin.js';
import { createBrowserClient } from '../src/browser.js';

function configuration(development) {
  const contract = { version: 1, shelf: {}, endpoints: {
    countries: { method: 'GET' }, public: { method: 'GET' }, login: { method: 'POST' }, other: { method: 'GET' },
  } };
  const source = arcBridge({ target: 'browser', appId: 'server-test', contract, development }).load('\0arcbridge-browser-config');
  return JSON.parse(source.slice('export default '.length, -1));
}

test('server-based endpoints inherit base URL, header profile and auth without crossing servers', async () => {
  const requests = [];
  const config = configuration({ servers: {
    kyc: { baseUrl: 'https://kyc.example.test/api/v1/', browserHeaders: { AppVersionName: 'kyc-demo' }, auth: { type: 'bearer', sessionKey: 'kyc-token' } },
    auth: { baseUrl: 'https://auth.example.test/api/v1', browserHeaders: { AppVersionName: 'auth-demo' }, auth: { type: 'none' } },
    other: { baseUrl: '/proxy/other/', auth: { type: 'none' } },
  }, endpoints: {
    countries: { server: 'kyc', path: 'setting/country' },
    public: { server: 'kyc', path: 'public', hasAuthorization: false },
    login: { server: 'auth', path: 'SSA/loginSSAUser' },
    other: { server: 'other', path: 'items' },
  } });
  const values = new Map([['kyc-token', 'test-access']]);
  const client = createBrowserClient({ ...config, target: {
    location: { origin: 'http://localhost:5173' },
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    fetch: async (url, options) => { requests.push({ url: String(url), headers: options.headers }); return new Response('{}'); },
  } });
  try {
    for (const [endpoint, method] of [['countries', 'GET'], ['public', 'GET'], ['login', 'POST'], ['other', 'GET']]) {
      assert.equal((await client.http.request({ endpoint, method })).ok, true);
    }
    assert.equal(requests[0].url, 'https://kyc.example.test/api/v1/setting/country');
    assert.equal(requests[0].headers.Authorization, 'Bearer test-access');
    assert.equal(requests[0].headers.AppVersionName, 'kyc-demo');
    assert.equal(requests[1].headers.Authorization, undefined);
    assert.equal(requests[1].headers.AppVersionName, 'kyc-demo');
    assert.equal(requests[2].url, 'https://auth.example.test/api/v1/SSA/loginSSAUser');
    assert.equal(requests[2].headers.AppVersionName, 'auth-demo');
    assert.equal(requests[2].headers.Authorization, undefined);
    assert.deepEqual(requests[3], { url: 'http://localhost:5173/proxy/other/items', headers: { Accept: 'application/json' } });
  } finally { client.dispose(); }
});

test('invalid registry mappings fail before browser configuration is published', () => {
  const server = { baseUrl: 'https://kyc.example.test/api/v1/', auth: { type: 'none' } };
  for (const endpoint of [
    { server: 'missing', path: 'countries' },
    { server: '__proto__', path: 'countries' },
    { server: 'kyc', path: '../outside' },
    { server: 'kyc', path: '/outside' },
    { server: 'kyc', path: 'https://other.example.test/' },
    { server: 'kyc', path: 'countries', url: 'https://other.example.test/' },
    { server: 'kyc', path: 'countries', hasAuthorization: 'false' },
  ]) {
    assert.throws(() => configuration({ servers: { kyc: server }, endpoints: { countries: endpoint } }), /development|server|path|mapping/i);
  }
  for (const invalid of [
    { baseUrl: 'https://user:password@kyc.example.test/api/' },
    { baseUrl: 'https://kyc.example.test/api/?secret=value' },
    { baseUrl: 'https://kyc.example.test/api/?' },
    { baseUrl: 'https://kyc.example.test/api/#' },
    { baseUrl: '/\n/other.example.test/api/' },
    { baseUrl: '//kyc.example.test/api/' },
    { baseUrl: 'ftp://kyc.example.test/' },
    { baseUrl: 'https://kyc.example.test/', auth: { type: 'bearer' } },
    { baseUrl: 'https://kyc.example.test/', auth: { type: 'basic', password: 'forbidden' } },
  ]) {
    assert.throws(() => configuration({ servers: { kyc: invalid }, endpoints: { countries: { server: 'kyc', path: 'countries' } } }), /development|server|auth/i);
  }
});

test('referenced server header profiles are validated before publication', () => {
  for (const browserHeaders of [{ Authorization: 'Bearer forbidden' }, { AppVersionName: 'bad\r\nvalue' }]) {
    assert.throws(() => configuration({ servers: { kyc: { baseUrl: 'https://kyc.example.test/', browserHeaders } },
      endpoints: { countries: { server: 'kyc', path: 'countries' } },
    }), /header|development/i);
  }
});

test('mobile plugin does not resolve or publish development server registries', async () => {
  const plugin = arcBridge({ target: 'mobile', appId: 'mobile-test', contract: {},
    development: { servers: { invalid: { baseUrl: 'bad' } }, endpoints: { countries: { server: 'missing', path: 'x' } } },
  });
  await assert.rejects(plugin.resolveId.call({ error(message) { throw new Error(message); } }, 'virtual:arcbridge-browser-config'), /development module/);
});
