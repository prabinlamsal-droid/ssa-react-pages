import { ssa, SsaError } from './ssa.js';

function isJson(value, depth = 0) {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return Array.from(value).every(item => isJson(item, depth + 1));
  }
  if (value && typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Reflect.ownKeys(value).every(key => typeof key === 'string' && isJson(value[key], depth + 1));
  }
  return false;
}

/** Device-backed JSON stores. Flutter enforces the physical `web.` prefix. */
export function createDao(client = ssa) {
  return Object.freeze({
    store: name => Object.freeze({
      get: key => client.dao.get({ store: name, key }),
      async put(key, value) {
        if (!value || Array.isArray(value) || typeof value !== 'object' || !isJson(value)) {
          throw new SsaError('INVALID_ARGUMENT', 'Database values must be JSON objects with finite numbers.');
        }
        return client.dao.put({ store: name, key, value });
      },
      delete: key => client.dao.delete({ store: name, key }),
      clear: () => client.dao.clear({ store: name }),
    }),
  });
}

export const dao = createDao();
