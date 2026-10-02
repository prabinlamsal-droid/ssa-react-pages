# ArcBridge: initial packaging structure and implementation plan

Date: 2026-10-02

Status: initial local implementation available in ../arcbridge and integrated into
this consumer. Browser HTTP/Shelf/DAO and guarded build/copy commands are implemented.
Azure publication, native device integration and replacing Flutter's newer market
asset remain pending. See ../arcbridge/IMPLEMENTATION.md for verification and limits.

## 1. Goal and requirements

ArcBridge will be an installable JavaScript package that a web application uses
for native capabilities and for building its mobile-delivered HTML artifact.
The same application service/repository code should work during browser
development and when bundled inside Flutter.

The user requirements are:

1. Develop and test web features without running Flutter. Use browser networking
   and device-local browser persistence during that workflow.
2. Exclude ArcBridge's development adapters and development configuration from
   the generated mobile HTML, rather than leaving them present but inactive.
3. Install ArcBridge through a private Azure remote dependency. Build the
   consuming application's source, not a demo shipped with ArcBridge.
4. Provide a command that builds HTML and copies it into a configured local
   Flutter asset directory. Developers then commit/push through the Flutter
   repository themselves.
5. The deployed web feature remains a mobile HTML artifact. Browser development
   is a development convenience, not a separately deployed production website.

This document records the approved design; the implementation ledger distinguishes
completed local workflow from remaining publication/mobile integration work.

## 2. Initial scope and assumptions

- Initial consumer: the React/Vite application in `ssa-react-pages`.
- Initial output: one self-contained `index.html` containing that application's
  pages, selected with hash routing where needed. Multiple screens do not
  require separate HTML files.
- Initial package name: `@naasa/arcbridge`; public brand/CLI: `ArcBridge` /
  `arcbridge`. The name is a proposal, not an existing Azure package.
- Initial installation: an Azure Repos Git URL pinned to a release commit.
  Azure Artifacts is a later distribution option with the same public API.
- Initial supported toolchain: the currently tested Vite 7 family and its
  supported Node versions. Declare and test the supported range; do not silently
  float to a new Vite major.
- Browser development implements HTTP, Shelf and DAO first. Existing native
  market sockets need an explicitly configured browser adapter or fixtures;
  native-only effects get clearly labeled development simulations.
- SSE and actual WebTransport remain separate transport work. Packaging makes
  room for adapters without claiming those capabilities already exist.
- No backend, remote HTML deployment, automatic Git operation or server-driven
  manifest system is needed for this local packaging workflow.

Browser development can cover UI, repositories, validation, caching and API
flows. Native token handling, encryption, secure storage, lifecycle and platform
behavior still require mobile integration testing.

## 3. Architecture decision

Use one package with a shared public SDK, separate mobile/browser adapters, a
Node CLI, and a Vite plugin. Select the adapter while resolving the module graph.

```text
Consumer application's pages / services / repositories
                         |
             @naasa/arcbridge public API
                         |
                Shared facade + contracts
                         |
          +--------------+----------------+
          |                               |
 arcbridge dev                    arcbridge build
 browser adapter                  mobile adapter only
          |                               |
 fetch + browser persistence       Flutter JS bridge
          |                               |
 development API / fixtures        native HTTP / Shelf / DAO / socket

 arcbridge build -> inline HTML -> validate -> dist/index.html
 arcbridge build --copy -> validated HTML -> configured Flutter asset
```

Alternatives considered:

| Approach | Trade-off | Decision |
| --- | --- | --- |
| One package with compile-time adapter resolution | Shared contracts, one dependency, explicit bundle exclusion | Recommended initially. |
| Separate runtime and development packages | Strong distribution boundary, but more versions and consumer setup | Consider if release size or independent development tooling warrants it. |
| Runtime `if (window.SsaNative) ... else fetch(...)` | Easy initially, but development code can remain in mobile output and missing native support silently changes behavior | Reject for this requirement. |

The mobile adapter always requires the native bridge. An absent/incompatible
bridge is an explicit error, not permission to start browser networking.

## 4. Repository ownership and package structure

Create a separate ArcBridge repository beside the consumer and Flutter repos:

```text
Office/
  arcbridge/                    # Reusable SDK, adapters, CLI and plugin
  ssa-react-pages/               # Actual application and consumer config
  Naasa-X-Self-Service/          # Flutter host, native services and HTML asset
```

Proposed ArcBridge layout:

```text
arcbridge/
  package.json
  src/
    index.ts                    # Public bridge facade and compatibility export
    errors.ts                   # Shared error codes and safe messages
    contracts/                  # JSON validation, limits and transport contracts
    facade/
      http.ts
      shelf.ts
      dao.ts
      socket.ts
    adapters/
      mobile/                   # Native request/event messaging only
      browser/                  # Development-only fetch and persistence
        http.ts
        shelf.ts
        dao.ts
        capabilities.ts
    react/
      resilience.tsx            # Optional React boundary/helpers
    cli/
      index.ts                  # dev / build / validate commands
      config.ts                 # Consumer-root/config resolution
      copy.ts                   # Explicit, bounded asset publication
    vite/
      plugin.ts                 # Adapter resolution and guarded config
      inline.ts                 # Single-file integration
      csp.ts                    # Final inline script/style hashes
      audit.ts                  # Module graph and artifact validation
  tests/
    contracts/
    adapters/
    cli/
    fixtures/consumer-app/      # Installed-package consumer tests
  dist/                         # Compiled package code, not consumer HTML
  README.md
  package-lock.json
```

Keep the core framework-neutral. React is an optional peer for the React
subpath, not a second React bundled into the consuming application. Applications
own their repositories, endpoint-specific services, models and cache policies.
The countries demo and its repositories do not move into the package.

Proposed exports:

- `@naasa/arcbridge`: runtime facade (`bridge`, `http`, `shelf`, `dao`, errors).
- `@naasa/arcbridge/react`: optional error boundary and integration helpers.
- `@naasa/arcbridge/vite`: Node-side plugin for supported custom Vite workflows.
- `@naasa/arcbridge/config`: Node-side config helper/types.
- `arcbridge`: executable declared through `package.json`'s `bin` field.

Browser adapter files may be distributed in the npm package because development
needs them. They must be absent from the consumer's **mobile HTML bundle**.
Node CLI/plugin code must likewise remain outside that runtime bundle.

## 5. Stable application API and adapter contract

Application code imports the same APIs in both modes:

```js
import { http, shelf, dao } from '@naasa/arcbridge';

const result = await http.get('kycCountry');
await shelf.put('demo.note', 'Hello');
const countries = dao.store('countries');
await countries.put('cache', { data: [], savedAt: Date.now() });
```

Preserve existing observable behavior: HTTP returns the existing success/failure
union; Shelf/DAO operation failures reject with the shared error type. JSON
validation, limits, capability checks, defaults, and disposal semantics belong
in shared contracts where practical.

Use a private adapter interface conceptually equivalent to:

```ts
interface BridgeAdapter {
  request(method: string, params: JsonObject): Promise<JsonValue>;
  subscribeEvents(listener: (event: BridgeEvent) => void): () => void;
  dispose(): void;
}
```

The mobile implementation preserves native request IDs, deadlines, event
routing and sanitized failures. The browser implementation resolves named
operations to development services. Applications do not scatter environment
checks or direct `fetch`/storage calls through their repositories.

Retain an `ssa` compatibility alias during migration if needed. New package
contracts use generic ArcBridge naming; the native protocol can retain its
current method names without a Flutter-wide rename.

## 6. Browser development behavior

### HTTP

Use browser `fetch`, or a same-origin development proxy where CORS/authentication
requires it. A local configuration maps approved endpoint identifiers to
development base URLs, paths, methods and auth setup.

Keep these concepts separate:

- Shared endpoint contract: names, allowed arguments and supported methods.
- Browser development mapping: URLs, proxy routes and development auth.
- Flutter endpoint policy: native-owned URLs, credentials and allowlists.

Native endpoint policy remains authoritative for mobile. Browser configuration
does not add permissions to Flutter. Use contract/version checks and integration
tests to detect drift; development success alone cannot establish native support.

The browser HTTP adapter normalizes successful JSON and API/network failures
into the existing facade result contract. It preserves native-sized transfer
budgets for parity, uses its own abort controller for browser timeouts, and
adds no automatic write retries. Cancellation in the browser does not prove a
server-side operation was cancelled; the existing ambiguous-timeout warning
still applies.

Prefer mock/staging API data. Native token refresh, encrypted trading fields
and special request headers must be explicitly simulated or provided by an
approved development proxy; `fetch` cannot reproduce them automatically.

Development secrets belong in the Node proxy's local environment, not a
`VITE_*` variable or a client module. A browser-injected token is visible to the
developer/browser and must be treated as a development credential.

### Shelf and DAO

- Shelf: asynchronous facade backed by browser `localStorage`; preserve absent
  values, default reads, typed values, delete return values and protected-key
  semantics. Catch quota/unavailable-storage errors.
- DAO: asynchronous JSON records in IndexedDB; maintain independent logical
  stores and atomic record writes. Keep the same JSON/depth/value validation
  and record transfer budgets as mobile.
- Namespace development persistence by app ID and schema version. Clearing a
  development store must not clear unrelated applications on the same origin.
- Browser namespacing is development isolation; native Shelf keys still follow
  the existing shared Flutter key rules. Native DAO stores retain `web.` naming.
- No automatic migration/synchronization between browser storage and the
  device's Shelf/Sembast. They are separate test environments.
- Cache freshness, pagination and offline fallback remain application repository
  decisions. ArcBridge supplies persistence rather than caching every endpoint.

Use IndexedDB for larger DAO records rather than forcing them into synchronous
`localStorage`. Browser storage is not a secure-storage substitute; use test data.

### Other capabilities and resilience

Expose capability metadata distinguishing implemented, simulated and unavailable
features. A haptic simulation can report an invocation in a development panel,
but must not pretend that native physical feedback was verified.

Browser error handling retains the React fallback and pending-call disposal.
Its failure reporter handles the absence of Flutter explicitly; browser-dev
resilience does not try to display a native Retry screen. The development
panel and mocks are excluded from mobile builds too.

For the existing socket API, first support fixtures with the same events and
close semantics. A real browser WebSocket adapter requires a separate approved
endpoint/auth mapping because browsers cannot freely set native socket headers.
Unimplemented socket/SSE/WebTransport operations report unavailable rather than
fabricate successful live connections. HTTP/DAO/Shelf form the first complete
development workflow.

## 7. Consumer configuration and caller discovery

ArcBridge does not need to guess which application called it. The CLI uses
`process.cwd()` as the consumer root, or an explicit `--root` directory, then
loads that root's `package.json` and `arcbridge.config.mjs`. Package-relative
paths are reserved for ArcBridge's own implementation files.

Resolve entry/output/config paths relative to the configuration directory.
Never resolve the consumer entry from ArcBridge's `node_modules` directory.
In workspaces, require running in the app directory or specifying `--root`;
do not guess an application by walking into arbitrary sibling directories.

Proposed committed config in the consumer:

```js
import { defineConfig } from '@naasa/arcbridge/config';

export default defineConfig({
  appId: 'ssa-react-pages',
  htmlEntry: './index.html',
  outputDirectory: './dist',
  outputFile: 'index.html',
  contractFile: './arcbridge.contract.json',
  browserDevelopmentConfig: './arcbridge.dev.local.mjs',
  flutter: {
    assetDirectory: '../Naasa-X-Self-Service/packages/naasa_x/assets/web_bridge',
  },
});
```

The example describes the proposed schema, not currently available exports.
The application contract contains public endpoint/capability definitions and
schema/version information; it contains no development URLs or credentials.

`arcbridge.dev.local.mjs` supplies local API mappings and proxy configuration.
Ignore it in Git and provide a sanitized example. Load it only for
`arcbridge dev`. A mobile build must succeed even if this file is absent and
must not execute or import it.

Allow a local ignored config override or `--flutter-assets <path>` for each
developer's checkout location. A `--copy` invocation resolves and prints the
exact destination. The app ID provides artifact/persistence identity; it is
not an authorization mechanism or a replacement for native origin checks.

## 8. Compile-time exclusion of development code

The shared SDK imports a private adapter module that ArcBridge's plugin resolves
to exactly one implementation:

- `arcbridge dev`: resolve to browser-development adapter modules.
- `arcbridge build`: resolve to mobile adapter modules, regardless of ordinary
  Vite mode names. There is no browser-target option on the mobile build command.
- Previewing built HTML uses the mobile adapter and fails without native
  transport. It is not a substitute for the browser-development command.

Ordinary ESM consumers default to the mobile entry; the supported dev CLI/plugin
explicitly supplies browser resolution. Do not rely solely on an npm export
condition named `development`, since Vite mode and custom conditions can differ.
Do not dynamically import a browser fallback from the mobile entry.

Enforce separation using all of the following:

1. Separate source modules; mobile modules never import browser/CLI code.
2. An import-graph guard that fails a mobile build on browser adapters, mock
   panels, local dev config, or the package's dev-only modules, including
   transitive imports and normalized/symlinked package paths.
3. Reject direct consumer imports of private browser modules in mobile builds.
4. Test final output with distinctive development fixture/secret markers and
   known module identifiers. Text scanning is supplementary, not the sole proof.
5. Check that the runtime can only access native services and that production
   CSP blocks direct web connections.

Tree-shaking is helpful but not the guarantee. Removing an unused branch does
not prove a transitive module or development configuration was excluded.

The guarantee covers ArcBridge's development resources. Applications must also
follow the public SDK boundary: arbitrary development code or direct `fetch`
written in the application is not magically removed by ArcBridge. Build checks,
application lint rules and CSP complement package separation.

## 9. Consumer build and local Flutter asset propagation

Proposed application scripts:

```json
{
  "scripts": {
    "dev": "arcbridge dev",
    "build": "arcbridge build",
    "build:mobile": "arcbridge build --copy",
    "validate:mobile": "arcbridge validate"
  }
}
```

The CLI calls Vite's programmatic API with an explicit consumer root and
controlled configuration. Initial CLI behavior uses ArcBridge's generated
Vite configuration; it does not silently merge an arbitrary consumer
`vite.config.*` file. Provide a documented extension point for app plugins,
while prohibiting overrides of adapter target, CSP/audit order, inputs and
output ownership. Existing Vite consumers can use the exported plugin only
under the same guarded contract.

Build steps:

1. Load/validate common config and public contract; never load dev config.
2. Resolve the mobile module graph and compile the consumer application.
3. Inline JS, CSS and supported static images/fonts into the single HTML.
4. Add non-secret app/protocol/package-version metadata to the document.
5. Audit the final artifact: only the expected HTML, no network assets or
   remaining code splits/workers, no dev modules or dev fixture markers.
6. Calculate CSP hashes after final inline content is complete. Preserve the
   restrictive networking policy; nothing may mutate inline scripts/styles
   after hashing.
7. Verify the final CSP and file layout; publish validated `dist/index.html`.
8. For `--copy`, publish that exact validated file to the configured asset
   directory and verify source/destination hashes match.

Use a staging directory so failed builds do not expose a partial artifact or
overwrite Flutter's last working HTML. Stale `dist/index.html` is never copied
after a failed build. Use a temporary file in the destination directory followed
by atomic replacement where supported, and keep a recoverable prior version
when replacing an existing HTML. Do not recursively delete an asset directory.

Validate canonical target paths, including symlinks. Require an explicit asset
directory; reject a root directory or workspace/repo root. Confirm the directory
exists and is the intended Flutter asset location. Initial copy owns only the
configured output filename, not all files in that directory. Check prior app ID
metadata and fail on a conflicting application's artifact.

The committed file must remain the configured filename; for SSA, Flutter already
loads `assets/web_bridge/index.html` and includes the directory in its asset
bundle. Copying HTML does not refresh an installed app: rebuild/reinstall Flutter
to test it. The command does not change native code, asset registration or Git
history. Developers review, commit and push the copied file themselves.

Optional hash/build reports stay outside the mobile artifact directory unless
explicitly configured. No remote manifest server is part of this plan.

## 10. Supported input and output constraints

Initial production output is one HTML. Use one app/router for several screens;
hash routes are appropriate for the existing virtual-origin/loadData host.
Multiple HTML entrypoints are deferred until an actual consumer needs them;
their output mapping and Flutter navigation must then be explicitly defined.

Fail clearly for unsupported resources rather than leave broken external links:
external script/style URLs, remote fonts/images, unbundled public assets,
WebWorkers, or unresolved lazy chunks. Resolve and inspect HTML/CSS asset
references, not just script/link tags. Data URLs for supported images/fonts can
be permitted by the chosen CSP.

Apps must use styles compatible with the strict CSP. Inline style attributes,
runtime CSS-in-JS insertion and libraries requiring `eval` are not automatically
covered by static script/style hashes. Document the supported styling pattern
and fail/report incompatible usage; do not silently loosen CSP to hide it.

Keep development HMR/proxy networking available in `arcbridge dev`; mobile CSP
is applied only to the final mobile build. Development URLs and local filesystem
paths are not embedded into that output. Disable production sourcemaps by
default; separate diagnostic maps, if needed, are not copied into Flutter assets.

## 11. Azure installation and release contract

Illustrative Git dependency (replace organization/project/repository/commit):

```json
{
  "dependencies": {
    "@naasa/arcbridge": "git+https://dev.azure.com/ORG/PROJECT/_git/arcbridge#RELEASE_COMMIT"
  }
}
```

Pin the resolved commit and commit the consumer lockfile. Use the team's normal
Git credential mechanism; do not put a PAT into `package.json` or the URL.

For Git installation, package metadata must be at the repository root. Release
commits include compiled `dist` exports and the executable CLI. This avoids
requiring each consuming installation to compile ArcBridge through `prepare`.
Package builds happen in the release workflow, where source/dist consistency
is verified before tagging the release commit.

Declare package exports, `bin`, `files`, Node engine range, supported Vite range,
runtime/tooling dependencies and optional React peer requirements. Shipping
compiled adapters in the npm package is compatible with excluding browser code
from the final application HTML. Publish no developer `.env` or local config.

Test both an installed tarball and the pinned Git dependency in a fresh consumer
checkout. Tests against a source alias alone cannot prove the published package
contains all exports or resolves caller paths correctly.

If Azure Artifacts is chosen instead, publish a versioned npm package and
configure a scoped registry through `.npmrc`, with user/CI credentials stored
separately. A feed URL and an Azure Repos Git URL are different installation
mechanisms. No feed, actual remote, release credentials or publication is assumed
to exist yet.

## 12. Migration from the current implementation

1. Record the existing protocol, public facades, payload limits and error
   behavior as contract fixtures before extraction.
2. Move reusable JS client, HTTP/Shelf/DAO/socket facades and resilience helpers
   into ArcBridge. Preserve behavior and leave feature repositories in the app.
3. Extract single-file/CSP tooling into the package with final-artifact auditing.
4. Add browser adapters and local-only configuration without changing native
   Flutter URL/auth/storage ownership.
5. Install ArcBridge into a sample consuming app using a packaged artifact.
6. Replace local bridge imports in `ssa-react-pages` and use ArcBridge scripts.
7. Resolve the existing mismatch between this demo source and the newer market
   HTML in Flutter before copying a new consumer build over that asset.
8. Configure the intended Flutter destination, run the build/copy workflow,
   and test the correct consumer application's HTML in the native host.

Do not copy the countries/demo UI into the package as its default application.
Do not rewrite or delete unrelated consumer edits during extraction.

## 13. Implementation work packages and exit criteria

### A. Extract the package and preserve the native contract

Deliver package exports/CLI scaffolding, framework-neutral facades, optional
React helpers, declarations and an installed-package fixture. Existing mobile
success/failure behavior and capability discovery continue to pass tests.

### B. Implement browser HTTP, Shelf and DAO

Deliver local endpoint/proxy config, normalized HTTP results, namespaced Shelf,
IndexedDB records and explicit simulation metadata. Test missing keys, empty
values, delete/clear isolation, persistence across refresh, quota/storage
failures, invalid JSON, API failures, and timeout/disposal behavior. Browser
development must not need a Flutter checkout to start.

### C. Enforce mobile-only compilation

Deliver adapter resolution and module-graph guards. A fixture that imports a
browser adapter transitively must fail mobile compilation. A missing native
transport must produce an explicit bridge error without invoking `fetch`,
localStorage or IndexedDB fallback. Dev config may be absent, or deliberately
throw if loaded, and mobile build must still pass.

### D. Generate and audit consumer HTML

Deliver a single-file build, final CSP verification and deterministic entry
resolution. Test two consumer fixtures with different app IDs/UI content from
different working directories, proving each output contains its own app and
no package demo. Test CSS/assets, unsupported lazy/external resources,
production sourcemap exclusion and development sentinel absence.

### E. Add explicit Flutter copy

Deliver validated config/CLI path resolution, staging, bounded replacement and
hash comparison. Test paths with spaces, relative and absolute destinations,
missing directories, symlinks, wrong-app artifacts, permissions and failed
builds. A failed build/copy must preserve the prior Flutter HTML; adjacent
assets must remain untouched. Build without `--copy` must not write to Flutter.

### F. Migrate, document and release

Migrate the intended consumer source, verify browser feature flows, rebuild its
mobile HTML, and validate Android/iOS native HTTP/storage/DAO behavior. Release
the package to the actual Azure remote only after its location/access and
installation route are supplied. Developers can then build/copy and commit the
updated Flutter asset through their existing workflow.

## 14. Acceptance checklist

- [ ] One consumer code path calls the same public HTTP/Shelf/DAO APIs in both modes.
- [ ] Browser development works without Flutter, including persistence and API flows.
- [ ] Simulated/unavailable native capabilities are identified honestly.
- [ ] Mobile output has no ArcBridge development adapters, panel, mocks or dev config.
- [ ] Missing native transport never activates browser fallback in mobile output.
- [ ] The package builds the calling app identified by root/config, not its own source.
- [ ] Installed Azure-compatible package exports and CLI work in a fresh consumer.
- [ ] The generated HTML is self-contained and has verified final CSP hashes.
- [ ] Configured copy writes only the intended validated artifact and preserves prior output on failure.
- [ ] Browser data, native device data and Git operations have explicit ownership.
- [ ] Correct consumer source is synchronized before updating Flutter's market asset.
- [ ] Mobile integration checks cover behavior that browser adapters cannot reproduce.

## 15. Evidence and implementation references

Current consumer files inspected: `src/ssa.js`, `src/http.js`, `src/shelf.js`,
`src/dao.js`, `src/socket.js`, `src/resilience.js`, `vite.config.js`, and
`build/bridgeCsp.js`. Current Flutter asset contract:
`packages/naasa_x/lib/features/web_bridge/bridge_config.dart` in the sibling repo.

Vite supports programmatic server/build APIs and plugin module resolution; the
CLI design applies them with explicit consumer roots and controlled inputs.
See [Vite JavaScript API](https://vite.dev/guide/api-javascript.html) and
[Vite plugin API](https://vite.dev/guide/api-plugin).

The proposed package executable and Git install route follow npm's `bin`,
package-file and Git-dependency mechanisms. See
[npm package.json documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/).

Azure Artifacts uses npm registry/feed configuration rather than a Git dependency
URL. See [Azure npm feed configuration](https://learn.microsoft.com/en-us/azure/devops/artifacts/npm/npmrc?view=azure-devops).
