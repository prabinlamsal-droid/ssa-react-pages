import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsaClient } from './ssa.js';

function harness(options = {}) {
  const lifecycle = new EventTarget();
  const requests = [];
  const transport = { postMessage(raw) {
    const request = JSON.parse(raw);
    requests.push(request);
    if (request.method === 'socket.subscribe') options.onSubscribe?.(request.params.subscriptionId);
    if (options.noReply && request.method === 'socket.subscribe') return;
    queueMicrotask(() => transport.onmessage?.({ data: JSON.stringify({
      id: request.id, ok: true,
      result: request.method === 'socket.subscribe' ? { subscriptionId: request.params.subscriptionId, state: 'connected' } : null,
    }) }));
  } };
  const client = createSsaClient(transport, lifecycle, options.timeoutMs ?? 1000);
  function emit(id, event, data, sequence = 1) {
    lifecycle.dispatchEvent(new CustomEvent('ssa:socket', { detail: {
      version: 1, type: 'event', subscriptionId: id, event, data, sequence,
    } }));
  }
  return { client, requests, emit, lifecycle };
}

const params = { instrument: 'stock', symbol: 'NABIL' };

test('listeners exist before subscribe acknowledgement and route events by subscription', async () => {
  const received = [];
  const h = harness({ onSubscribe: id => h.emit(id, 'message', { ticker: 'NABIL' }) });
  const first = h.client.socket.subscribe({ params, onMessage: data => received.push(data) });
  const second = h.client.socket.subscribe({ params: { ...params, symbol: 'NIMB' } });
  await Promise.all([first.ready, second.ready]);
  assert.deepEqual(received, [{ ticker: 'NABIL' }]);
  assert.deepEqual(h.requests[0].params, { subscriptionId: first.id, endpoint: 'market', params });
  await first.close();
  h.emit(first.id, 'message', 'late', 2);
  assert.equal(received.length, 1);
  await second.close();
  h.client.dispose();
});

test('close during setup is idempotent and eventually releases the native subscription', async () => {
  const h = harness();
  const sub = h.client.socket.subscribe({ params });
  const close = sub.close();
  assert.equal(sub.close(), close);
  await assert.rejects(sub.ready, { code: 'SUBSCRIPTION_CLOSED' });
  await close;
  assert.ok(h.requests.some(r => r.method === 'socket.unsubscribe' && r.params.subscriptionId === sub.id));
  h.client.dispose();
});

test('native close ends routing and connection events preserve state', async () => {
  const h = harness();
  const states = [];
  const sub = h.client.socket.subscribe({ params, onState: state => states.push(state) });
  await sub.ready;
  h.emit(sub.id, 'state', 'unexpectedDisconnect', 1);
  h.emit(sub.id, 'state', 'connected', 2);
  h.emit(sub.id, 'state', 'stale', 1);
  h.emit(sub.id, 'closed', null, 3);
  h.emit(sub.id, 'state', 'late', 4);
  assert.deepEqual(states, ['unexpectedDisconnect', 'connected', 'closed']);
  h.client.dispose();
});

test('callback exceptions and async rejections are contained', async () => {
  const h = harness();
  const errors = [];
  const sub = h.client.socket.subscribe({ params, onMessage: async () => { throw new Error('private'); }, onError: e => errors.push(e.code) });
  await sub.ready;
  assert.doesNotThrow(() => h.emit(sub.id, 'message', {}, 1));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, ['CALLBACK_ERROR']);
  await sub.close();
  h.client.dispose();
});

test('client disposal releases active subscriptions and removes event listeners', async () => {
  const h = harness();
  let received = 0;
  const sub = h.client.socket.subscribe({ params, onMessage: () => received++ });
  await sub.ready;
  h.client.dispose();
  h.emit(sub.id, 'message', {}, 1);
  assert.equal(received, 0);
  assert.ok(h.requests.some(r => r.method === 'socket.unsubscribe'));
  assert.throws(() => h.client.socket.subscribe({ params }), { code: 'DISPOSED' });
});

test('timed-out setup requests cleanup and reports the failure', async () => {
  const h = harness({ noReply: true, timeoutMs: 10 });
  const errors = [];
  const sub = h.client.socket.subscribe({ params, onError: error => errors.push(error.code) });
  await assert.rejects(sub.ready, { code: 'TIMEOUT' });
  assert.deepEqual(errors, ['TIMEOUT']);
  assert.ok(h.requests.some(r => r.method === 'socket.unsubscribe'));
  h.client.dispose();
});

test('subscriptions are bounded and unsupported hosts reject without network fallback', async () => {
  const h = harness();
  const subscriptions = Array.from({ length: 32 }, () => h.client.socket.subscribe({ params }));
  assert.throws(() => h.client.socket.subscribe({ params }), { code: 'LIMIT_EXCEEDED' });
  await Promise.all(subscriptions.map(s => s.ready));
  await Promise.all(subscriptions.map(s => s.close()));
  h.client.dispose();
  const browser = createSsaClient(undefined, new EventTarget());
  await assert.rejects(browser.socket.subscribe({ params }).ready, { code: 'BRIDGE_UNAVAILABLE' });
  browser.dispose();
});


test('socket cleanup has capacity even when ordinary requests fill the bridge', async () => {
  const lifecycle = new EventTarget();
  const requests = [];
  const transport = { postMessage(raw) {
    const request = JSON.parse(raw);
    requests.push(request);
    if (request.method.startsWith('socket.')) queueMicrotask(() => transport.onmessage?.({ data: JSON.stringify({
      id: request.id, ok: true,
      result: request.method === 'socket.subscribe' ? { subscriptionId: request.params.subscriptionId } : null,
    }) }));
  } };
  const client = createSsaClient(transport, lifecycle);
  const sub = client.socket.subscribe({ params });
  await sub.ready;
  const ordinary = Array.from({ length: 64 }, () => client.storage.get({ key: 'demo.note' }).catch(() => {}));
  await sub.close();
  assert.ok(requests.some(request => request.method === 'socket.unsubscribe'));
  client.dispose();
  await Promise.all(ordinary);
});
