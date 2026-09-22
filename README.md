# SSA React Pages

Standalone React repository: https://github.com/prabinlamsal-droid/ssa-react-pages.git

This repository owns the web pages and JavaScript bridge client. The sibling
`Naasa-X-Self-Service` repository owns the Flutter host, Dart dispatcher, Android
service, and Maestro flow. Each repository has independent Git history.

React page → `ssa.vibrate({ durationMs: 100 })` → origin-scoped WebView message
listener → Dart dispatcher → Android vibrator. No browser vibration API is used.
The existing Flutter app and its authenticated routes remain the host.

## Run locally on Android

Use Node 22.12+ (or Node 24) and the project's configured Flutter SDK.

From this directory:

```bash
npm ci
npm run dev
```

With a device/emulator connected, in another terminal:

```bash
adb reverse tcp:5173 tcp:5173
```

From the **Flutter repository** root (`../Naasa-X-Self-Service` in the local
sibling-directory layout):

```bash
flutter pub get
cd packages/naasa_x
flutter run --flavor dev --dart-define=FLAVOR=dev --dart-define=SSA_BRIDGE_URL=http://localhost:5173
```

Log in and open the **Bridge** tab. Use a physical Android device to confirm the
vibration; an emulator may have no vibrator. A successful response means Android
accepted the request, not that the app can verify the physical motor moved.

The tab and route are absent unless `SSA_BRIDGE_URL` is supplied. Only HTTPS URLs
are accepted outside debug builds. Debug permits `http://localhost` using the
repository's existing localhost network policy; no broad cleartext exception is
added. Do not pass session tokens in this URL.

## Host the React page

`npm run build` produces `dist/`, suitable for a static HTTPS host. Configure
`SSA_BRIDGE_URL=https://your-dedicated-host.example/` when building SSA. Hosting
and production deployment are separate steps; this prototype does not deploy.
The example assumes a root path. Configure Vite's base if using a subpath.

## Protocol and extension points

Requests use `{ version: 1, id, method, params }`. Responses use
`{ id, ok: true, result }` or `{ id, ok: false, error: { code, message } }`.
The JS client correlates responses, rejects timeouts after five seconds, and
rejects pending calls when the page closes. It never retries native side effects.

`bridge.capabilities` reports the protocol and available operations.
`device.vibrate` accepts only an integer `durationMs` from 1 through 1000.
The dispatcher rejects unsupported methods and overlapping native operations.
Add future handlers to `SsaBridge`; web teams should call a named method on the
JS SDK rather than depend on the WebView transport directly.

This deliberately uses InAppWebView 6.1.5's **WebMessageListener**, not its global
`callHandler`: the listener restricts access to the configured origin and Dart
also checks the source origin and main-frame flag. It is registered before the
URL loads. Devices without listener support fail closed. Cross-origin page
navigation is blocked. All scripts on the trusted origin share its privileges;
use a dedicated trusted host and maintain its XSS protections.

No app tokens, storage access, or socket connection are exposed in this prototype.
Future storage, socket subscriptions, authentication handoff, nested deep links,
and unsaved-form handling require their own policies. Ordinary WebView-history
back navigation is included. iOS is explicitly unsupported for this first slice.

## Verification

Build the React demo in this repository with `npm run build`. Run the Maestro
flow from the **Flutter repository** root with the app already logged in:

```bash
maestro test -e APP_ID=com.nepse.nepal.Dash.dev packages/naasa_x/maestro-tests/bridge-prototype.yaml
```

Use the installed app's actual application ID if your developer build changes it.
Also verify: plain-browser unavailable message, missing/invalid URL, offline load
and retry, invalid duration, leaving/reopening the tab, and a device without a
vibrator. The Maestro flow cannot establish physical vibration or bridge origin
isolation; those require device/integration verification.
