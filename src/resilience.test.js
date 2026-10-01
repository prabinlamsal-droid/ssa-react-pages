import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebResilience, WebErrorBoundary } from './resilience.js';
import { createSsaClient } from './ssa.js';

test('uncaught failures notify once without forwarding private exception details', () => {
  const target = new EventTarget();
  const reports = [];
  let disposed = 0;
  const runtime = createWebResilience({ target, client: {
    failed: kind => { reports.push(kind); return Promise.reject(Error('native unavailable')); },
    dispose: () => disposed++,
  } });
  let notices = 0;
  runtime.subscribe(() => notices++);
  target.dispatchEvent(new Event('error'));
  target.dispatchEvent(new Event('unhandledrejection'));
  runtime.fail('render');
  assert.equal(runtime.failed, true);
  assert.deepEqual(reports, ['runtime']);
  assert.equal(notices, 1);
  assert.equal(disposed, 1);
  runtime.dispose();
});

test('disposing removes global listeners and reporting cannot throw', () => {
  const target = new EventTarget();
  const runtime = createWebResilience({ target, client: {
    failed: () => { throw Error('transport gone'); }, dispose: () => {},
  } });
  assert.doesNotThrow(() => runtime.fail('unhandled-rejection'));
  runtime.dispose();
  const second = createWebResilience({ target, client: { failed: () => {}, dispose: () => {} } });
  second.dispose();
  target.dispatchEvent(new Event('error'));
  assert.equal(second.failed, false);
});

test('React boundary renders a safe fallback and reports only a failure category', () => {
  const reports = [];
  const boundary = new WebErrorBoundary({ runtime: { fail: kind => reports.push(kind) }, children: 'healthy' });
  assert.equal(boundary.render(), 'healthy');
  boundary.state = WebErrorBoundary.getDerivedStateFromError(Error('secret payload'));
  boundary.componentDidCatch(Error('secret payload'));
  const fallback = boundary.render();
  assert.equal(fallback.props.role, 'alert');
  assert.equal(JSON.stringify(fallback).includes('secret payload'), false);
  assert.deepEqual(reports, ['render']);
});

test('crash report is sent before all outstanding native requests are rejected', async () => {
  const sent = [];
  const client = createSsaClient({ postMessage: raw => sent.push(JSON.parse(raw)) }, {});
  const waiting = assert.rejects(client.dao.get({ store: 'countries', key: 'cache' }), { code: 'DISPOSED' });
  const runtime = createWebResilience({ target: new EventTarget(), client });
  runtime.fail('runtime');
  await waiting;
  assert.equal(sent[1].method, 'bridge.failed');
  assert.deepEqual(sent[1].params, { kind: 'runtime' });
  runtime.dispose();
});

test('request storms are bounded and malformed replies reject without throwing', async t => {
  const sent = [];
  const transport = { postMessage: raw => sent.push(JSON.parse(raw)) };
  const client = createSsaClient(transport, {});
  t.after(() => client.dispose());
  const waiting = Array.from({ length: 64 }, () => client.dao.get({ store: 'countries', key: 'cache' }).catch(e => e.code));
  await assert.rejects(client.dao.get({ store: 'countries', key: 'cache' }), { code: 'BUSY' });
  assert.equal(sent.length, 64);
  assert.doesNotThrow(() => transport.onmessage({ data: JSON.stringify({ id: sent[0].id, ok: true }) }));
  assert.equal(await waiting[0], 'INVALID_RESPONSE');
  client.dispose();
  await Promise.all(waiting);
});

test('only one extra crash-report slot is reserved when ordinary requests fill the limit', async t => {
  let sent = 0;
  const client = createSsaClient({ postMessage() {
    if (++sent > 65) throw Error('should not send another request');
  } }, {});
  t.after(() => client.dispose());
  const work = Array.from({ length: 64 }, () => client.dao.get({ store: 'x', key: 'y' }).catch(() => {}));
  work.push(client.failed('runtime').catch(() => {}));
  await assert.rejects(client.failed('runtime'), { code: 'BUSY' });
  assert.equal(sent, 65);
  client.dispose();
  await Promise.all(work);
});
