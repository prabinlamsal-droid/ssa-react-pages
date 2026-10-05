# ArcBridge

Reusable native bridge SDK and development/build tools. Current version: 0.1.0.
Use Node 22.12+ (tested with Node 24) and the packaged Vite 7 toolchain.

## Install

Local development: add `"@naasa/arcbridge": "file:../arcbridge"` to dependencies
and put `install-links=true` in the consumer .npmrc, then `npm install`.
This installs a package snapshot rather than a sibling symlink, so optional
React resolves from the consuming app. npm may retain the installed snapshot
after same-version local edits; uninstall/reinstall this dependency to refresh it,
or install a new versioned tarball. Production consumers should pin release commits.

For Azure Repos, replace that dependency with a team-supplied Git URL pinned to
a release commit. This repository ships runnable ESM, so installation needs no
prepare/build step. Do not put PATs in dependency URLs. No remote is configured
or published by this implementation.

## Consumer setup

Create `arcbridge.config.mjs` in the app root:

```js
import { defineConfig } from '@naasa/arcbridge/config';
export default defineConfig({
  appId: 'my-app',
  htmlEntry: './index.html',
  outputDirectory: './dist',
  contractFile: './arcbridge.contract.json',
  browserDevelopmentConfig: './arcbridge.dev.local.mjs',
  flutter: { assetDirectory: '../flutter/packages/app/assets/web_bridge' },
  devOnly: ['./arcbridge.dev.local.mjs'],
});
```

A contract declares public names, not native URLs or credentials:

```json
{
  "version": 1,
  "endpoints": { "kycCountry": { "method": "GET" } },
  "shelf": {
    "demo.note": { "type": "string" },
    "balanceVisibility": { "type": "boolean" }
  }
}
```

A local development file exports endpoint mappings:

```js
export default {
  endpoints: { kycCountry: { url: '/api/countries' } },
  proxy: {
    '/api': {
      target: process.env.ARCBRIDGE_DEV_API_URL,
      changeOrigin: true,
    },
  },
};
```

Ignore local configuration containing staging credentials. Proxy configuration
is read by Node only, not injected into the browser adapter. Endpoint mappings
are browser-visible: never put secrets in their URLs. A mapping can instead use
`{fixture: {data: [...]}}` for explicitly simulated API data.

For browser-only authenticated development, an endpoint mapping can opt into
`{ url: '/api/countries', bearerSessionKey: 'my-app:access-token' }`.
The consuming app owns its login UI and writes only its access token to that
`sessionStorage` key. ArcBridge reads it for each request and adds a bearer only
to opted-in endpoints; missing tokens fail before fetching. Leave the login
endpoint unmarked. Authenticated URLs require HTTPS (HTTP is allowed only on
loopback), redirects are rejected, and cookies are omitted. Responses from a
changed session are discarded. These mappings and the browser adapter are not
included in mobile HTML; native authentication remains owned by Flutter. Browser
storage is readable by same-origin scripts, so use development accounts.

An endpoint may also opt into SSA-style browser metadata with
`browserHeaders: { AppVersionCode: '1', AppVersionName: '0.1.0' }`. Keep this public
profile in the consuming app's development config (and list a separate profile
file under `devOnly`). Supported overrides are `ApiVersion`, `AppVersionCode`,
`AppVersionName`, `DeviceManufacturer`, `DeviceMarketName`, `DeviceModel`, and
`BiometricType`; values must be printable ASCII strings, at most 256 characters.
Defaults identify a browser rather than native hardware. ArcBridge supplies
`DeviceName`, `OsVersion`, physical viewport `DeviceWidth`/`DeviceHeight`,
`ScreenDensity`, and a random tab-session `DeviceId` at runtime. Endpoints without
this opt-in receive no device metadata. No credentials/arbitrary headers are
accepted through this profile; bearer configuration remains separate. The API's
CORS policy must permit custom headers. Restart the dev server after config
changes. Mobile builds never load the profile or browser implementation.

## Commands

### Development server registry

For multiple backends, group shared configuration by server rather than repeating
full URLs and header settings on every endpoint:

```js
export default {
  servers: {
    kyc: {
      baseUrl: 'https://kyc.example.test/api/v1/',
      browserHeaders: { AppVersionName: '0.1.0' },
      auth: { type: 'bearer', sessionKey: 'my-app:access-token' },
    },
    auth: { baseUrl: 'https://auth.example.test/api/v1/', auth: { type: 'none' } },
  },
  endpoints: {
    kycCountry: { server: 'kyc', path: 'setting/country' },
    login: { server: 'auth', path: 'SSA/loginSSAUser' },
    publicSettings: { server: 'kyc', path: 'public/settings', hasAuthorization: false },
  },
};
```

The contract still defines allowed endpoint methods and parameters. At startup,
the browser-target Vite plugin resolves each server reference into the existing
flat endpoint format; React's HTTP API and bridge payload do not change. Unknown
servers, escaping/absolute endpoint paths, credential-bearing base URLs and
unsupported auth policies fail before the dev server starts. Root-relative proxy
base URLs such as `/api/kyc/` are supported. Direct `{url: ...}` mappings and
explicit fixtures remain compatible, but cannot be mixed into a server-based
endpoint definition. Server auth supports `none` (default) and `bearer` with a
sessionStorage key; an endpoint can disable inherited authorization, not override
the server's URL, profile or credentials. Keep other secret auth schemes in a
Node-side proxy, whose configuration is not serialized to the browser.

This registry and resolver are development/build tooling only. Mobile builds do
not resolve them or import their configuration. Native Flutter endpoint policies
remain independent and authoritative. Add consumer registry files to `devOnly`.

## CLI commands

Run from the consuming app directory, or supply `--root /path/to/app`:

- `arcbridge dev`: browser HTTP, async localStorage Shelf, IndexedDB DAO,
  HMR and explicitly simulated haptics. Sockets/SSE/WebTransport are unavailable.
- `arcbridge build`: mobile-only single `dist/index.html`.
- `arcbridge validate`: audit existing HTML/CSP/identity.
- `arcbridge build --copy`: build, validate and replace configured Flutter HTML.
- `arcbridge build --copy --flutter-assets /path/to/assets/web_bridge`:
  override the local destination.

Build uses controlled Vite configuration rather than loading vite.config.js.
An optional `plugins` array in ArcBridge config adds trusted application plugins;
it must not override protected target/input/output/audit settings. This is trusted
build-time code, not a sandbox against malicious plugins.

Copy requires an existing assets directory beneath a Flutter pubspec.yaml.
It writes only index.html, retains the old file as index.html.previous and leaves
adjacent files untouched. A failed compilation never copies stale dist HTML.
A previous artifact from another app, or unlabelled legacy HTML, is refused.
Review/migrate legacy content manually; the command does not overwrite it silently.
Flutter must be rebuilt/reinstalled after copying. No Git operation is performed.

## Application API

```js
import { bridge, http, shelf, dao } from '@naasa/arcbridge';
const response = await http.get('kycCountry');
await shelf.put('demo.note', 'hello');
const notes = dao.store('notes');
await notes.put('first', { text: 'hello', savedAt: Date.now() });
const note = await notes.get('first');
await bridge.haptics.trigger({ type: 'medium' });
```

HTTP supports get/post/put/patch/delete with named endpoints, queryParams,
pathParams and JSON data. HTTP returns `{ok:true,data}` or
`{ok:false,error:{kind,code,message}}`. Shelf and DAO reject ArcBridgeError
(an alias for the existing SsaError) on failures. No automatic write retries.

Shelf exposes put/get/delete/containsKey/deleteAll. Native allowlists remain
authoritative. Browser data is isolated by app ID/schema version, and protected
keys survive deleteAll. Shelf is not secure storage in browser development.

DAO exposes store(name).get/put/delete/clear. Each store is independent, and values
are JSON objects with finite numbers, depth <=64. Browser DAO uses IndexedDB;
native DAO continues using device Sembast web-prefixed stores. There is no
browser/device data synchronization or generic automatic endpoint cache.

The package preserves the existing native socket facade. Browser sockets report
unavailable; no arbitrary native endpoint authorization is added.

## Errors, limits and resilience

The existing native client correlates request IDs, bounds pending work and rejects
timed-out/disposed requests. Mobile has no browser-network fallback.
Optional React helpers are in `@naasa/arcbridge/react`; React is an optional peer,
not bundled into the SDK. Application error boundaries/global error reporting
remain available. Browser errors cannot invoke a native Retry screen.

Limits mirror the native transport: ordinary requests 8,192 UTF-16 units,
DAO writes 262,144 units, Shelf values 4,096 JSON UTF-8 bytes and HTTP responses
1 MiB UTF-8. Pending ordinary requests: 64; socket cleanup requests: 32.
Browser HTTP streams/bounds responses and aborts on timeout, but a server may
already have processed a request. Quota/IndexedDB failures use sanitized errors.

## Build exclusion and constraints

Mobile never reads the development configuration. The adapter is selected at
module resolution, not by a runtime fallback. Canonical module-graph guards reject
ArcBridge browser modules, the configured dev file and explicit devOnly paths,
including transitive/symlinked imports. Arbitrary consumer development logic must
also be placed behind that boundary; it is not magically stripped.

Final HTML uses exact script/style CSP hashes, blocks web networking, and permits
inlined data images/fonts. Only one HTML is accepted. External resources, public
assets, workers/chunks, inline style/event attributes and remote CSS imports are
unsupported. Runtime CSS-in-JS/eval need deliberate CSP design, not relaxed defaults.
No production sourcemaps or build-time secret injection are enabled by the tool.

## Tests and release

`npm test` runs native contract tests, browser persistence/error tests, controlled
build/copy failure tests, and a real installed-tarball consumer with a working dev
server. Native platform auth, device storage/haptics and lifecycle still require
Android/iOS integration tests. Actual Azure Git installation/publishing requires
the team remote and credentials; it has not been validated against a live Azure repo.
