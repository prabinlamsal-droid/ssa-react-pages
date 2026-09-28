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

```js
await ssa.storage.set({ key: 'demo.note', value: 'Hello from React' });
const note = await ssa.storage.get({ key: 'demo.note' }); // string or null
await ssa.storage.remove({ key: 'demo.note' });
```

`storage.set`, `storage.get`, and `storage.remove` are advertised independently
of haptics by the capabilities handshake. The demo disables storage controls
on older app builds. Missing keys return `null`; empty strings are valid values;
setting replaces an existing value; removing a missing key succeeds.

Flutter uses `SharedPreferencesAsync` (native preferences on Android), never
browser localStorage. Values survive WebView recreation and normal app restarts.
Storage is scoped to the app installation and the fixed `https://ssa.local`
origin. It is **not account-scoped** and remains after logout.
Use it only for non-sensitive preferences/drafts, not credentials, financial
records, or other critical data. App-data clearing/uninstall removes it.

Keys are 1–64 ASCII letters/digits/dots/underscores/hyphens, starting with a
letter or digit. Values are strings with a maximum JSON-encoded UTF-8 size of
4096 bytes (including quotes/escapes). Each origin is limited to 64 keys and
64 KiB of encoded data. Serialize small objects explicitly with `JSON.stringify`.
Native app preferences and credentials cannot be addressed through this API.
There is no global clear or key enumeration operation.

Errors include `INVALID_ARGUMENT`, `QUOTA_EXCEEDED`, `STORAGE_ERROR`, and
`STORAGE_CORRUPT`. Failed validation/quota checks leave existing values intact;
corrupt data is reported without silently overwriting it. Native operations on
one bridge still reject overlap with `BUSY`; storage mutations across bridge
instances are serialized within the Flutter isolate. Do not automatically retry
timed-out writes: the operation might already have completed.

To try the demo, copy the generated HTML and install the updated Flutter build.
Save a value, edit the field without saving, then Read to retrieve it. Reopen
the app and Read again to check persistence. Remove it and Read to confirm the
key is absent.

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
