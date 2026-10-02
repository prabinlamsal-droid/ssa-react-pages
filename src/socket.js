// IDs survive client replacement within this document, avoiding late-event collisions.
let subscriptionSequence = 0;
const documentId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Market socket subscriptions owned by one bridge client. */
export function createSocketClient({ call, lifecycle, ErrorClass }) {
  const subscriptions = new Map();
  let disposed = false;

  // User callbacks must not throw into the bridge's event listener.
  function deliver(callback, value, onError) {
    if (!callback) return;
    try {
      Promise.resolve(callback(value)).catch(() => {
        if (onError) deliver(onError, new ErrorClass('CALLBACK_ERROR', 'A socket callback failed.'));
      });
    } catch {
      if (onError) deliver(onError, new ErrorClass('CALLBACK_ERROR', 'A socket callback failed.'));
    }
  }

  function receive({ detail: event } = {}) {
    if (!event || event.version !== 1 || event.type !== 'event' ||
        typeof event.subscriptionId !== 'string' || !Number.isSafeInteger(event.sequence)) return;
    const entry = subscriptions.get(event.subscriptionId);
    if (!entry || event.sequence <= entry.sequence) return;
    if (!['message', 'state', 'error', 'closed'].includes(event.event)) return;
    entry.sequence = event.sequence;
    if (event.event === 'message') deliver(entry.onMessage, event.data, entry.onError);
    if (event.event === 'state' && typeof event.data === 'string') deliver(entry.onState, event.data, entry.onError);
    if (event.event === 'error') {
      deliver(entry.onError, new ErrorClass(
        typeof event.data?.code === 'string' ? event.data.code : 'SOCKET_ERROR',
        typeof event.data?.message === 'string' ? event.data.message : 'The socket operation failed.',
      ));
    }
    if (event.event === 'closed') {
      subscriptions.delete(entry.id);
      entry.closed = true;
      deliver(entry.onState, 'closed', entry.onError);
    }
  }

  lifecycle.addEventListener?.('ssa:socket', receive);

  function subscribe({ endpoint = 'market', params, onMessage, onState, onError } = {}) {
    if (disposed) throw new ErrorClass('DISPOSED', 'The socket client has closed.');
    for (const callback of [onMessage, onState, onError]) {
      if (callback !== undefined && typeof callback !== 'function') throw new TypeError('Socket callbacks must be functions.');
    }
    if (subscriptions.size >= 32) throw new ErrorClass('LIMIT_EXCEEDED', 'Too many socket subscriptions.');
    const id = `socket-${documentId}-${++subscriptionSequence}`;
    const entry = { id, onMessage, onState, onError, sequence: 0, closed: false };
    subscriptions.set(id, entry);
    let closePromise;
    const ready = call('socket.subscribe', { subscriptionId: id, endpoint, params }).then(result => {
      if (result?.subscriptionId !== id) throw new ErrorClass('INVALID_RESPONSE', 'Invalid socket subscription response.');
      if (entry.closed) throw new ErrorClass('SUBSCRIPTION_CLOSED', 'The socket subscription closed during setup.');
      return result;
    }).catch(error => {
      subscriptions.delete(id);
      if (!entry.closed) deliver(onError, error);
      entry.closed = true;
      // Setup may have executed even if the acknowledgement timed out.
      if (!disposed) call('socket.unsubscribe', { subscriptionId: id }).catch(() => {});
      throw error;
    });
    // Callers may use onError instead of awaiting ready; retain rejection for awaiters.
    ready.catch(() => {});

    function close() {
      if (closePromise) return closePromise;
      const alreadyClosed = entry.closed;
      entry.closed = true;
      subscriptions.delete(id);
      if (!alreadyClosed) deliver(onState, 'closed', onError);
      closePromise = ready.catch(() => {}).then(() => {
        if (!disposed) return call('socket.unsubscribe', { subscriptionId: id });
      });
      closePromise.catch(() => { closePromise = undefined; });
      return closePromise;
    }
    return Object.freeze({ id, ready, close });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycle.removeEventListener?.('ssa:socket', receive);
    for (const entry of subscriptions.values()) {
      entry.closed = true;
      call('socket.unsubscribe', { subscriptionId: entry.id }).catch(() => {});
    }
    subscriptions.clear();
  }

  return { api: Object.freeze({ subscribe }), dispose };
}
