import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserClient } from '../src/browser.js';
import { arcBridge } from '../vite/plugin.js';

test('browser header profile reaches both login and countries, with dynamic display values and separate auth', async () => {
  const storage = new Map([['token', 'test-access']]);
  const requests = [];
  const target = {
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'browser-device-123' },
    navigator: { platform: 'Linux', userAgent: 'Example browser on Linux' },
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
    fetch: async (_url, options) => { requests.push(options.headers); return new Response('{}'); },
  };
  const profile = { AppVersionCode: '1', AppVersionName: '0.1.0' };
  const development = { endpoints: {
    login: { url: 'https://auth.example.test/login', browserHeaders: profile },
    countries: { url: 'https://kyc.example.test/countries', browserHeaders: profile, bearerSessionKey: 'token' },
    other: { url: 'https://other.example.test/' },
  } };
  // Exercise the actual virtual-module serialization boundary as well.
  const source = arcBridge({ target: 'browser', appId: 'header-test', contract: {
    version: 1, shelf: {}, endpoints: { login: { method: 'POST' }, countries: { method: 'GET' }, other: { method: 'GET' } },
  }, development }).load('\0arcbridge-browser-config');
  const configuration = JSON.parse(source.slice('export default '.length, -1));
  let client = createBrowserClient({ ...configuration, target });
  try {
    await client.http.request({ endpoint: 'login', method: 'POST' });
    target.innerWidth = 500;
    await client.http.request({ endpoint: 'countries', method: 'GET' });
    await client.http.request({ endpoint: 'other', method: 'GET' });
    assert.deepEqual(requests[0], {
      Accept: 'application/json', ApiVersion: 'browser', AppVersionCode: '1', AppVersionName: '0.1.0',
      DeviceManufacturer: 'Browser', DeviceMarketName: 'Browser', DeviceModel: 'Browser', BiometricType: 'none',
      DeviceId: 'browser-device-123', DeviceName: 'Linux', OsVersion: 'Example browser on Linux',
      DeviceWidth: '800', DeviceHeight: '1600', ScreenDensity: '2',
    });
    assert.equal(requests[1].Authorization, 'Bearer test-access');
    assert.equal(requests[1].DeviceWidth, '1000');
    assert.equal(requests[1].DeviceId, 'browser-device-123');
    assert.deepEqual(requests[2], { Accept: 'application/json' });
    client.dispose();
    target.crypto.randomUUID = () => 'replacement-id';
    client = createBrowserClient({ ...configuration, target });
    await client.http.request({ endpoint: 'login', method: 'POST' });
    assert.equal(requests[3].DeviceId, 'browser-device-123');
  } finally { client.dispose(); }
});

test('header configuration cannot inject credentials or malformed header values', async () => {
  for (const profile of [{ Authorization: 'Bearer forbidden' }, { APIKey: 'forbidden' }, { AppVersionName: 'bad\r\nvalue' }]) {
    let fetched = false;
    const client = createBrowserClient({ appId: 'header-test', contract: { version: 1, shelf: {}, endpoints: { login: { method: 'POST' } } },
      development: { endpoints: { login: { url: 'https://auth.example.test/login', browserHeaders: profile } } },
      target: { fetch: async () => { fetched = true; return new Response('{}'); } },
    });
    try {
      await assert.rejects(client.http.request({ endpoint: 'login', method: 'POST' }), { code: 'INVALID_ARGUMENT' });
      assert.equal(fetched, false);
    } finally { client.dispose(); }
  }
});
