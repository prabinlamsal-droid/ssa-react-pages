import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ssa, SsaError } from './ssa.js';
import { shelf } from './shelf.js';
import { SocketSection } from './SocketSection.jsx';
import { countriesRepository } from './features/countries/countriesRepository.js';
import './style.css';
import { createWebResilience, WebErrorBoundary } from './resilience.js';

const webResilience = createWebResilience({ client: ssa });

function CountriesSection({ available }) {
  const [loading, setLoading] = useState(false);
  const [countries, setCountries] = useState([]);
  const [status, setStatus] = useState('No request made yet.');
  const active = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function load(refresh = false) {
    if (inFlight.current || !available) return;
    inFlight.current = true;
    setLoading(true);
    setStatus('Requesting through the native HTTP client…');
    try {
      const result = await countriesRepository.getCountries({ refresh });
      if (!active.current) return;
      if (result.ok) {
        setCountries(result.data);
        setStatus(`${result.data.length} countries from ${result.source}.${result.stale ? ' Offline: saved data may be outdated.' : ''}${result.cacheWarning ? ' ' + result.cacheWarning : ''}`);
      } else {
        setCountries([]);
        setStatus(`${result.error.kind}: ${result.error.code} — ${result.error.message}`);
      }
    } catch {
      if (active.current) setStatus('The request could not complete.');
    } finally {
      inFlight.current = false;
      if (active.current) setLoading(false);
    }
  }

  return <section aria-labelledby="http-heading">
    <h2 id="http-heading">Native HTTP</h2>
    <p>Countries are saved on this device for seven days. Refresh to check for updates.</p>
    <button id="ssa-http-countries" disabled={!available || loading} onClick={() => load()}>
      {loading ? 'Requesting…' : 'Load countries'}
    </button>
    <button id="ssa-http-refresh" disabled={!available || loading} onClick={() => load(true)}>Refresh countries</button>
    <p role="status" aria-live="polite">
      {available ? status : 'Install the updated SSA app to enable native HTTP.'}
    </p>
    <ul id="ssa-http-results">
      {countries.map((country, index) => <li key={`${country.id ?? 'country'}-${index}`}>
        {country.name ?? country.slug ?? country.id ?? 'Unnamed country'}
      </li>)}
    </ul>
  </section>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [canReportReady, setCanReportReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hapticType, setHapticType] = useState('medium');
  const [status, setStatus] = useState('Connecting to SSA…');
  const [storageReady, setStorageReady] = useState(false);
  const [httpReady, setHttpReady] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [storageKey, setStorageKey] = useState('demo.note');
  const [storageValue, setStorageValue] = useState('Hello from React');
  const [storageStatus, setStorageStatus] = useState('Waiting for the native bridge…');

  useEffect(() => {
    let active = true;
    ssa.capabilities().then(({ methods }) => {
      if (!active) return;
      const supported = methods.includes('device.haptic');
      setReady(supported);
      setStatus(supported ? 'Native bridge ready' : 'This app version does not support semantic haptics.');
      const supportsStorage = ['storage.get', 'storage.set', 'storage.remove'].every((method) => methods.includes(method));
      setStorageReady(supportsStorage);
      setSocketReady(['socket.subscribe', 'socket.unsubscribe'].every(method => methods.includes(method)));
      setHttpReady(['http.request', 'dao.get', 'dao.put'].every(method => methods.includes(method)));
      setStorageStatus(supportsStorage ? 'Native storage ready' : 'Install the updated SSA app to enable storage.');
      setCanReportReady(methods.includes('bridge.ready'));
    }).catch((error) => {
      if (active) {
        setStatus(`${error.code}: ${error.message}`);
        setStorageStatus('Open this page in the SSA Bridge tab to use native storage.');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!canReportReady) return;
    // Runs after React commits the handshake result. This is not a paint guarantee.
    // Avoid animation-frame timers: background WebViews can throttle them.
    ssa.ready().catch((error) => console.warn('SSA readiness acknowledgement failed', error.code));
  }, [canReportReady]);

  async function triggerHaptic() {
    setBusy(true);
    try {
      await ssa.haptics.trigger({ type: hapticType });
      setStatus(`${hapticType} haptic request accepted by the device.`);
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
        if (storageKey === 'balanceVisibility' && !['true', 'false'].includes(storageValue)) {
          throw new SsaError('INVALID_ARGUMENT', 'Enter true or false for balance visibility.');
        }
        await shelf.put(storageKey, storageKey === 'balanceVisibility' ? storageValue === 'true' : storageValue);
        setStorageStatus(`Saved “${storageKey}” on this device. Reopen the app and read it back.`);
      } else if (action === 'get') {
        const value = await shelf.get(storageKey);
        setStorageValue(value === null ? '' : String(value));
        setStorageStatus(value === null ? `No value saved for “${storageKey}”.` : `Read “${storageKey}” from native storage.`);
      } else {
        await shelf.delete(storageKey);
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
    <p>This React page requests semantic haptic feedback through Flutter. It does not use a browser vibration API.</p>
    <label htmlFor="haptic-type">Haptic type</label>
    <select id="haptic-type" value={hapticType} disabled={busy}
      onChange={(event) => setHapticType(event.target.value)}>
      {['light', 'medium', 'heavy', 'selectionClick', 'success', 'warning', 'error', 'vibrate']
        .map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
    <button id="ssa-vibrate" disabled={!ready || busy} onClick={triggerHaptic}>
      {busy ? 'Requesting…' : 'Trigger haptic'}
    </button>
    <p role="status" aria-live="polite">{status}</p>
    <CountriesSection available={httpReady} />
    <SocketSection available={socketReady} />
    <section aria-labelledby="storage-heading">
      <h2 id="storage-heading">Native storage</h2>
      <p>Save a note on this device, then reopen the app and read it back. Use this for non-sensitive preferences or drafts.</p>
      <label htmlFor="storage-key">Key</label>
      <select id="storage-key" value={storageKey} disabled={busy}
        onChange={(event) => {
          const key = event.target.value;
          setStorageKey(key);
          setStorageValue(key === 'themeMode' ? 'ThemeMode.system' : key === 'balanceVisibility' ? 'false' : 'Hello from React');
        }}>
        <option value="demo.note">Demo note</option>
        <option value="themeMode">Theme mode</option>
        <option value="balanceVisibility">Balance visibility</option>
      </select>
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

try {
  createRoot(document.getElementById('root')).render(
    <WebErrorBoundary runtime={webResilience}><App /></WebErrorBoundary>,
  );
} catch {
  webResilience.fail('bootstrap');
}
