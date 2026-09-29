import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCountriesService } from './features/countries/countriesService.js';
import { createCountriesRepository } from './features/countries/countriesRepository.js';

test('React repository and service use HTTP once per call with no storage or cache', async () => {
  let calls = 0;
  const client = { async get(endpoint) {
    assert.equal(endpoint, 'kycCountry');
    calls++;
    return { ok: true, data: { data: [] } };
  } };
  const repository = createCountriesRepository(createCountriesService(client));
  assert.deepEqual(await repository.getCountries(), { ok: true, data: [] });
  assert.deepEqual(await repository.getCountries(), { ok: true, data: [] });
  assert.equal(calls, 2);
});

test('countries shape conversion retains only nullable string option fields', async () => {
  // DTO contract example, not a recorded server response.
  const service = createCountriesService({ get: async () => ({
    ok: true, data: { data: [{ id: 'example-id', name: 'Example', slug: null, extra: true }, {}] },
  }) });
  assert.deepEqual(await service.getCountries(), { ok: true, data: [
    { id: 'example-id', name: 'Example', slug: null }, { id: null, name: null, slug: null },
  ] });
});

test('countries rejects malformed envelopes, items and field types without throwing', async () => {
  for (const data of [null, {}, { data: {} }, { data: [null] }, { data: [[]] },
    { data: [{ name: 7 }] }, { data: [{ id: false }] }]) {
    const service = createCountriesService({ get: async () => ({ ok: true, data }) });
    assert.deepEqual(await service.getCountries(), {
      ok: false, error: { kind: 'parse', code: 'INVALID_RESPONSE', message: 'The countries response was malformed.' },
    });
  }
});

test('repository propagates native failures unchanged without retry', async () => {
  const failure = { ok: false, error: { kind: 'api', code: 'sessionExpired', message: 'Sign in' } };
  let calls = 0;
  const service = createCountriesService({ get: async () => { calls++; return failure; } });
  assert.equal(await createCountriesRepository(service).getCountries(), failure);
  assert.equal(calls, 1);
});

