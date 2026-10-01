import { countriesService } from './countriesService.js';
import { countriesDao } from './countriesDao.js';
import { resolveCached } from '../../cache.js';

/** React owns cache policy; the DAO supplies native records and freshness. */
export function createCountriesRepository(service = countriesService, dao = countriesDao) {
  let pending;
  return Object.freeze({
    getCountries({ refresh = false } = {}) {
      // Join a running request rather than race two database replacements.
      if (pending) return pending;
      pending = resolveCached({
        onRemote: () => service.getCountries(),
        onCache: () => dao.getCountries(),
        onSave: data => dao.saveCountries(data),
        refresh,
      }).finally(() => { pending = null; });
      return pending;
    },
  });
}

export const countriesRepository = createCountriesRepository();
