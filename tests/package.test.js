import test from 'node:test';
import assert from 'node:assert/strict';
test('public API preserves native envelopes without browser fallback', async () => {
  const sdk = await import('../src/index.js');
  let message;
  const transport = { postMessage(raw) {
    message = JSON.parse(raw);
    queueMicrotask(() => transport.onmessage({data:JSON.stringify({id:message.id,ok:true,result:'saved'})}));
  }};
  const client = sdk.createSsaClient(transport);
  assert.equal(await new sdk.Shelf(client).get('demo.note'), 'saved');
  assert.equal(message.method, 'storage.get');
  assert.deepEqual(message.params,{key:'demo.note'});
  client.dispose();
  const missing = sdk.createSsaClient(null);
  await assert.rejects(missing.storage.get({key:'demo.note'}), {code:'BRIDGE_UNAVAILABLE'});
  missing.dispose();
});
