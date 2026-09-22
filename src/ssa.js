/** Public error contract shared by all SSA bridge operations. */
export class SsaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SsaError';
    this.code = code;
  }
}

/** Creates a client bound to one page and one native message transport. */
export function createSsaClient(transport, lifecycle = globalThis, timeoutMs = 5000) {
  const pending = new Map();
  let sequence = 0;
  let disposed = false;

  function receive(event) {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
    if (!response || typeof response.id !== 'string') return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok === true) request.resolve(response.result);
    else request.reject(new SsaError(response.error?.code ?? 'INVALID_RESPONSE', response.error?.message ?? 'Invalid native response.'));
  }

  if (transport) transport.onmessage = receive;

  function call(method, params = {}) {
    if (disposed) return Promise.reject(new SsaError('DISPOSED', 'The bridge client has closed.'));
    if (!transport) return Promise.reject(new SsaError('BRIDGE_UNAVAILABLE', 'Open this page in the SSA Android Bridge tab.'));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SsaError('TIMEOUT', 'Native request timed out. It may already have executed; do not automatically retry.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        transport.postMessage(JSON.stringify({ version: 1, id, method, params }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(new SsaError('TRANSPORT_ERROR', 'Could not send the native request.'));
      }
    });
  }

  function dispose() {
    if (disposed) return;
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
    vibrate: (params = { durationMs: 100 }) => call('device.vibrate', params),
    dispose,
  });
}

// The scoped WebMessageListener is registered before the page is loaded.
export const ssa = createSsaClient(globalThis.SsaNative);
