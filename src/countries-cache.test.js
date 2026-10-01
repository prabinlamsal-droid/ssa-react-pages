import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCountriesRepository } from './features/countries/countriesRepository.js';
import { createCountriesDao } from './features/countries/countriesDao.js';
import { createSsaClient } from './ssa.js';

function fixture(entry = null, remote = { ok: true, data: [] }) {
  let calls = 0;
  let saved = 0;
  const dao = {
    getCountries: async () => entry,
    saveCountries: async data => { saved++; entry = { data, fresh: true }; },
  };
  const service = { getCountries: async () => { calls++; return remote; } };
  return { dao, service, repository: createCountriesRepository(service, dao), calls: () => calls, saved: () => saved };
}

test('countries caches an empty successful response and reuses it across repositories', async () => {
  const f = fixture();
  assert.equal((await f.repository.getCountries()).source, 'network');
  const result = await createCountriesRepository(f.service, f.dao).getCountries();
  assert.deepEqual(result, { ok: true, data: [], source: 'cache', stale: false });
  assert.equal(f.calls(), 1);
  assert.equal(f.saved(), 1);
});

test('explicit refresh and expired cache fetch new data', async () => {
  for (const fresh of [true, false]) {
    const f = fixture({ data: [], fresh });
    const result = await f.repository.getCountries({ refresh: fresh });
    assert.equal(result.source, 'network');
    assert.equal(f.calls(), 1);
    assert.equal(f.saved(), 1);
  }
});

test('network failure returns cached countries visibly stale without overwriting them', async () => {
  const error = { kind: 'api', code: 'noInternet', message: 'Offline' };
  const f = fixture({ data: [], fresh: false }, { ok: false, error });
  assert.deepEqual(await f.repository.getCountries(), { ok: true, data: [], source: 'cache', stale: true, refreshError: error });
  assert.equal(f.saved(), 0);
});

test('authentication failures never become cached successes', async () => {
  const failure = { ok: false, error: { kind: 'api', code: 'sessionExpired', message: 'Sign in' } };
  const f = fixture({ data: [], fresh: false }, failure);
  assert.equal(await f.repository.getCountries(), failure);
  assert.equal(f.saved(), 0);
});

test('cache read/write failures preserve successful HTTP results and report save failure', async () => {
  const f = fixture();
  f.dao.getCountries = async () => { throw Error('unavailable'); };
  f.dao.saveCountries = async () => { throw Error('full'); };
  const result = await f.repository.getCountries();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'network');
  assert.equal(result.cacheWarning, 'Could not save offline data.');
});

test('concurrent countries calls share one fetch and release the slot afterward', async () => {
  const f = fixture();
  const first = f.repository.getCountries();
  assert.equal(f.repository.getCountries(), first);
  await first;
  await f.repository.getCountries({ refresh: true });
  assert.equal(f.calls(), 2);
});

test('countries DAO saves data and time atomically and computes freshness in React', async t => {
  const requests = [];
  const transport = { postMessage: raw => requests.push(JSON.parse(raw)) };
  const client = createSsaClient(transport, {});
  t.after(() => client.dispose());
  const now = Date.parse('2026-10-01T00:00:00.000Z');
  const dao = createCountriesDao(client, () => now);
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i), name: 'Example country', slug: null }));
  const saved = dao.saveCountries(rows);
  const request = requests.at(-1);
  assert.equal(request.method, 'dao.put');
  assert.deepEqual(request.params, { store: 'countries', key: 'cache', value: { data: rows, updatedAt: '2026-10-01T00:00:00.000Z' } });
  transport.onmessage({ data: JSON.stringify({ id: request.id, ok: true, result: null }) });
  await saved;
  for (const [record, fresh] of [
    [null, null],
    [{ data: [], updatedAt: '2026-10-01T00:00:00.000Z' }, true],
    [{ data: [], updatedAt: '2026-09-24T00:00:00.001Z' }, true],
    [{ data: [], updatedAt: '2026-09-24T00:00:00.000Z' }, false],
    [{ data: [], updatedAt: '2026-10-02T00:00:00.000Z' }, false],
    [{ data: [], updatedAt: 'invalid' }, false],
    [{ data: [], updatedAt: null }, false],
  ]) {
    const reading = dao.getCountries();
    const readRequest = requests.at(-1);
    assert.equal(readRequest.method, 'dao.get');
    assert.deepEqual(readRequest.params, { store: 'countries', key: 'cache' });
    transport.onmessage({ data: JSON.stringify({ id: readRequest.id, ok: true, result: record }) });
    const result = await reading;
    if (record === null) assert.equal(result, null);
    else assert.deepEqual(result, { ...record, fresh });
  }
  const clearing = dao.clear();
  assert.deepEqual(requests.at(-1).params, { store: 'countries' });
  assert.equal(requests.at(-1).method, 'dao.clear');
  transport.onmessage({ data: JSON.stringify({ id: requests.at(-1).id, ok: true, result: null }) });
  await clearing;
});
