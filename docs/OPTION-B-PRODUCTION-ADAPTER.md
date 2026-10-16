# Option B: Imagine production adapter design

Status: OFFLINE DESIGN ONLY. G1 observation is sufficient to design, not production
safety acceptance. Installation, bootstrap, G2-G4 production execution and U1
deployment remain BLOCKED pending separate Owner approval and the evidence below.
This candidate adds a design and disposable experiments, not a deployable Windows
adapter. No production entrypoint imports the fixtures. The existing fixture-only
scope guards must remain intact. Do not widen `createMaintenance` to production
paths or substitute production settings into its synthetic SQL.

## Decision and smallest integration

Reuse `quiescence.js` for durable OPEN/DRAINING/FROZEN state, its generation/run
checks, exclusive admission, Owner authentication and release. Reuse
`offlineMaintenance.js` as the lifecycle/reference orchestration, the existing
external preservation verifier and `offlineStartup.cjs` as the before-import seam.
Do not add a second state machine, proxy, AI tool, process manager, tool registry,
global Node patch or general runtime fence.

The minimum production implementation is a fixed host adapter for this installation:
(1) explicit admission at dispatch and autonomous producer boundaries;
(2) a fixed, independently verified Windows isolation backend; (3) a separately
installed immutable launch shim outside the release checkout; (4) a production
logical-memory preservation adapter. None is installed by this candidate.
An adapter must take observations itself, not trust caller `idle`, `isolated` or
`verified` JSON. Fixture IPC results are not production acknowledgements.

## Evidence anchor and limits

Reviewed G1 package: commit `4927cbd0e8eed0450b2fd84140b6bbf4be65505f`,
tree `165d96412f4ea062811a92187a77e20743cc13ad`.
Owner capture nonce `20f4ad10-bb76-4cfc-a247-ce1a00173d19`,
2026-10-16 21:47:41.6041390Z through 21:47:42.5885680Z,
capture SHA256 `da6c547f43b253680f1b085e621b98d075de2d3d1545614a014b501639049efe`.
It records 21 selected processes, complete selected-process handle snapshots,
six distinct same-sample Job objects, and stable selected process metadata.
The six Job tokens are not historical identities or proof of a complete hierarchy.
PostgreSQL and its `cmd.exe` parent are members of some Job, but no observed
queryable Job handle establishes their controlling Job. Handle ownership also
does not prove exclusive control authority.

Bridge Job active PID 11920 lacks selected identity metadata. The later
non-elevated CIM query returned no row for that PID: no historical executable,
creation time, work result or final write can be reconstructed from this absence.
Keep its historical attribution UNKNOWN. A later installation requires a fresh
complete current writer/descendant inventory, not reuse of this PID as an identity.

WinSW expectation booleans confirm LocalService, Node, production cwd and the
exact known service entrypoint. XML SHA256 is
`f8f1db1ddb54e8c86751d5537b566ef62d96d2aa19a7a0f083a9b6c0739540e9`;
entrypoint SHA256 is
`c6402d4a0e56877eeedbd7f4f0640d5ad275de5e18e94c65ba0cd4bc66a3e230`.
The XML has no captured stopTimeout or stopParentFirst setting; defaults are not
inferred. Existing SCM retry policy restarts Backend after failure; source shows
Bridge/Hindsight supervisors retry and renew leases. All require interlock binding.

The original G1 capture SHA256
`317586d1c62fe989c3bd11cd10c40fe598f539692ff613abe39729915d41e601`
and previous failed deployment/writer uncertainty remain unchanged. The Owner's
earlier TaskScheduler Operational logging enable is a separate production action,
not part of read-only capture. Its prior state and exact change time remain unknown.

## G2: closure before drain

An external launch latch alone cannot close requests to an already-running server
or stop its internal timers from admitting work. HTTP method is not a safety
classification. A side-effecting GET, lazy status initialization, audit write or
consent read-and-update needs admission just as a POST does. Read-only allowlisting
requires an audited path with no lazy persistence; unknown routes refuse during
maintenance. Keep existing authentication checks; gate admission never grants
business or Owner authority. Browser/Native service credentials cannot release
maintenance or become Main Chat authorization.

One fixed durable gate is shared by Backend, Bridge and host entry shims. Running
services use explicit `gate.admit`/`run` at the following boundaries, before their
first side effect. Every operation keeps its lease through promises, error paths,
final persistence and independently tracked subprocess completion. An HTTP socket
closing, client timeout or a parent process exiting cannot finish descendant work.
An abnormal exit leaves a stale lease; never delete it merely because a PID vanished.

| Boundary | Exact existing integration seam | Proposed closure and drain evidence |
|---|---|---|
| Backend/direct HTTP/Browser Read/consent | `src/app.js`, `src/browserRead/routes.js`, `src/browserRead/service.js`, Browser Operator routes | explicit dispatch admission before handlers; active work/consent/task-store checks plus final writes; initialization guarded externally |
| Bridge/model/workflow execution | `scripts/subscription/startBridge.js`, Bridge request dispatcher and workerFlow/projectWork dispatch | admission before dispatch; retain through worker and detached runner completion, including promotion drivers |
| Native Host/Browser Operator | packaged native host launcher, `src/browserRead/nativeHost.cjs`, `operatorBroker.cjs`, `nativeInput.cjs` | external startup interlock plus per-message admission; hold through capture/input child, report and final result; no forced cancellation |
| Windows scheduled work | `scripts/scheduler/run-scheduled-errand.ps1`, `run-procurement.ps1`, registered actions | immutable pre-script gate before logging, token lookup or HTTP; Backend also gates scheduled-run/tick; separately inventory backups and any other direct writers |
| Supervisors | `scripts/memory/serviceSupervisor.cjs`, `runtimeSupervisor.js`, Startup shortcuts | interlock before lease/status writes and before each respawn; no new starts in DRAINING; existing child drain must not use current forced-stop helper |
| Autonomous callbacks | app mailMemory sync/index, mailScheduler ticks, governed memory, memory capture/backup, backlog refresh; Bridge schedulers | gate before each autonomous operation and retry; already admitted work finishes without cancelling analysis or changing persisted scheduler preferences |
| Hindsight | `scripts/memory/startHindsight.cjs`, `work_trace_runtime.py`, installed Python API/worker | close external intake and new internal job claims while allowing admitted operations to finish; exact installed Python pause/drain support still unproven |
| Independent execution | direct Node/Python/pg0 invocations, repository drivers, manual entrypoints, backup/upload launchers | enumerate actual installed bindings; bind supported launches to immutable shim; any unbound process/creator able to write protected state blocks installation |

Closure ordering is atomic at gate.prepare: OPEN -> DRAINING happens before any
drain wait. Stop accepting all *new root* work then let existing leased work and
its registered descendants finish. Continuations must retain original authorization;
no browser-to-Main credential transfer. Only a registered parent lease may admit
a child continuation during draining. Verify creator policy cannot start unrelated
new work using an old parent lease. No bulk cancellation, consent replay, queue
deletion or mutation of Owner task states is allowed to achieve idle.

Recheck all lease, active operation, independent worker and pending consent stores.
Unknown task state, pending consent, unreconciled records, stale lease, expired
bounded drain deadline or any new independent writer blocks the next step. Keep
the latch closed on failure. Draining cannot be implemented by stopping Backend
and hoping its dependent writers stopped.

## G3: fixed host isolation, not inherited Job assumptions

| Writer group | Minimum acceptable control | Present installation blocker |
|---|---|---|
| Backend and Bridge | close dispatch/timers; graceful completion; exact-process exit; independently verify descendants and no respawn | unbound installed launch paths; no complete native/worker descendant lifetime proof |
| Native children/detached runners | launch under an identified controlled no-breakaway boundary before first instruction, retain controlling handles until independently verified empty, or demonstrate equally strong existing OS isolation | observed inherited Jobs permit breakaway modes and hierarchy is incomplete; no exclusive no-breakaway boundary proven |
| Hindsight | prevent new API work and worker claims; verify persisted async queue terminal and active operations idle; graceful exit of API and workers; no supervisor respawn | installed drain/shutdown behavior and all independent workers unverified |
| PostgreSQL | identify cluster (data directory, executable, port and start identity), exclude all app/maintenance clients except fixed verifier, freeze all restart-capable pg0 launchers; capture logical state; smart shutdown and verify server/children exited | queryable controlling Job and exclusive startup/restart ownership not proven; installed schema/verification coverage not yet validated |

Preferred OS control is a narrow, fixed launch/isolation component only if current
controls cannot provide equivalent evidence. If Jobs are selected, bootstrap must
prove creation-before-execution assignment (suspended launch, assignment, then
resume), effective no-breakaway restrictions including nested Jobs, retained
control handles, empty active-process list and descendant behavior. Assignment
failure must terminate only an unstarted disposable test process during testing;
no production termination fallback. Do not use a query-only handle as control
proof, parent PID scans as containment, or kill-on-close as graceful drain.
Do not build this component in the current design tranche. Its need/compatibility
and permissions require separate approval; inherited Jobs are not accepted substitutes.

Existing installed `hindsight_api/pg0.py` can call `pg0.start` with retries through
`ensure_running`; `pg0/__init__.py` invokes its bundled subprocess. This establishes
a possible restart-capable path, not that it created historical PID 6280 or is
the only launcher. Current PG PID 6280/parent 25132 match G1 creation identities.
Do not call `ensure_running`, pg0 info/start/stop, production SQL or import those
packages to inspect ownership. More ownership evidence must be separately scoped.

The fixture SQL tables `records`, `audit`, `principals`, `access_audit`,
`async_operations` are synthetic. Production needs a schema/version-pinned,
read-only consistent logical snapshot covering every memory bank, vectors/content,
tenant/principal mapping, access/audit history and background-operation state.
Exclude no logical data merely because its DB files are outside the 549-file
manifest. Inventory extensions and all database clients/background workers; a
zero client count alone is insufficient. Database physical hashes are compared
only after clean shutdown; database recovery writes require a distinct documented
verification stage, never an exception for unexplained logical changes.

## G4: immutable launch binding and recovery

Place the reviewed fixed startup shim, pinned gate protocol/runtime and fixed
installation manifest outside `C:\Aroma\aroma-agent-backend` and outside rollback
releases. Proposed location: `C:\ProgramData\AromaXiangXiang\maintenance-v1`.
This is a proposed binding, not an installed path. Bootstrap must demonstrate
read-only application identities cannot replace the shim, gate configuration or
release authorization. Runtime participants need bounded lease writes; they must
not gain authority to rewrite maintenance phase. Existing file-based gate alone
does not enforce that privilege separation against arbitrary code with write
access. Resolve this with the existing authenticated host-control boundary and
validated host-owned access/broker arrangement before installation, not a new AI
tool or undocumented ACL grant. Missing/corrupt/inaccessible state refuses startup.

WinSW must bind the shim before any release import; SCM retries traverse it.
Both Startup shortcuts, supervisor respawns, Native registration/launcher, scheduled
actions and supported manual/driver entrypoints must traverse the same immutable
binding before initialization, logging or recovery can write protected state.
Rollback must preserve this binding and select only the approved old entrypoint,
not restore an old direct launch. Gate protocol version compatibility and immutable
tool hashes are part of the retained rollback evidence.

Recovery while FROZEN does not start Backend/Bridge/Hindsight/Native. The existing
host-owned maintenance operation starts only the identified database in isolated
verification scope with application clients and all auto-start paths still blocked.
The independently pinned verifier reads consistent logical data and compares
task/auth/file preservation and exact candidate or forward-rollback source tree.
Then smart-stop the verification database, verify isolation again, and use the
existing authenticated releaseStopped-equivalent operation to reopen. No one-shot
HTTP exception, ambient environment flag, caller PASS receipt or ordinary service
token may bypass the latch. Failed deploy/recovery/rollback leaves it closed.
Database normal startup and application startup occur only after verified release.

## Bounded bootstrap prerequisites and approval proposal

1. Approve the design only; retain current source, 549-file baseline, encrypted
   backups, rollback references and historical failed receipts without rewriting.
   This candidate performs no maintenance installation or activation.
2. Obtain missing sanitized installed launch/action inventory and current complete
   protected-writer identities. Resolve PG restart owners, Hindsight queue/drain
   semantics, Native descendants and inaccessible bindings. Historical PID attribution
   can stay unknown if fresh current isolation independently covers every writer.
3. Specify and independently review the exact production adapter, logical verifier
   and immutable shim binaries/scripts with hashes, supported OS calls, identities,
   read-back verification and reversible installation changes. No new privileges
   are assumed. If access/binding changes are necessary, submit an exact separate
   Owner approval plan with prior descriptors/configuration and restoration steps.
4. Bootstrap has a circular dependency: the old running version lacks admission
   hooks and old bindings lack the latch. Ordinary stop/restart is insufficient.
   Establish an independently enforceable, Owner-approved bounded offline window
   that excludes all work creators and restart owners before installing bindings.
   Verify idle without cancelling tasks. If this cannot be established with known
   controls, bootstrap stays BLOCKED; do not install by restarting first.
5. In separately approved installation tests, verify actual effective access,
   direct-HTTP/Native/scheduled bypass refusal, crash/power-loss latch persistence,
   every restart binding and old-version rollback before adopting production gates.
   Only a later explicit approval may authorize U1 promotion; U1 stays disabled and
   all eight deferred acceptance criteria remain deferred.

## Offline verification and exact scope

New files: this document, `src/repositoryPromotion/optionBAdmission.fixture.cjs`
and `src/repositoryPromotion/optionBAdmission.test.js`. Existing protocol,
controller, startup seam, authentication, preservation and product behavior remain
byte-identical to the reviewed Option B base `18aa43c1a7aa798cc0b195e393f4515b35d724b7`.
The experiment starts separate real processes representing eight proposed ingress
classes, admits concurrent work in OPEN, prepares once, rejects new work/startup,
allows original final writes, observes real child exits, freezes and tests old/new
startup refusal and Owner-only release. These are explicit IPC fixture boundaries,
not installed Backend/Bridge/Native/Hindsight tests or complete descendant proof.
An independent ungated writer really writes a disposable protected file and prevents
freeze: the gate cannot fence unknown writers merely by being present.

Existing offlineMaintenance tests additionally exercise actual disposable Windows
Job descendants, HTTP side-effecting GET and consent POST, real disposable
PostgreSQL, smart shutdown, logical preservation, failed deployment and forward
rollback. Their success must not be relabeled production safety acceptance.
Review must include this full design and both complete new fixture/test files,
exact commit/tree, measured regressions and outstanding limitations. Final receipts
live outside the candidate and never manually replace failed evidence.
