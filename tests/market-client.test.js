import test from 'node:test';
import assert from 'node:assert/strict';
import { createSsaClient } from '../src/client.js';

for (const [name, invoke, method, params, result] of [
  ['device metrics', client => client.device.specs(), 'device.specs', {}, {screenWidth: 360, screenHeight: 800, contentHeight: 700}],
  ['symbol selection', client => client.symbol.pick(), 'symbol.pick', {}, 'NABIL'],
  ['cancelled selection', client => client.symbol.pick(), 'symbol.pick', {}, null],
  ['start live market', client => client.market.live({action: 'start'}), 'market.live', {action: 'start'}, null],
  ['stop live market', client => client.market.live({action: 'stop'}), 'market.live', {action: 'stop'}, null],
]) {
  test(`${name} uses the native bridge protocol`, async () => {
    const messages = [];
    const transport = {postMessage: message => messages.push(JSON.parse(message))};
    const client = createSsaClient(transport, new EventTarget());
    try {
      const pending = invoke(client);
      assert.equal(messages.length, 1);
      const request = messages[0];
      assert.equal(request.version, 1);
      assert.equal(request.method, method);
      assert.deepEqual(request.params, params);
      transport.onmessage({data: JSON.stringify({id: request.id, ok: true, result})});
      assert.deepEqual(await pending, result);
    } finally { client.dispose(); }
  });
}
