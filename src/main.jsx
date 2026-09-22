import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ssa } from './ssa.js';
import './style.css';

function App() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durationMs, setDurationMs] = useState(100);
  const [status, setStatus] = useState('Connecting to SSA…');
  const [storageReady, setStorageReady] = useState(false);
  const [storageKey, setStorageKey] = useState('demo.note');
  const [storageValue, setStorageValue] = useState('Hello from React');
  const [storageStatus, setStorageStatus] = useState('Waiting for the native bridge…');

  useEffect(() => {
    let active = true;
    ssa.capabilities().then(({ methods }) => {
      if (!active) return;
      const supported = methods.includes('device.vibrate');
      setReady(supported);
      setStatus(supported ? 'Native bridge ready' : 'This app version does not support vibration.');
      const supportsStorage = ['storage.get', 'storage.set', 'storage.remove'].every((method) => methods.includes(method));
      setStorageReady(supportsStorage);
      setStorageStatus(supportsStorage ? 'Native storage ready' : 'Install the updated SSA app to enable storage.');
    }).catch((error) => {
      if (active) {
        setStatus(`${error.code}: ${error.message}`);
        setStorageStatus('Open this page in the SSA Android Bridge tab to use native storage.');
      }
    });
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

  async function storageAction(action) {
    setBusy(true);
    try {
      if (action === 'set') {
        await ssa.storage.set({ key: storageKey, value: storageValue });
        setStorageStatus(`Saved “${storageKey}” on this device. Reopen the app and read it back.`);
      } else if (action === 'get') {
        const value = await ssa.storage.get({ key: storageKey });
        setStorageValue(value ?? '');
        setStorageStatus(value === null ? `No value saved for “${storageKey}”.` : `Read “${storageKey}” from native storage.`);
      } else {
        await ssa.storage.remove({ key: storageKey });
        setStorageValue('');
        setStorageStatus(`Removed “${storageKey}” from this device.`);
      }
    } catch (error) {
      setStorageStatus(`${error.code}: ${error.message}`);
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
    <section aria-labelledby="storage-heading">
      <h2 id="storage-heading">Native storage</h2>
      <p>Save a note on this device, then reopen the app and read it back. Use this for non-sensitive preferences or drafts.</p>
      <label htmlFor="storage-key">Key</label>
      <input id="storage-key" value={storageKey} maxLength={64} disabled={busy}
        onChange={(event) => setStorageKey(event.target.value)} />
      <label htmlFor="storage-value">Value</label>
      <textarea id="storage-value" value={storageValue} rows={3} disabled={busy}
        onChange={(event) => setStorageValue(event.target.value)} />
      <div className="storage-actions">
        <button id="ssa-storage-save" disabled={!storageReady || busy} onClick={() => storageAction('set')}>Save</button>
        <button id="ssa-storage-read" disabled={!storageReady || busy} onClick={() => storageAction('get')}>Read</button>
        <button id="ssa-storage-remove" disabled={!storageReady || busy} onClick={() => storageAction('remove')}>Remove</button>
      </div>
      <p role="status" aria-live="polite">{storageStatus}</p>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
