import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ssa } from './ssa.js';
import './style.css';

function App() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durationMs, setDurationMs] = useState(100);
  const [status, setStatus] = useState('Connecting to SSA…');

  useEffect(() => {
    let active = true;
    ssa.capabilities().then(({ methods }) => {
      if (!active) return;
      const supported = methods.includes('device.vibrate');
      setReady(supported);
      setStatus(supported ? 'Native bridge ready' : 'This app version does not support vibration.');
    }).catch((error) => { if (active) setStatus(`${error.code}: ${error.message}`); });
    return () => { active = false; };
  }, []);

  async function vibrate() {
    setBusy(true);
    try {
      await ssa.vibrate({ durationMs });
      setStatus('Vibration request accepted by Android.');
    } catch (error) {
      setStatus(`${error.code}: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <h1>SSA Native Bridge</h1>
    <p>This React page requests vibration through Flutter. It does not use the browser Vibration API.</p>
    <label htmlFor="duration">Duration in milliseconds</label>
    <input id="duration" type="number" min="1" max="1000" step="1" value={durationMs}
      onChange={(event) => setDurationMs(Number(event.target.value))} />
    <button id="ssa-vibrate" disabled={!ready || busy} onClick={vibrate}>
      {busy ? 'Requesting…' : 'Vibrate device'}
    </button>
    <p role="status" aria-live="polite">{status}</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
