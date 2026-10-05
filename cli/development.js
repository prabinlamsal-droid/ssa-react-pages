// Node/build-tool only: server selection never enters the mobile runtime.
import { validateBrowserHeaderProfile } from '../src/browser-header-profile.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new Error('Invalid development mapping: ' + message); };

/** Resolve named servers into the browser adapter's existing endpoint format. */
export function resolveDevelopmentEndpoints(development = {}) {
  const endpoints = development.endpoints ?? {};
  const servers = development.servers ?? {};
  if (!object(endpoints) || !object(servers)) invalid('expected endpoint and server registries.');
  return Object.fromEntries(Object.entries(endpoints).map(([name, mapping]) => {
    if (!object(mapping)) invalid('expected an endpoint mapping.');
    // Existing direct-URL/fixture consumers keep their original behavior.
    if (!Object.hasOwn(mapping, 'server')) return [name, mapping];
    if (Object.keys(mapping).some(key => !['server', 'path', 'hasAuthorization'].includes(key)) ||
      (mapping.hasAuthorization !== undefined && typeof mapping.hasAuthorization !== 'boolean')) {
      invalid('server endpoints accept only server, path and hasAuthorization.');
    }
    if (typeof mapping.server !== 'string' || !Object.hasOwn(servers, mapping.server) || !object(servers[mapping.server])) {
      invalid('endpoint references an unknown server.');
    }
    const server = servers[mapping.server];
    if (typeof server.baseUrl !== 'string' ||
      !(server.baseUrl.startsWith('/') && !server.baseUrl.startsWith('//') || /^https?:\/\//.test(server.baseUrl))) {
      invalid('server baseUrl must be HTTP(S) or a root-relative proxy path.');
    }
    let base;
    try { base = new URL(server.baseUrl, 'http://arcbridge.invalid'); }
    catch { invalid('server baseUrl is malformed.'); }
    if (base.username || base.password || /[?#\\\x00-\x20\x7f]/.test(server.baseUrl) ||
      (server.baseUrl.startsWith('/') && base.origin !== 'http://arcbridge.invalid')) {
      invalid('server baseUrl cannot contain credentials, query/fragment delimiters, whitespace or backslashes.');
    }
    const path = mapping.path;
    if (typeof path !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/.test(path) ||
      path.includes('://') || path.split('/').some(segment => segment === '.' || segment === '..')) {
      invalid('endpoint path must remain relative to its server base URL.');
    }
    const auth = server.auth ?? { type: 'none' };
    if (server.browserHeaders !== undefined) validateBrowserHeaderProfile(server.browserHeaders);
    if (!object(auth) || !['none', 'bearer'].includes(auth.type) ||
      Object.keys(auth).some(key => !['type', ...(auth.type === 'bearer' ? ['sessionKey'] : [])].includes(key)) ||
      (auth.type === 'bearer' && (typeof auth.sessionKey !== 'string' || !auth.sessionKey || auth.sessionKey.length > 256))) {
      invalid('server auth must be none or bearer with a sessionKey; secrets belong in a Node proxy.');
    }
    const url = server.baseUrl.replace(/\/+$/, '') + '/' + path;
    return [name, {
      url,
      ...(server.browserHeaders !== undefined ? { browserHeaders: server.browserHeaders } : {}),
      ...(auth.type === 'bearer' && mapping.hasAuthorization !== false ? { bearerSessionKey: auth.sessionKey } : {}),
    }];
  }));
}
