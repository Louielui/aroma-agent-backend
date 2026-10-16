# Deployment quiescence assessment and offline protocol

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
