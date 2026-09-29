import { http } from '../../http.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Maps the native client's normalized JSON envelope into React-owned data. */
export function createCountriesService(client = http) {
  return Object.freeze({
    async getCountries() {
      const result = await client.get('kycCountry');
      if (!result.ok) return result;
      const rows = result.data?.data;
      const fields = ['id', 'name', 'slug'];
      if (!Array.isArray(rows) || rows.some(row => !isObject(row) ||
          fields.some(key => row[key] != null && typeof row[key] !== 'string'))) {
        return { ok: false, error: {
          kind: 'parse', code: 'INVALID_RESPONSE', message: 'The countries response was malformed.',
        } };
      }
      return { ok: true, data: rows.map(row => ({
        id: row.id ?? null, name: row.name ?? null, slug: row.slug ?? null,
      })) };
    },
  });
}

export const countriesService = createCountriesService();

