import { ssa } from '../../ssa.js';
import { createDao } from '../../dao.js';

const lifetimeMs = 7 * 24 * 60 * 60 * 1000;

/** React-owned countries cache; no native feature DAO or lifetime records. */
export function createCountriesDao(client = ssa, now = Date.now) {
  const store = createDao(client).store('countries');
  return Object.freeze({
    async getCountries() {
      const entry = await store.get('cache');
      if (entry === null) return null;
      if (!entry || !Array.isArray(entry.data)) throw new Error('Invalid countries cache.');
      const timestamp = typeof entry.updatedAt === 'string' ? Date.parse(entry.updatedAt) : NaN;
      const age = now() - timestamp;
      return { ...entry, fresh: Number.isFinite(age) && age >= 0 && age < lifetimeMs };
    },
    saveCountries: data => store.put('cache', { data, updatedAt: new Date(now()).toISOString() }),
    clear: () => store.clear(),
  });
}

export const countriesDao = createCountriesDao();
