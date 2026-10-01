import React from 'react';

/** One terminal failure per document; never send exception text or replay work. */
export function createWebResilience({ target = globalThis, client }) {
  let failed = false;
  let disposed = false;
  const listeners = new Set();
  function fail(kind) {
    if (failed || disposed) return;
    failed = true;
    // Reporting is best effort and must not cause another unhandled rejection.
    try { Promise.resolve(client.failed(kind)).catch(() => {}); } catch { /* Transport already gone. */ }
    try { client.dispose(); } catch { /* The fallback must remain usable. */ }
    for (const listener of listeners) {
      try { listener(); } catch { /* Isolate error UI listeners too. */ }
    }
  }
  const onError = event => {
    // Captured image/style load failures are not fatal application exceptions.
    if (event.target && event.target !== target) return;
    fail('runtime');
  };
  const onRejection = () => fail('unhandled-rejection');
  const dispose = () => {
    disposed = true;
    target.removeEventListener?.('error', onError);
    target.removeEventListener?.('unhandledrejection', onRejection);
    target.removeEventListener?.('pagehide', dispose);
    listeners.clear();
  };
  target.addEventListener?.('error', onError);
  target.addEventListener?.('unhandledrejection', onRejection);
  target.addEventListener?.('pagehide', dispose);
  return Object.freeze({
    get failed() { return failed; },
    fail,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose,
  });
}

/** Stops a broken React tree while native navigation and Retry remain available. */
export class WebErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: props.runtime.failed === true };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.runtime.fail('render'); }
  componentDidMount() {
    this.unsubscribe = this.props.runtime.subscribe(() => this.setState({ failed: true }));
    if (this.props.runtime.failed) this.setState({ failed: true });
  }
  componentWillUnmount() { this.unsubscribe?.(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return React.createElement('main', { role: 'alert', id: 'ssa-web-error' },
      React.createElement('h1', null, 'This page stopped working'),
      React.createElement('p', null, 'You can still use the other SSA tabs. Use the app’s Retry button to reopen this page.'),
      React.createElement('p', null, 'An action already sent may have completed. Check its status before submitting it again.'));
  }
}
