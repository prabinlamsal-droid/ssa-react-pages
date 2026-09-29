# SSA React Pages

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
automatically. Bridge calls are serialized, but this is not a transaction
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
