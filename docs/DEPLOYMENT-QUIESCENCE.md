# Deployment quiescence runtime integration

Current deployment readiness: **BLOCKED**. Node runtime admission, lifetime
tracking, persistence fencing and the independent launcher are implemented and
tested offline. Independent external-memory writer attestation, real Windows
launch bindings and deployment-driver integration remain unverified.

## Runtime compatibility repair

The fence preserves native function descriptors and custom promisification. A
native custom promisifier runs inside admission, with its returned Promise and
actual ChildProcess retained; copying an unfenced custom function is insufficient.
Timer callbacks retain native arguments, receiver and invalid-callback errors.
HTTP/HTTPS options and URL overloads retain native validation. Only the internal
lease header is removed/replaced: raw flat headers, array-valued fields, casing
and unrelated request metadata are otherwise unchanged. IPv6 is never parsed by
concatenating an unbracketed hostname into a URL.

The OPEN regression was reproduced with diagnostic control-I/O instrumentation:
Windows reported `EPERM` opening `gate.lock` during concurrent acquisition. Such
an acquisition remains refused, now with the same bounded retry as `EEXIST`.
There is no lock removal, ownership inference, lease expiry or admission without
a successfully acquired lock. Persistent denial still fails closed.

This is one descriptor-preserving adapter, one Node HTTP argument adapter and a
control-lock contention correction, not application-specific exception lists.
Broader monkey-patch compatibility or independent native/external writers remain
outside a complete-enforcement claim. Do not add API exceptions to claim PASS;
reevaluate explicit admission boundaries if further broad incompatibility appears.

The reviewed `open -> draining -> frozen -> open` protocol is retained. A child
admission may refer to an existing unpredictable parent lease while draining; it
acquires its own persistent lease and still needs ordinary route authentication.
Promise-resolution hooks retain detached work after its HTTP response. Additional
holds cover response completion, timers, streams, actual subprocess close and
Worker exit. Crashed leases and orphan Promises block rather than being expired.
Unscoped synchronous writes are fenced and prevent that process acknowledging idle.

## Current writer coverage matrix

| Boundary | Runtime connection | Idle condition / remaining limit |
| --- | --- | --- |
| Direct Backend, aliases, side-effecting GET | Common HTTP request admission and complete async scope | All requests and descendants finish; no GET exemption |
| Browser Read and consent | Common HTTP fence, Native broker scope, actual store writes | Every awaiting_consent/processing record blocks, including expired consent |
| Browser Operator / Native input | Backend fence, Native broker/stdin scope, actual child-close hold | Backend ready/planning/awaiting_input/executing and Native running map empty |
| Bridge and all five existing workflows | HTTP fence, authenticated child admission for already admitted Backend work | Busy lanes, active calls and all workflow occupancy idle |
| Detached internal runners | Descendant Promise, timer, network and child lifetime | Unresolved descendants retain leases |
| Durable Run startup | Interlock before app import | Only terminal or already RECONCILED_* records; unknown/unreconciled blocks |
| Background mail, history, events, capture, consolidation, backup and backlog | New scheduled tick admission; existing callback descendants drain | New ticks skip after prepare; no forced task cancellation |
| Sync persistence | Mutation/open/descriptor guard under Gate lock | Actual write and freeze cannot race; control-path writes rejected |
| Async persistence / streams | Lease through callback/Promise/close | FileHandle and disposable-directory APIs refused rather than unfenced |
| Native/Python/worker processes and threads | Hold until actual close/exit, not timeout response | Crashed parent leaves durable lease; no automatic orphan reclamation |
| Independent Hindsight/PostgreSQL writers | Client/child lifetime covered | BLOCKED: independent service-side admission/idle evidence unavailable |
| Backend, Bridge, new and old rollback startup | Content-addressed external launcher before product import | New/old three-role parking tested; actual installed launch bindings not applied |
| Deployment-host and Native publication writes | Separate trusted control plane | BLOCKED until existing promotion/recovery procedure binds and accounts for them |

Existing auth, CSRF, consent, Origin and executor checks remain. Closed HTTP work
returns 503 `deployment_unavailable`. Lease headers never authenticate an Owner;
incoming continuation also needs the existing service credential and no browser
Origin. Only fixed loopback service origins receive the header, and delegated
fetch cannot follow redirects. Backend store, Bridge workflow and Native operator
inspectors are registered at composition. Missing inspectors, pending work or
unscoped writes refuse acknowledgement; another instance cannot overwrite one.

The fence is a trusted-host interlock, not an OS sandbox against a malicious
administrator/arbitrary native code. Diagnostic stdout/stderr are outside task
persistence. Unsupported native transports and independent services cannot be
called covered merely because the Node fixtures pass.

## Independent startup and frozen recovery

`scripts/deploymentQuiescence/bundle.cjs` copies the existing protocol and fixed
runtime/verifier/launcher into a content-addressed host bundle. It verifies its
manifest and the pinned host configuration before evaluating any entry. Closed,
corrupt or unavailable Gate state parks first. It preserves CJS main semantics
and Native arguments when an authorized release permits startup.

The proposed fixed control namespace is
`C:/Aroma/aroma-agent-backend/data/.deployment-quiescence/`: ignored runtime data,
independent of Git source checkout. Existing inherited data-directory ACLs grant
LocalService and Owner Modify; no new permission is added. It is a separate
governance namespace forbidden to business filesystem writers, and must be
inventoried without changing the adopted 549-file contract.

Current source fails closed if the host record exists but the interlock is
missing. Old rollback source lacks this check: its protection MUST come from
independently pinned Backend service, Bridge Startup and Native Host launch
bindings. Copying a bundle alone is insufficient. No service configuration,
registry entry, shortcut, ACL or production control file is installed here.

Frozen recovery imports no product module and runs no task/model/Native executor.
The fixed `verifyRecovery` measures real Git commit/tree and the complete tracked
source scope, allowed overlay hashes, protected bytes/membership, pinned launcher
files and actual machine-produced TAP receipts/counts/skips. Git uses no optional
locks, external diff or textconv. Source identity is checked again. Its digest
attests those static conditions, not running application health.

`releaseVerified` binds that verifier to the existing Owner-password operation
and exact run/generation; it accepts no caller-supplied PASS callback. Service
tokens, cookies and configured credential collisions cannot release. Host control
composition must supply service credentials if loaded outside process.env. There
is no maintenance HTTP route, AI tool, new credential or automatic thaw. Live
application verification follows authorized release under existing recovery rules.

The launcher requires an explicit `external-memory` participant. This branch
does not invent an idle acknowledgement for that independent service. Production
freeze/recovery and Windows boot-path coverage therefore remain BLOCKED.

The 549-file baseline, backups and historical failure remain preserved; historical
writer attribution is unresolved. U1 stays separate and inactive, at 19 PASS / 8
Deferred. No merge, deployment, production restart or task mutation is performed.

## Historical protocol-only assessment (050f794; superseded by the runtime work above)

Status: **BLOCKED for deployment use**. This change is an inert, host-composed
protocol and its disposable-fixture tests. It is not an installed admission or
persistence fence. No production entry point imports it. Neither a protocol test
pass nor `phase: frozen` from this module proves the running application frozen.

## Scope and identities

Assessment base: `4fff4bf7d2d4183698fb3783d054ae7d1916ece0`.
Separate reviewed U1: `cd2f382253283ea53debc3e31d1303ea5f54d9db`, tree
`8ba775e24a6b89778dc1b0687c5bca76984c2c27`. U1 is not incorporated in this
infrastructure branch. Its 19 PASS / 8 Deferred acceptance status is not changed.
This protocol has no registration as an AI tool and adds no HTTP control route,
credential, permission, environment switch, service or dependency.

The adopted 549-file baseline, its adoption record, backups and historical failed
promotion remain external evidence. In particular, the historical task writer
attribution is unresolved. Nothing here authorizes an exception for that incident.

## Relevant ingress and writer coverage

The following covers the ingress families, including internal work which does
not arrive through HTTP. **Installed gate coverage is NONE for every row.** The
route survey accompanying the assessment inventories the individual mounts and
route registrations; a method name is not a read-only classification.

| Ingress / writer | Existing execution boundary | Required fence |
| --- | --- | --- |
| Chrome Browser Read | `nativeHost.cjs` broker -> authenticated `/api/v1/browser-read` -> `service.handle`; prepare, consented read and cancel persist | Backend admission before service dispatch, plus full async job lifetime and pending-consent inspection |
| Browser Operator | Native operator broker -> authenticated `/api/v1/browser-operator`; Native input executes an approved ticket outside Backend | Backend admission AND Native ticket/executor admission; wait for both ticket and actual input executor to drain |
| Direct Backend HTTP | Every mount in `src/app.js`, including unprefixed and `/api/v1` aliases | One common admission boundary, existing per-route auth preserved; no blanket GET exemption |
| Main intake / task execution | intake/proposal, demo, project tasks/work/adoption, task planner, development/diagnosis/repair, operating manager | Track detached jobs after their HTTP response, approvals and final persistence writes |
| Persistence/configuration controls | company access/OAuth callback, connections callback, model center, settings, topics, investigations, procurement/scheduler, memory/recovery | Mutation-aware admission including callbacks and status reads with audit side effects |
| Bridge HTTP | Closed authenticated POST set in `src/subscription/bridge.js`; includes completion, workflows, structured memory, scheduler and procurement | Shared durable gate; metadata is allowed only after proving it read-only |
| Backend startup | `require('./app')` initializes services; Browser Read interrupts pending jobs; `startupReconcile` marks durable Runs | Fence BEFORE importing app, not middleware after construction |
| Background mail | mail memory sync/index, mail analysis scheduler, history and notification loops | Suppress new ticks while draining; track the complete promise/child lifetime; never cancel Owner work to get idle |
| Background memory | runtime drain/consolidation, capture, backup scheduler; app backlog refresh | Same shared admission; do not count timer scheduling or HTTP completion as job completion |
| Worker/subprocess and external persistence | Bridge workflows; Python structured-memory gateway and backup; worker workspace/execution writes | Retain writer ownership until child exit and final records; a Node filesystem hook alone cannot fence Python/PostgreSQL or external subprocesses |
| Promotion / recovery | host coordinator lock, deploy/restart and rollback helpers | Lock serializes promotion only. Separate persistent admission state and immutable launch interlock are required across rollback versions |
| Client/package publication | Browser client installation/current receipt and packaged Native Host state | Fence the updater/publisher independently of task intake; freeze must cover protected installation records too |

## Why existing external controls are insufficient

`promotion.lock` has no admission consumer in Backend, Bridge or Native Host.
The existing idle observation is separate from stopping/restarting the service.
New authenticated work can enter between observation and restart. Stopping the
service first may kill already admitted work or trigger startup recovery; that
does not satisfy drain-without-cancellation. Current launcher/service controls
have no shared persistent freeze checked before app initialization.

A filesystem-only monkey patch is insufficient: independent captured functions,
subprocess writers, structured memory and Native execution are separate paths.
A GET allowlist is insufficient: reads may update access audit/cache state.
Refusing only Browser Read prepare leaves direct routes, Bridge and background
writers open. New broad ACL/firewall permissions are not part of this change.

## Selected protocol, implemented offline

The shared state machine is `open -> draining -> frozen -> open`. A single
exclusive file lock serializes admission, guarded synchronous writes, completion,
idle acknowledgements and state transitions across processes. It is never stolen
on a guessed timeout. Persistent uncompleted leases and a crashed lock block
progress; there is no automatic expiry or replay. State writes use exclusive temp
creation, fsync, atomic rename and read-back. Unknown/corrupt state fails closed.

Prepare is generation-bound and binds one deployment UUID. Draining refuses new
leases, while already admitted asynchronous work can finish and make guarded
synchronous writes. All leases must finish before an idle acknowledgement. A
completion/write invalidates old acknowledgements. Freeze requires all configured
participants acknowledged. Participant inspection is supplied by trusted host
composition, never a request body. This callback is an integration seam, not an
implemented independent runtime-idle verifier.

Control requires the configured Owner password using the existing constant-time
comparison, not `createRequireOwner` (which also accepts service credentials).
Native service tokens and browser session cookies cannot control this protocol.
Release requires exact run/generation plus a trusted recovery verifier returning
a receipt digest. There is deliberately no CLI or network release path until an
actual independently measuring verifier and host composition exist. The callback
does not itself establish evidence provenance; a caller-supplied PASS is not a
valid future production implementation.

Startup `start(participant, factory)` rejects before factory evaluation while
closed. Its fixture proves a cooperative new/rollback launcher can avoid startup
writes. Existing service/Bridge launchers do NOT yet use that seam. A future
immutable host interlock must cover both old and new entry points, survive source
checkout and rollback, and remain closed until recovery verification succeeds.

## Measured limits and acceptance

| Owner requirement | Protocol fixture | End-to-end runtime |
| --- | --- | --- |
| Reject new work / drain admitted operations | Tested | BLOCKED: all ingress and detached jobs not connected |
| Verify all writers idle / prevent freeze races | Lock and leases tested | BLOCKED: independent complete writer inventory/inspectors not implemented |
| Persistent freeze through restart and rollback | Cooperative factory test | BLOCKED: immutable host launch interlock not installed or implemented |
| Consistent Native and Backend refusal | Not claimed | BLOCKED: production dispatch paths are unchanged |
| Preserve auth and authorization | No existing auth code changed; control rejects service/session credentials | No deployment/control endpoint exists |
| Read-only during freeze | `status()` tested | BLOCKED: runtime read-only allowlist not proven |
| Authorized recovery/release | Protocol negative tests | BLOCKED: independently measuring recovery verifier not implemented |
| No protected persistence writes after freeze | Guarded fixture writes rejected | **BLOCKED: an unwrapped filesystem write succeeds in the adversarial fixture** |
| U1/E1 unchanged when inactive | Existing executable product files byte-identical to base | Test receipts accompany exact candidate |

The bypass fixture is intentionally a passing *diagnostic*: it asserts the gap
exists. It is not a passing enforcement acceptance test. Do not aggregate it into
a quiescence PASS. The next implementation must connect the common fence to all
writers, prove subprocess/Native drain, add the immutable launch interlock and
implement a non-forgeable measured recovery verifier before promotion is eligible.

No production tasks, authorization records, service state, launcher configuration
or historical receipts are changed by this offline work. No PR, merge, deployment,
production restart, U1 activation or real-data cross-interface test is authorized
by this candidate. Stop at offline verification and retain BLOCKED status.
