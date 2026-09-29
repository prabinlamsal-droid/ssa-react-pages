import { countriesService } from './countriesService.js';

/** React owns feature orchestration; this repository is currently network-only. */
export function createCountriesRepository(service = countriesService) {
  return Object.freeze({
    getCountries() {
      // TODO: implement DAO-backed persistence and cache policy in the later DAO phase.
      return service.getCountries();
    },
  });
}

export const countriesRepository = createCountriesRepository();

