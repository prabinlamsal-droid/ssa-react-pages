# SSA React Pages

For web/native error handling, recovery, and payload limits, see
[Bridge resilience](RESILIENCE_README.md).

Standalone React repository: https://github.com/prabinlamsal-droid/ssa-react-pages.git

This repository owns the web pages and JavaScript bridge client. The sibling
`Naasa-X-Self-Service` repository owns the Flutter host, Dart dispatcher, native
services, and Maestro flow. Each repository has independent Git history.

React page → `ssa.haptics.trigger({ type: 'success' })` → origin-scoped WebView
message listener → Dart dispatcher → the app's Flutter haptic helper. No browser
vibration API or platform-specific method channel is used. The existing Flutter
app and its authenticated routes remain the host.

## Build the Flutter asset

Use Node 22.12+ (or Node 24) and the project's configured Flutter SDK.

Vite and `vite-plugin-singlefile` compile the complete application into one
self-contained file. From this directory:

```bash
npm ci
npm run build
```

The only generated file is `dist/index.html`. Copy it into the sibling Flutter
repository:

```bash
cp dist/index.html ../Naasa-X-Self-Service/packages/naasa_x/assets/web_bridge/index.html
```

Then run the Flutter app normally:

```bash
cd ../Naasa-X-Self-Service/packages/naasa_x
flutter run --flavor dev --dart-define=FLAVOR=dev
```

Log in and open the **Bridge** tab. Use a physical Android or iOS device to confirm
feedback; simulators may provide none. A successful response means Flutter
accepted the request, not that the app can verify physical feedback occurred.

Flutter reads the HTML from its asset bundle and assigns it the fixed virtual
origin `https://ssa.local/`. No web server, Cloudflare deployment, adb reverse,
or `SSA_BRIDGE_URL` dart define is involved. React source changes appear in the
mobile app only after rebuilding, copying the artifact, and rebuilding Flutter.

## Protocol and extension points

Requests use `{ version: 1, id, method, params }`. Responses use
`{ id, ok: true, result }` or `{ id, ok: false, error: { code, message } }`.
The JS client correlates responses, rejects timeouts after five seconds, and
rejects pending calls when the page closes. It never retries native side effects.

`bridge.capabilities` reports the protocol and available operations.
When advertised, React calls `ssa.ready()` (`bridge.ready`, empty parameters)
after committing the handshake result. Flutter preloads this document in a
background WebView after login and reuses it across tab changes. The readiness
message is diagnostic, not a physical-paint guarantee; no loader is added.
`device.haptic` accepts one semantic `type`: `light`, `medium`, `heavy`,
`selectionClick`, `success`, `warning`, `error`, or `vibrate`. Native platforms
decide the exact physical effect. `device.vibrate` remains as a deprecated
compatibility operation for already-deployed pages; its duration is not exact.
The dispatcher rejects unsupported methods and overlapping native operations.
Add future handlers to `SsaBridge`; web teams should call a named method on the
JS SDK rather than depend on the WebView transport directly.

This deliberately uses InAppWebView 6.1.5's **WebMessageListener**, not its global
`callHandler`: the listener restricts access to the configured origin and Dart
also checks the source origin and main-frame flag. It is registered before the
HTML loads. Devices without listener support fail closed. Navigation outside
the fixed virtual origin is blocked. All scripts in the bundled HTML share its
bridge privileges, so dependencies and generated artifacts must be trusted.

No app tokens or socket connection are exposed in this prototype.
Future socket subscriptions, authentication handoff, nested deep links,
and unsaved-form handling require their own policies. Ordinary WebView-history
back navigation is included. The bridge host and haptics support Android and iOS.

## Native storage

The React Shelf wrapper accesses the same native records as Flutter. There is
no origin prefix or per-origin JSON record. The app's initialized Shelf is
injected into the bridge; WebView origin checks still restrict bridge callers.

| Web key | Native key | Accepted value |
| --- | --- | --- |
| `demo.note` | `ShelfKey.demoNote` | String |
| `themeMode` | `ShelfKey.themeMode` | `ThemeMode.system`, `ThemeMode.light`, or `ThemeMode.dark` |
| `balanceVisibility` | `ShelfKey.balanceVisibility` | Boolean |

The allowlist is `BridgeStorage.allowedKeys`; the adapter validates each key's
native value type. All other keys return `ACCESS_DENIED`, including tokens,
account identifiers, biometric state, and trading settings. Add keys only with
their expected types and a review of native callers.

```js
import { shelf } from './shelf.js';

await shelf.put('themeMode', 'ThemeMode.dark');
await shelf.put('balanceVisibility', false);
const mode = await shelf.get('themeMode', 'ThemeMode.system');
const exists = await shelf.containsKey('demo.note');
const removed = await shelf.delete('demo.note'); // true if present, false otherwise
await shelf.deleteAll(); // clears the allowed shared keys, including native-created values
```

Flutter's `shelf.get<String>(ShelfKey.themeMode)` now reads exactly the value
written by React. React reads are asynchronous; Flutter reads its Shelf cache
synchronously. Missing web keys return null or the supplied fallback. False
and empty string values do not trigger the fallback. Writes return null and
accept at most 4096 JSON-encoded UTF-8 bytes. Arbitrary web keys, the old
64-key quota, and the old per-origin aggregate quota no longer apply.

`deleteAll` takes no parameters, returns null, and iterates only the allowlist,
honoring native Shelf protected keys. It never invokes the global
`Shelf.deleteAll`. Deletion uses native `Shelf.delete`; bulk deletion is not
atomic and may be partial on failure. Do not retry timed-out writes or clears
automatically. Storage operations are serialized, but this is not a transaction
across unrelated native operations.

Bridge writes still use `Shelf.putChecked`, which acknowledges persistence
before updating the cache and reports failures as `STORAGE_ERROR`. Existing
Flutter `Shelf.put` error behavior has not been changed. This remains a separate
architecture decision. Invalid input returns `INVALID_ARGUMENT`; a stored
value with an incompatible type returns `STORAGE_CORRUPT`. Explicit replacement
or deletion can repair that shared value.

Shared persistence does not notify Flutter view models automatically. Native
screens that cache theme or balance state may apply changes only when their
state is refreshed. Synchronizing live UI state requires the relevant native
feature controller, not just a Shelf write.

Old SharedPreferences values and origin-prefixed Shelf records are untouched
and are not migrated into native keys. Existing native values remain authoritative.
Build the React HTML, copy it into Flutter assets, and rebuild/install the
native app together for this contract change. The low-level
`ssa.storage.get/set/remove/containsKey/deleteAll` methods remain available.

## Verification

Run `npm test` and build the React demo with `npm run build`. Run the Maestro
flow from the **Flutter repository** root with the app already logged in:

```bash
maestro test -e APP_ID=com.nepse.nepal.Dash.dev packages/naasa_x/maestro-tests/bridge-prototype.yaml
```

Use the installed app's actual application ID if your developer build changes it.
Also verify: offline load and retry, invalid haptic type, leaving/reopening the
tab, and a device without haptic hardware. The Maestro flow cannot establish
physical feedback or bridge origin isolation; those require device/integration
verification.

## Native HTTP through Archbridge

React owns its repositories and services. The HTTP path is:

React component -> React repository -> React service -> `http.js` ->
`ssa.http.request` -> native BridgeHttp -> existing ApiService.

It does **not** invoke Flutter feature repositories. Native code owns credentials,
base/audit headers, server selection, response normalization, and existing
authentication/resilience behavior. React services map JSON into feature data.

```js
import { http } from './http.js';
import { countriesRepository } from './features/countries/countriesRepository.js';

const result = await countriesRepository.getCountries();
if (result.ok) {
  console.log(result.data); // [{ id, name, slug }]
} else {
  console.error(result.error.kind, result.error.code, result.error.message);
}

// Lower-level service API returns the native normalized JSON envelope:
const raw = await http.get('kycCountry');
```

The facade has `get(endpoint, options)`, `post/put/patch(endpoint, data, options)`,
and `delete(endpoint, options)`. Optional `queryParams`, `pathParams`, and DELETE
`data` must be permitted by a native policy. The underlying native client only
supports query parameters on GET/POST. Unknown options are rejected rather than
silently dropped. PUT/PATCH require object bodies; GET bodies are rejected.

Only **GET kycCountry** is enabled initially, without parameters. Additional
methods/endpoints return ACCESS_DENIED until a reviewed native policy enables
them. Adding a policy requires a mobile release; publishing React alone cannot
expand its permissions. Never expose arbitrary URL/header/server controls.

Success: `{ ok: true, data }`. Expected failure:
`{ ok: false, error: { kind, code, message } }`. Kinds are `api` (safe native
failure), `bridge` (validation, transport, timeout, disposal), and `parse`
(service response-shape mismatch). Unexpected programming errors may still throw.
No raw status or header fidelity is promised; this wraps ApiService, not fetch.
Existing Shelf/haptic calls still use their existing throwing Promise API.

The demo requests countries only when Load countries is pressed, not on
prewarm/mount. Its button is disabled when HTTP or DAO get/put support is absent from native
capabilities. Missing bridge support never falls back to browser networking.

### Web-owned device DAO stores

React uses a generic device-backed store API:

```js
import { dao } from './dao.js';

const store = dao.store('countries');
await store.put('cache', { data: countries, updatedAt: new Date().toISOString() });
const entry = await store.get('cache'); // JSON object, or null when missing
await store.delete('cache');
await store.clear(); // only this store
```

Flutter enforces the physical name `web.countries`. Logical names allow 1–64
letters, digits, underscores or hyphens; keys are nonempty strings up to 256
characters. Values are JSON objects (nested arrays/objects allowed, finite
numbers only, maximum nesting depth 64). Mutations return null on success;
failures reject with a bridge error. There is no browser-storage fallback.

The protocol is `dao.get/put/delete/clear` with `{store, key}`;
put adds `value`, and clear accepts only `store`. Native validation prevents
access to Flutter feature stores. No per-feature Dart DAO, SQL, raw database
path, pagination or arbitrary query interface is needed. New React DAOs can
choose new logical store names without adding native registrations.

The countries path is `CountriesRepository -> CountriesDao -> DAO store
-> bridge -> Sembast`. Its single `cache` record contains `{data, updatedAt}`,
so the list and timestamp are saved atomically. React computes seven-day
freshness; missing records are misses, empty saved lists are valid hits,
and malformed/future timestamps are stale. Explicit refresh fetches again.
Network failures may return stale cached data; authentication failures remain
errors. Cache-save failures preserve network success with a warning. Concurrent
repository requests share one request. Countries are one complete list, not paginated.

Native countries DAOs, stores and freshness rules are unchanged and independent.
Web data is NOT shared with native countries, nor automatically separated by API
server. Features needing environment-specific cache keys must add that policy
explicitly. The prior experimental shared cache is not migrated or deleted.
React starts with an empty web store.

These stores use the non-eternal device database and its existing logout purge.
Transactions use the purge lock and reject operations from disposed sessions,
changed accounts or changed KYC environments. Reopen the bridge after a server
switch. Shelf remains unchanged for small shared preferences.

### Web failure containment

React is wrapped in a root error boundary. Uncaught JavaScript errors and
unhandled promise rejections latch a single failed-page state, settle pending
bridge requests, and send only a fixed category through `bridge.failed`.
Exception text, stacks, request bodies and credentials are not sent to Flutter.
Handled API/validation failures remain normal feature errors.

Flutter keeps a 20-second startup-readiness deadline. Android renderer death and
unresponsiveness, iOS content-process termination, main-frame errors and reported
web crashes move only this web session to a native, scrollable Retry screen.
The failed WebView is detached and its resources are disposed with bounded,
independently guarded cleanup. Late callbacks cannot mark a failed page healthy;
back-navigation controller errors are contained. Native navigation remains outside
the web session.

Retry explicitly recreates the web session; it does not log out, clear device
data, or replay requests. An already submitted operation may still finish.
The UI warns users to check its status before submitting again. No global
Flutter exception handler is replaced and no app-wide HTTP cancellation is used.

Malformed bridge messages, non-JSON handler results and unexpected native handler
exceptions return sanitized failures. JavaScript bounds outstanding requests,
retains existing timeouts and rejects malformed response envelopes. Crash/readiness
control messages can bypass the normal busy slot so recovery is not blocked by
a stuck operation.

This is containment, not a guarantee against OS killing the entire app,
out-of-memory conditions or native engine/plugin crashes. Runtime renderer-death
recovery still needs Android/iOS device validation. No periodic heartbeat is used:
background/prewarmed WebViews can throttle JavaScript, which would cause false alarms.

### Limits and lifecycle

HTTP allows four in-flight operations independently of storage/haptics; excess
calls return BUSY. Request envelopes are limited to 8192 characters except
`dao.put`, which permits 262144 characters including the request envelope.
Database record replies are capped at 262144 characters.
Serialized HTTP results are limited to 1048576 UTF-8 bytes before bridge transfer
(this does not cap native download memory). HTTP waits up to 120 seconds; other
bridge operations retain their five-second deadline.

Timeout/disposal does not cancel native execution. Late replies are ignored.
The JS facade and bridge add no retries; ApiService's existing native
authentication/resilience retries still apply. Do not automatically retry writes
after an ambiguous timeout. HTTP must not cancel the app's shared cancel token.

### Production network restrictions

The single-file build receives a CSP hashing its exact inline scripts/styles.
Connections, external images/assets, frames, forms, workers, objects and base
URL changes are denied; data images remain permitted. Vite's development server
is not this production security configuration.

Android uses WebSettings network-load blocking, not plugin content blockers
that can make MIME-detection HEAD requests. iOS uses WK content-blocker rules.
Both hosts retain main-frame/origin bridge checks and navigation restrictions.
The generated HTML and native host must be rebuilt together.

Verified locally: production build/hash tests, native configuration tests, and
desktop Chrome rendering with a fake bridge. The Chrome probe blocked fetch,
WebSocket, image, frame, worker and form requests; none reached the local test
server. No Android device was connected; iOS was unavailable. Mobile enforcement,
native bridge delivery under CSP, and the real countries response remain device/
integration checks before rollout. The demo's DTO contract follows OptionModel;
synthetic unit examples are not recorded countries API fixtures.

Policy references: [CSP script hashes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
and [WebView content blockers](https://inappwebview.dev/docs/webview/content-blockers/).


## Native market socket

The bridge exposes SSA's existing authenticated market socket through `ssa.socket.subscribe`.
Flutter owns the server URL, credentials, connection and reconnect policy. This version supports
`stock`, `indices` and `stockDepth` feeds; it does not open arbitrary WebSocket URLs or send
arbitrary messages to the trading server.

```js
const subscription = ssa.socket.subscribe({
  endpoint: 'market',
  params: { instrument: 'stock', symbol: 'NABIL' },
  onMessage: tick => console.log(tick),
  onState: state => console.log(state),
  onError: error => console.error(error.code, error.message),
});
await subscription.ready; // Registered; the shared connection may still be disconnected.
await subscription.close(); // Release in your React effect/service cleanup.
```

Register callbacks before awaiting `ready`: updates can arrive before the acknowledgement.
The returned `id` is unique to this document. `close()` is idempotent, and closed subscriptions
ignore late events. A native `closed` event is terminal; reconnect states such as
`unexpectedDisconnect`, `connecting`, and `connected` do not require resubscribing.
Native reconnect behavior remains controlled by the app; the bridge does not start another loop.

Messages contain the native socket's decoded field map, including `ticker`; React services
own field conversion and business logic. These are live updates, not cached snapshots. Fetch an
initial snapshot separately if needed; no automatic DAO writes or replay are performed.

Each document is limited to 32 subscriptions, with a 64 KiB JSON data limit per event.
Under load, pending market updates for the same subscription are replaced by the latest update.
This API is therefore for current market state, not a lossless trade/event history.
A failed subscription rejects `ready` and reports to `onError`; callback failures are contained.

Flutter emits `ssa:socket` events with `version`, `type: 'event'`, `subscriptionId`,
`event` (`message`, `state`, `error`, or `closed`), `sequence`, and `data`.
The JS client routes these independently from one-response HTTP/storage requests.
Logout, document reload, bridge failure, and session disposal release web subscriptions
without disconnecting native consumers. React must close subscriptions on SPA page unmount.

The demo includes subscribe/close controls and the latest received update.
The Flutter asset currently contains a newer market application than this checkout's demo.
Build/test this project normally, but integrate these source changes into that market source
before replacing Flutter's bundled HTML; blindly copying this demo would remove its market UI.
