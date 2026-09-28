import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsaClient } from './ssa.js';

test('readiness uses the versioned native bridge without parameters', async () => {
  let sent;
  const transport = { postMessage(message) {
    sent = JSON.parse(message);
    queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id: sent.id, ok: true, result: null }) }));
  } };
  const client = createSsaClient(transport, {});
  try {
    await client.ready();
    assert.deepEqual(sent, { version: 1, id: '1', method: 'bridge.ready', params: {} });
  } finally { client.dispose(); }
});

test('semantic haptics go through the native device.haptic method', async () => {
  let sent;
  const transport = { postMessage(message) {
    sent = JSON.parse(message);
    queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id: sent.id, ok: true, result: null }) }));
  } };
  const client = createSsaClient(transport, {});
  try {
    await client.haptics.trigger({ type: 'success' });
    assert.deepEqual(sent, { version: 1, id: '1', method: 'device.haptic', params: { type: 'success' } });
  } finally { client.dispose(); }
});

test('storage goes through native transport and survives recreating the JS client', async () => {
  const values = new Map();
  const sent = [];
  const transport = { postMessage(message) {
    const request = JSON.parse(message);
    sent.push(request);
    const { method, params, id } = request;
    let result = null;
    if (method === 'storage.set') values.set(params.key, params.value);
    if (method === 'storage.get') result = values.get(params.key) ?? null;
    if (method === 'storage.remove') values.delete(params.key);
    queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id, ok: true, result }) }));
  } };
  let client = createSsaClient(transport, {});
  try {
    await client.storage.set({ key: 'note', value: 'नमस्ते' });
    assert.deepEqual(sent[0], { version: 1, id: '1', method: 'storage.set', params: { key: 'note', value: 'नमस्ते' } });
    client.dispose();
    client = createSsaClient(transport, {});
    assert.equal(await client.storage.get({ key: 'note' }), 'नमस्ते');
    await client.storage.set({ key: 'note', value: '' });
    assert.equal(await client.storage.get({ key: 'note' }), '');
    await client.storage.remove({ key: 'note' });
    assert.equal(await client.storage.get({ key: 'note' }), null);
  } finally { client.dispose(); }
});

test('native storage errors retain their code and do not retry writes', async () => {
  let calls = 0;
  const transport = { postMessage(message) {
    calls++;
    const { id } = JSON.parse(message);
    queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id, ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'Full' } }) }));
  } };
  const client = createSsaClient(transport, {});
  try {
    await assert.rejects(client.storage.set({ key: 'note', value: 'value' }), { code: 'QUOTA_EXCEEDED' });
    assert.equal(calls, 1);
  } finally { client.dispose(); }
});

test('plain browser storage fails explicitly without falling back to web storage', async () => {
  const client = createSsaClient(undefined, {});
  await assert.rejects(client.storage.get({ key: 'note' }), { code: 'BRIDGE_UNAVAILABLE' });
  client.dispose();
});

test('oversized messages fail before sending instead of silently timing out', async () => {
  const client = createSsaClient({ postMessage() { assert.fail('must not send'); } }, {});
  try {
    await assert.rejects(client.storage.set({ key: 'note', value: 'x'.repeat(8192) }), { code: 'PAYLOAD_TOO_LARGE' });
  } finally { client.dispose(); }
});

test('disposing the page rejects pending storage requests', async () => {
  const client = createSsaClient({ postMessage() {} }, {});
  const assertion = assert.rejects(client.storage.get({ key: 'note' }), { code: 'DISPOSED' });
  client.dispose();
  await assertion;
});
