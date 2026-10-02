import React, { useEffect, useRef, useState } from 'react';
import { ssa } from './ssa.js';

/** Demonstrates an owned subscription; unmounting releases it natively. */
export function SocketSection({ available }) {
  const [symbol, setSymbol] = useState('NABIL');
  const [instrument, setInstrument] = useState('stock');
  const [status, setStatus] = useState('Not subscribed');
  const [latest, setLatest] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const subscription = useRef(null);

  useEffect(() => () => {
    const current = subscription.current;
    subscription.current = null;
    current?.close().catch(() => {});
  }, []);

  function start() {
    if (!available || subscription.current) return;
    setLatest(null);
    setStatus('Registering subscription…');
    try {
      const handle = ssa.socket.subscribe({
        endpoint: 'market',
        params: { instrument, symbol },
        onMessage: data => { if (subscription.current === handle) setLatest(data); },
        onState: state => {
          if (subscription.current !== handle) return;
          setStatus(state);
          if (state === 'closed') { subscription.current = null; setSubscribed(false); }
        },
        onError: error => { if (subscription.current === handle) setStatus(`${error.code}: ${error.message}`); },
      });
      subscription.current = handle;
      setSubscribed(true);
      handle.ready.then(({ state }) => {
        if (subscription.current === handle) setStatus(state);
      }).catch(error => {
        if (subscription.current !== handle) return;
        subscription.current = null;
        setSubscribed(false);
        setStatus(`${error.code}: ${error.message}`);
      });
    } catch (error) {
      setStatus(`${error.code ?? 'SOCKET_ERROR'}: ${error.message}`);
    }
  }

  async function stop() {
    const current = subscription.current;
    if (!current) return;
    subscription.current = null;
    setSubscribed(false);
    try {
      await current.close();
      setStatus('Subscription closed');
    } catch (error) {
      setStatus(`${error.code}: ${error.message}`);
    }
  }

  return <section aria-labelledby="socket-heading">
    <h2 id="socket-heading">Native market socket</h2>
    <p>Uses SSA’s signed-in market connection. Updates arrive when the server publishes them.</p>
    <label htmlFor="ssa-socket-symbol">Symbol</label>
    <input id="ssa-socket-symbol" value={symbol} disabled={subscribed} onChange={event => setSymbol(event.target.value.toUpperCase())} />
    <label htmlFor="ssa-socket-instrument">Feed</label>
    <select id="ssa-socket-instrument" value={instrument} disabled={subscribed} onChange={event => setInstrument(event.target.value)}>
      <option value="stock">Stock</option>
      <option value="indices">Index</option>
      <option value="stockDepth">Market depth</option>
    </select>
    <button id="ssa-socket-subscribe" disabled={!available || subscribed} onClick={start}>Subscribe</button>
    <button id="ssa-socket-close" disabled={!subscribed} onClick={stop}>Close subscription</button>
    <p role="status">{available ? status : 'Install the updated SSA app to enable sockets.'}</p>
    <pre id="ssa-socket-latest">{latest ? JSON.stringify(latest, null, 2) : 'No update received yet.'}</pre>
  </section>;
}
