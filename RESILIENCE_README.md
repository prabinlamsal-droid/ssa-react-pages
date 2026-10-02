# Bridge resilience: React and Flutter

This document explains the resilience implemented in the React source and the
sibling Flutter host. Its purpose is to contain a failed web feature, settle
pending JavaScript requests, and keep native navigation and recovery usable.

It is not a guarantee that the mobile process can survive every failure. The OS
can kill the app, and memory exhaustion or native engine/plugin crashes can
affect the whole process.

The current Flutter HTML asset comes from a different, newer market UI build
than this React checkout. Source-level resilience described here is available
in this checkout; verifying a shipped app also requires checking which HTML
was actually bundled. Do not replace the newer market UI with the older demo
just to obtain this code: integrate the changes into the intended web source.

## 1. Two kinds of error

An operation failing is different from the page becoming unusable.

| Situation | Expected handling |
| --- | --- |
| API/network/authentication failure | Return an HTTP failure result and let the feature show an appropriate message. |
| Invalid storage/DAO arguments, unavailable capability, or native operation failure | Reject that bridge call with a `SsaError`; the feature catches it. |
| Timeout | Settle the waiting JavaScript call with `TIMEOUT`. Native work might still finish. |
| Uncaught runtime exception, unhandled promise rejection, or React render failure | Latch the web page as failed, report a category, close its bridge client, and show recovery UI. |
| Renderer termination, main-frame load failure, or startup deadline | Flutter fails the web session and shows its native Retry screen. |

A rejected promise that the feature catches remains an ordinary operation
error. Leaving it unhandled can trigger the page-wide failure path. The global
handler cannot reliably decide whether an unhandled rejection was harmless.

## 2. What React does

### Detect and contain a broken page

[`src/resilience.js`](src/resilience.js) provides two cooperating pieces:

- `WebErrorBoundary` catches render/lifecycle failures in its descendant React
  tree and replaces that tree with a safe error message.
- `createWebResilience` listens for window `error` and `unhandledrejection`
  events. This covers failures outside React rendering, including uncaught
  event-handler exceptions and unhandled asynchronous failures. Captured
  resource-load errors whose target is an image/style element are ignored.

[`src/main.jsx`](src/main.jsx) creates the runtime, wraps the app in the boundary,
and catches synchronous bootstrap setup failures. It also acknowledges
`bridge.ready` after React commits the capability-handshake result. This does
not prove that pixels were physically painted.

The first fatal failure wins. `runtime.fail(kind)`:

1. Records a terminal failure for this document.
2. Attempts to send `bridge.failed` with only `render`, `runtime`,
   `unhandled-rejection`, or `bootstrap`.
3. Disposes the bridge client, rejecting pending calls and stopping new calls.
4. Notifies the boundary so it can display the fallback if React still works.

Reporting is best effort. Reporting/listener failures are caught so they do not
create another failure loop. Exception messages, stacks, bodies and credentials
are not included in the crash-report payload. This does not mean browser
developer consoles or every other native log are automatically sanitized.

An error boundary does not catch every asynchronous failure. The global
listeners complement it; neither can run if JavaScript itself is hung or its
renderer has died. Script parse/import failures before initialization are also
outside this boundary. Flutter's startup deadline is the fallback for a page
that never acknowledges readiness.

### Settle requests predictably

[`src/ssa.js`](src/ssa.js) tracks pending requests by ID and gives them deadlines:

- Normal bridge operations: 5 seconds.
- HTTP operations: 120 seconds.
- At most 64 ordinary pending calls, plus 1 crash-report slot and 32 socket
  unsubscribe slots. The reserved slots keep failure reporting and cleanup
  available when ordinary requests fill their pool.

Missing transport produces `BRIDGE_UNAVAILABLE`; a disposed client produces
`DISPOSED`; a full request pool produces `BUSY`. Serialization/posting failures
produce `TRANSPORT_ERROR`. An oversized request produces `PAYLOAD_TOO_LARGE`
before it is posted.

Unreadable responses or responses without a usable matching ID are ignored;
the waiting call eventually times out. A matching response with an invalid
success/error envelope rejects immediately with `INVALID_RESPONSE`. Responses
for expired or already-disposed requests are ignored.

Disposal removes listeners, clears timers, rejects pending calls, and attempts
socket subscription cleanup. It also happens on `pagehide`. Rejecting a promise
does **not** cancel an operation already executing in Flutter.

### Handle expected failures in features

Storage/DAO/haptic calls use rejected promises:

```js
try {
  await shelf.put('demo.note', 'Hello');
} catch (error) {
  // Show a feature-level message using error.code/error.message.
  // Do not automatically repeat a write after TIMEOUT.
}
```

[`src/http.js`](src/http.js) translates `SsaError` into a result union:

```js
const result = await http.get('kycCountry');
if (result.ok) {
  // Use result.data.
} else {
  // result.error.kind is 'api' or 'bridge'; display/handle the failure.
}
```

Unexpected programming exceptions still propagate from this HTTP wrapper;
they are not disguised as API failures. Feature parsing and cache policy live
in the React service/repository layer. The resilience layer does not write
caches or select cached results.

## 3. What Flutter does

Native paths below are relative to the sibling `Naasa-X-Self-Service` repository.

### Validate and contain each bridge operation

`packages/naasa_x/lib/features/web_bridge/ssa_bridge.dart` validates protocol
version, ID, method, parameter shape, transfer size and available capabilities.
It requires handler results to be JSON serializable. Expected `BridgeException`
errors retain their reviewed code/message; unexpected exceptions become a safe
`NATIVE_OPERATION_FAILED` response. Platform failures are also mapped to safe
responses. Native HTTP and DAO adapters have additional validation and error
mapping.

Ordinary non-HTTP operations share one busy slot. HTTP permits four concurrent
operations independently. Readiness/failure messages and socket registration/
cleanup commands bypass that busy slot. Socket subscriptions have their own
limit of 32 and do not occupy the slot for their lifetime.

`bridge_session.dart` accepts messages only from the trusted origin and main
frame. It tracks document generations so a previous document's late operation
reply is not delivered to a replacement document. Reply delivery exceptions
are caught. Invalid raw JSON yields an uncorrelated failure; because it has no
usable request ID, a JavaScript waiter will generally time out rather than
receive a matching rejection.

### Fail only the web session and offer recovery

`bridge_health.dart` starts a 20-second readiness deadline. Repeated load events
cannot indefinitely extend a running deadline. Readiness cancels the timer.
Failure latches: late readiness cannot revive that session.

`bridge_session.dart` detects web crash reports, Android renderer termination/
unresponsiveness, iOS content-process termination, main-frame load/HTTP failures,
setup failures, and controller failures during back navigation. Optional
subresource failures do not themselves fail the whole page.

On terminal failure the host invalidates replies, releases web socket
subscriptions, detaches the failed WebView and attempts resource cleanup.
Cleanup steps have independent guards and five-second timeouts so one failing
step does not skip all the others. A timeout bounds how long the host waits;
it does not guarantee a stuck plugin operation has actually stopped.

`bridge_page.dart` displays `BridgeFailureView`, a native recovery UI outside the
web renderer. Retry creates a fresh web session. It does not replay pending
business requests, clear stored data, or log the user out. Users are warned that
an action already submitted might have completed.

This implementation did not add `runZonedGuarded` or replace global
`FlutterError`/`PlatformDispatcher` handlers. It uses local guards around the
web feature. A Dart zone would not catch JavaScript exceptions inside the
WebView; those need the web report/native renderer callbacks described above.

There is no ongoing heartbeat. A page that hangs after readiness is detected
where the platform supplies an unresponsive-renderer callback; detection is
not guaranteed on every platform. Background/preloaded WebViews can throttle
JavaScript, which makes a naive heartbeat prone to false failures.

## 4. Size limits: actual units and failure behavior

These are application policies, not documented WebView maximums. All sizes are
measured after JSON serialization. Request-envelope limits include the ID,
method, parameters, field names and JSON punctuation; the entire budget is not
available for the business value alone.

**Not every limit is measured in bytes.** JavaScript string `.length` and Dart
string `.length` count UTF-16 code units. UTF-8 byte checks explicitly encode
the JSON text. For ASCII these counts usually match; Unicode can require more
UTF-8 bytes. A Nepali character commonly uses one UTF-16 unit but three UTF-8
bytes. JSON escaping can also affect serialized size.

| What is limited | Current value/unit | Enforcement and outcome |
| --- | --- | --- |
| Ordinary request envelope | 8,192 UTF-16 units | JS rejects before posting; Dart dispatcher rejects with `PAYLOAD_TOO_LARGE` before invoking the handler. |
| `dao.put` request envelope | 262,144 UTF-16 units | Same checks, with a larger budget for JSON records. |
| Raw incoming native message | 262,144 UTF-16 units | WebView listener silently drops larger messages; a normal waiter times out. Direct `dispatchJson` calls above this cap return `INVALID_JSON` with no ID. |
| DAO write parameters / returned record | 262,144 UTF-16 units | Native DAO rejects with `PAYLOAD_TOO_LARGE`; write-envelope checking is an additional, usually tighter constraint. Read size is checked after fetching the record. |
| Shelf value | 4,096 UTF-8 bytes | Native storage rejects oversized/type-invalid values with `INVALID_ARGUMENT`; it does not write the value. |
| Normalized HTTP result | 1,048,576 UTF-8 bytes (1 MiB) | Native HTTP bridge rejects with `PAYLOAD_TOO_LARGE` before transferring the result to JS. The outer bridge envelope is additional. |
| Socket event data | 65,536 UTF-8 bytes (64 KiB) | Native socket adapter substitutes a small `PAYLOAD_TOO_LARGE` error event for the oversized data; subscription remains registered. |

There is no universal result-size cap in the dispatcher: HTTP, DAO, Shelf and
socket adapters supply their own policies. New capabilities need to choose and
enforce their own result budgets.

DAO values also have a maximum nesting depth of 64 and must contain valid JSON
types and finite numbers. This reduces unsafe/expensive recursive traversal; it
is a separate restriction from serialized size.

### Why have these limits?

Bridge data travels through several representations: a JavaScript object,
serialized text, platform/plugin messaging, a Dart object, and sometimes the
same journey in reverse. Large values increase copying, allocation, parsing,
serialization and UI work. Multiple concurrent calls multiply the pressure.

The limits bound accepted work and catch mistakes such as sending a whole
dataset, an image as base64, or a much larger response than a feature expects.
They complement concurrency limits, deadlines, validation and socket queue
coalescing. They do not replace those mechanisms.

There are limits to this protection. JS/Dart serialize before checking length;
native HTTP downloads/parses a response before the bridge response check; DAO
reads fetch a record before measuring it. Therefore these checks do not cap all
upstream memory or processing. The raw-message check avoids parsing an
oversized inbound message, but the platform has already delivered its text.

### Where did the exact numbers come from?

The inspected code, design documents and implementation history record these
budgets, but do not record device benchmarks or a formula proving these exact
thresholds. Treat them as engineer-selected initial defaults, not measured
maximums or guarantees.

The intended sizing rationale is: small budgets for settings/control calls,
a larger budget for device JSON cache records, and a larger response budget for
API datasets. The socket budget is a later addition for individual market
updates. The round, power-of-two values are convenient policy budgets; their
exact values are tunable. This rationale explains their purpose, not evidence
that the specific numbers are optimal.

Before increasing a budget, measure realistic serialized payloads (including
Unicode and envelopes), expected concurrent calls, memory and UI latency on
lower-memory Android/iOS devices. Prefer pagination, smaller records, or native
file handles for large data. Update JS/native limits together and verify both
boundary and oversized cases. A consistent UTF-8 unit policy would also be a
useful future improvement; it is not implemented across all current checks.

### What if we remove them?

Small valid calls would continue working. Oversized input would be allowed to
consume much more memory/CPU and cross the bridge until some lower layer failed.
Possible outcomes include UI stalls, renderer termination, plugin transfer
errors and memory exhaustion affecting the app. None is inevitable for every
large payload, but failure becomes less bounded and less predictable.

A timeout alone does not solve that problem: it can reject the JS promise while
native serialization, network work or allocations continue. Likewise, limiting
request count does not bound the size of each request. Use both.

## 5. Retry, caching and socket behavior

The JS facade and this resilience layer do not automatically retry HTTP/storage
writes. The native `ApiService` may still apply its existing authentication or
resilience retry rules. A bridge timeout means **the outcome is unknown**, not
that the server/device rejected the action. Check status before submitting an
order, payment or other side effect again.

The socket addition contains callback exceptions, suppresses late/duplicate
events, bounds subscription count, and replaces pending market ticks with the
latest value per subscription when delivery is slow. It reuses native reconnect
behavior and does not provide lossless replay or automatically persist updates.
Its cleanup runs on client/session disposal and account changes. These are
later socket protections, separate from the original fatal-page layer.

## 6. Verification and remaining device checks

`src/resilience.test.js` covers single-report behavior, safe fallback output,
reporting before disposal, pending request settlement, malformed replies and
reserved crash-report capacity. Other JS bridge tests cover timeouts, disposal,
socket cleanup and CSP build validation.

Flutter's `test/features/web_bridge/bridge_resilience_test.dart` covers startup
deadlines, late readiness, fallback rendering, crash-report validation, renderer
settings and dispatcher containment. HTTP/DAO/Shelf/socket tests cover their
individual payload and lifecycle rules.

Unit tests prove the modeled behavior. Real Android/iOS validation is still
needed for renderer termination, hung content, tab navigation and recovery with
a shipped HTML bundle. Passing tests does not establish that every OS/plugin
failure can be contained.
