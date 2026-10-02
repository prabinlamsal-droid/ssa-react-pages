# Implementation ledger
Plan: ../ssa-react-pages/packaging structure.md

A: complete locally — extracted native SDK/facades/socket/resilience, optional React
peer, core declarations, package exports/bin, installed-tarball consumer fixture.
B: complete for HTTP/Shelf/DAO — browser fetch/proxy or explicit HTTP fixtures,
namespaced localStorage, IndexedDB stores, sanitized failures and combined disposal.
Sockets/SSE/WebTransport deliberately unavailable in browser development.
C/D: complete locally — compile-time adapter selection, canonical development-module
guard, protected Vite config, single HTML, final exact CSP hashes, artifact audit.
E: complete locally — explicit staged validated copy with identity checks, backups
and source/destination hashes. Tested against temporary Flutter-layout fixtures.
F: consumer migrated; Azure publication and Android/iOS integration remain pending.
The existing Flutter market asset has NOT been replaced by the older demo.

Pre-flight: facades retain native envelopes. Dev CLI alone loads dev configuration;
copy receives only fresh audited bytes. Contract field policies stay app-owned.

Ruling: ship ready-to-run ESM instead of duplicated dist JS; npm/Git installs need
no prepare step. Cost: future TypeScript implementation needs release compilation.
Ruling: new sibling repo provides isolation; approved migration continued in the
existing consumer checkout after the optional workspace preference had no reply.
Cost: package and consumer changes require joint review.
Ruling: Azure release, native device integration and market-asset replacement remain
explicitly deferred — remote/source reconciliation are missing and no native
changes were needed. Cost: mobile integration is not yet demonstrated for packaging.

Final review: independent read-only reviewer found DAO naming/delete-result parity,
HTTP argument parity, pagehide resource disposal and fixture size-budget issues.
Fixed with regression tests. Output symlink/CSP validation and protected plugin
config were also tested and hardened. Browser API offline/timeout codes now match
native cache expectations. Local development config is ignored.

Final verification:
- ArcBridge npm test: 18/18 passed (installed consumer, browser transport and persistence,
  mobile builds, graph exclusion, CSP mutation, failure-preserving copy).
- ssa-react-pages npm test: 48/48 passed; npm run validate:mobile passed.
- Actual consumer dev server smoke check: root HTML + browser fixture configuration
  served successfully without Flutter. No interactive browser/mobile UI test claimed.
- git diff --check: clean in consumer and package.
- Installed snapshot refreshed by uninstalling/reinstalling only the local dependency.

Final: minor (deferred): React crash fallback still uses native SSA Retry/tab wording
in browser development. Error containment works, but browser-specific wording awaits
a separate UI polish change.

Current output: ../ssa-react-pages/dist/index.html (mobile-only demo, not copied).
No commit, Git push, Azure publishing, Flutter rebuild or device install performed.
