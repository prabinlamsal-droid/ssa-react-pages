import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserClient } from '../src/browser.js';
import { createHttpClient } from '../src/http.js';

test('browser wraps raw arrays like native ApiService without changing JSON objects', async () => {
  for (const [body, expected] of [
    [[{ id: '668cefdfa86cb0df3a13bbf4', name: 'Nepal' }], { data: [{ id: '668cefdfa86cb0df3a13bbf4', name: 'Nepal' }] }],
    [[], { data: [] }],
    [{ data: [{ name: 'Nepal' }] }, { data: [{ name: 'Nepal' }] }],
    [{ isSuccess: true, result: { accessToken: 'test-token' } }, { isSuccess: true, result: { accessToken: 'test-token' } }],
  ]) {
    const client = createBrowserClient({ appId: 'response-test', contract: { version: 1, shelf: {}, endpoints: { sample: { method: 'GET' } } },
      development: { endpoints: { sample: { url: 'https://example.test/sample' } } },
      target: { fetch: async () => new Response(JSON.stringify(body)) },
    });
    try { assert.deepEqual(await createHttpClient(client).get('sample'), { ok: true, data: expected }); }
    finally { client.dispose(); }
  }
});
