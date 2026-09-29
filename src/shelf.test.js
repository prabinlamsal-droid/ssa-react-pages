import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shelf } from './shelf.js';
import { createSsaClient, SsaError } from './ssa.js';

test('Shelf maps the familiar API onto existing bridge messages', async () => {
  const sent = [];
  const values = new Map();
  const transport = { postMessage(message) {
    const request = JSON.parse(message);
    sent.push(request);
    const { method, params, id } = request;
    let result = null;
    if (method === 'storage.set') values.set(params.key, params.value);
    if (method === 'storage.get') result = values.get(params.key) ?? null;
    if (method === 'storage.remove') result = values.delete(params.key);
    if (method === 'storage.containsKey') result = values.has(params.key);
    if (method === 'storage.deleteAll') values.clear();
    queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id, ok: true, result }) }));
  } };
  const client = createSsaClient(transport, {});
  const shelf = new Shelf(client);
  try {
    assert.equal(await shelf.get('note'), null);
    assert.equal(await shelf.get('note', 'fallback'), 'fallback');
    assert.equal(await shelf.put('note', ''), null);
    assert.equal(await shelf.get('note', 'fallback'), '');
    await shelf.put('note', 'नमस्ते');
    assert.equal(await new Shelf(client).get('note'), 'नमस्ते');
    assert.equal(await shelf.delete('note'), true);
    assert.equal(await shelf.get('note'), null);
    assert.equal(await shelf.delete('note'), false);
    assert.deepEqual(sent[2], { version: 1, id: '3', method: 'storage.set', params: { key: 'note', value: '' } });
    assert.equal(sent[6].method, 'storage.remove');
    assert.equal(await shelf.containsKey('note'), false);
    await shelf.put('note', '');
    assert.equal(await shelf.containsKey('note'), true);
    await shelf.put('second', false);
    assert.equal(await shelf.get('second', true), false);
    assert.equal(await shelf.deleteAll(), null);
    assert.deepEqual(sent.at(-1), { version: 1, id: String(sent.length), method: 'storage.deleteAll', params: {} });
    assert.equal(await shelf.containsKey('note'), false);
    assert.deepEqual(sent.at(-1).params, { key: 'note' });
    assert.equal(await shelf.get('second'), null);
    assert.equal(await shelf.deleteAll(), null);
  } finally { client.dispose(); }
});

test('Shelf propagates failures unchanged without returning a fallback or retrying', async () => {
  const error = new SsaError('STORAGE_ERROR', 'Failed');
  let attempts = 0;
  const fail = async () => { attempts++; throw error; };
  const shelf = new Shelf({ storage: { get: fail, set: fail, remove: fail, containsKey: fail, deleteAll: fail } });
  await assert.rejects(shelf.get('note', 'fallback'), (caught) => caught === error);
  await assert.rejects(shelf.put('note', 'value'), (caught) => caught === error);
  await assert.rejects(shelf.delete('note'), (caught) => caught === error);
  await assert.rejects(shelf.containsKey('note'), (caught) => caught === error);
  await assert.rejects(shelf.deleteAll(), (caught) => caught === error);
  assert.equal(attempts, 5);
});
