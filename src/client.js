import { createSocketClient } from './socket.js';

/** Public error contract shared by all SSA bridge operations. */
export class SsaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SsaError';
    this.code = code;
  }
}

// Shared across client replacements within this document so late responses
// cannot collide with a new client's requests. Native guards cover navigation.
let requestSequence = 0;

/** Creates a client bound to one page and one native message transport. */
export function createSsaClient(transport, lifecycle = globalThis, timeoutMs = 5000, httpTimeoutMs = 120000) {
  const pending = new Map();
  let disposed = false;

  function receive(event) {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
    if (!response || typeof response.id !== 'string') return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok === true && Object.hasOwn(response, 'result')) request.resolve(response.result);
    else if (response.ok !== false || typeof response.error?.code !== 'string' || typeof response.error?.message !== 'string') {
      request.reject(new SsaError('INVALID_RESPONSE', 'Invalid native response.'));
    }
    else request.reject(new SsaError(response.error?.code ?? 'INVALID_RESPONSE', response.error?.message ?? 'Invalid native response.'));
  }

  if (transport) transport.onmessage = receive;

  function call(method, params = {}, deadlineMs = timeoutMs) {
    if (disposed) return Promise.reject(new SsaError('DISPOSED', 'The bridge client has closed.'));
    if (!transport) return Promise.reject(new SsaError('BRIDGE_UNAVAILABLE', 'Open this page in the SSA Bridge tab.'));
    const pool = name => name === 'socket.unsubscribe' ? 'cleanup' : name === 'bridge.failed' ? 'crash' : 'ordinary';
    const requestPool = pool(method);
    const inFlight = [...pending.values()].filter(request => pool(request.method) === requestPool).length;
    const limit = requestPool === 'cleanup' ? 32 : requestPool === 'crash' ? 1 : 64;
    if (inFlight >= limit) return Promise.reject(new SsaError('BUSY', 'Too many pending native requests.'));
    const id = String(++requestSequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SsaError('TIMEOUT', 'Native request timed out. It may already have executed; do not automatically retry.'));
      }, deadlineMs);
      pending.set(id, { resolve, reject, timer, method });
      try {
        const message = JSON.stringify({ version: 1, id, method, params });
        const limit = method === 'dao.put' ? 262144 : 8192;
        if (message.length > limit) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new SsaError('PAYLOAD_TOO_LARGE', 'Native request exceeds its transfer limit.'));
          return;
        }
        transport.postMessage(message);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(new SsaError('TRANSPORT_ERROR', 'Could not send the native request.'));
      }
    });
  }

  const sockets = createSocketClient({ call, lifecycle, ErrorClass: SsaError });

  function dispose() {
    if (disposed) return;
    sockets.dispose();
    disposed = true;
    if (transport) transport.onmessage = null;
    lifecycle.removeEventListener?.('pagehide', dispose);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new SsaError('DISPOSED', 'The page closed before receiving a response.'));
    }
    pending.clear();
  }
  lifecycle.addEventListener?.('pagehide', dispose);

  return Object.freeze({
    capabilities: () => call('bridge.capabilities'),
    socket: sockets.api,
    ready: () => call('bridge.ready'),
    failed: kind => call('bridge.failed', { kind }),
    device: Object.freeze({ specs: () => call('device.specs') }),
    symbol: Object.freeze({ pick: () => call('symbol.pick', {}, httpTimeoutMs) }),
    market: Object.freeze({ live: params => call('market.live', params) }),
    dao: Object.freeze({
      get: params => call('dao.get', params),
      put: params => call('dao.put', params),
      delete: params => call('dao.delete', params),
      clear: params => call('dao.clear', params),
    }),
    http: Object.freeze({
      request: (params) => call('http.request', params, httpTimeoutMs),
    }),
    haptics: Object.freeze({
      trigger: (params) => call('device.haptic', params),
    }),
    // Deprecated compatibility API for pages deployed before semantic haptics.
    vibrate: (params = { durationMs: 100 }) => call('device.vibrate', params),
    storage: Object.freeze({
      containsKey: (params) => call('storage.containsKey', params),
      deleteAll: () => call('storage.deleteAll'),
      get: (params) => call('storage.get', params),
      set: (params) => call('storage.set', params),
      remove: (params) => call('storage.remove', params),
    }),
    dispose,
  });
}
