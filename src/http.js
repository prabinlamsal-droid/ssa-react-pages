import { ssa, SsaError } from './ssa.js';

const failure = (code, message) => ({ ok: false, error: { kind: 'bridge', code, message } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** JSON HTTP facade. Native ApiService owns authentication and network execution. */
export function createHttpClient(client = ssa) {
  async function request(method, endpoint, options = {}, data, hasBody = false) {
    if (!object(options) || Object.keys(options).some(key =>
      !['queryParams', 'pathParams', ...(method === 'DELETE' ? ['data'] : [])].includes(key))) {
      return failure('INVALID_ARGUMENT', 'Unsupported HTTP options.');
    }
    try {
      const result = await client.http.request({
        method, endpoint, ...options, ...(hasBody ? { data } : {}),
      });
      if (object(result) && result.ok === true && Object.hasOwn(result, 'data')) {
        return { ok: true, data: result.data };
      }
      if (object(result) && result.ok === false && object(result.error) &&
          result.error.kind === 'api' && typeof result.error.code === 'string' &&
          typeof result.error.message === 'string') {
        return { ok: false, error: {
          kind: 'api', code: result.error.code, message: result.error.message,
        } };
      }
      return failure('INVALID_RESPONSE', 'The native HTTP result was malformed.');
    } catch (error) {
      if (error instanceof SsaError) return failure(error.code, error.message);
      throw error;
    }
  }

  return Object.freeze({
    get: (endpoint, options) => request('GET', endpoint, options),
    post: (endpoint, data, options) => request('POST', endpoint, options, data, true),
    put: (endpoint, data, options) => request('PUT', endpoint, options, data, true),
    patch: (endpoint, data, options) => request('PATCH', endpoint, options, data, true),
    delete: (endpoint, options) => request('DELETE', endpoint, options),
  });
}

export const http = createHttpClient();

