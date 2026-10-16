# Option B: bounded offline maintenance

Status: disposable Windows fixture implementation; **production installation BLOCKED**.
This code is not installed, imported by application startup, or exposed as an AI
tool, Browser route, Native Host command or Backend maintenance endpoint.

The existing `42ae81672264c51c18c6c28d8b9563a9211f1e10` candidate and evidence
remain preserved. Only its exact `quiescence.js` protocol and protocol tests are
reused. No Runtime Fence or global Node monkey patch is loaded. U1, E1 and the
current production source are not changed by this implementation.

## Controller and evidence

`offlineMaintenance.js` composes the existing OPEN / DRAINING / FROZEN protocol.
It accepts only a direct temporary `imagine-offline-<UUID>` directory on Windows,
fixed named fixture Jobs, pinned query tools and an isolated Git repository.
The host authenticates using the existing Owner password comparison; Native/
Bridge credentials are explicitly rejected. No new permission or credential is
introduced. Its journal binds the run, tool hashes, writer inventory, source
identities, protected files and logical database evidence. Inventory changes
across controller reconstruction refuse recovery.

1. `prepare` atomically closes admission using the existing durable Gate. The
   external launcher must retain its interlock before **both** new and rollback
   application initialization. The disposable fixture demonstrates this ordering.
2. `drain` waits a bounded window for actual leases and actual non-database Jobs
   to finish. Pending/unknown task states refuse immediately. No cancellation,
   lease expiry, lock stealing or synthetic idle response is used.
3. `capture` records the complete protected-directory membership and hashes,
   plus ordered logical memory, audit, principals, access audit and asynchronous
   operations. Processing/pending memory operations or other SQL clients refuse.
4. `stopMemory` checks these observations again and uses only PostgreSQL smart
   shutdown on the disposable cluster. It never uses fast/immediate/taskkill.
   Failure or timeout keeps admission closed. A returned stop command alone is
   insufficient: kernel Job membership must be empty and postmaster PID absent.
5. `freeze` independently queries every inventoried Windows Job, rejects any
   remaining process, and compares protected files. Backend exit alone is never
   sufficient. The fixture Job launcher uses atomic process-creation Job
   assignment, no breakaway and no kill-on-close. A holder keeps the Job queryable
   after a parent exits. Failed/unknown Job queries refuse freeze.
6. `promote` / `rollback` accept only exact pinned fixture commits and trees,
   clean files independently matched to Git blobs, and forward-only history.
   Both operate while frozen. Failed verification leaves the latch frozen; it
   does not repair task data or declare a failed deployment successful.
7. Restricted recovery starts only the disposable database while application
   Jobs remain empty. `verifyRecovery` reads logical data and source independently;
   it cannot accept a caller-supplied PASS. `stopMemory` rechecks logical data and
   stops that database again. `releaseStopped` rechecks Jobs, files, source, run,
   generation and authenticated Owner identity before opening the Gate.

The recovery SQL is read-only; restart/checkpoint/WAL changes are not equated
with logical-memory changes. In fixtures, only synthetic database data exists.
The recovery journal records a verification, not live application health.
Production health checking while all application initialization is blocked
requires a separately reviewed startup/release sequence.

## Exact scope and remaining gaps

| Writer / ingress | Disposable evidence | Production prerequisite |
| --- | --- | --- |
| Backend HTTP, including side-effecting GET | Explicit Gate admission fixture; durable denial before application initialization | Existing deployed version has no such binding. External admission closure must cover every route before drain; a promotion lock is insufficient. |
| Browser Read consent / Native Host / Browser Operator | Existing protocol pending-consent refusal; fixture old/new initialization refusal | Enumerate and bind Chrome-spawned host executable independently of version checkout. Do not transfer Browser authorization. |
| Bridge / workflow / scheduled work | Actual named Job processes and durable leases in fixtures | Supervisor respawn and scheduled ingress must be held by an approved external maintenance binding. |
| Children / orphaned descendants | Actual Windows Job ID list after parent exit; delayed write remains visible | Identify controlling Jobs, their complete nesting and effective restrictions. Membership alone proves none of this. Broker-created processes remain unsupported. |
| Hindsight and PostgreSQL | Synthetic SQL queue, independent PG processes/Job and smart shutdown; logical authorization/audit comparisons | Real Hindsight API/worker drain, all clients/DBs and PostgreSQL ownership need independent evidence. This is not a tested Hindsight shutdown adapter. |
| Other services / arbitrary same-account programs | Outside fixture inventory; no production eligibility | Enumerate protected writers, exclude or isolate brokers and other SQL clients. No security claim against arbitrary programs running as the controller's Windows account. |
| Startup / rollback | Same durable protocol before fixture application code | Installed WinSW, Startup links, Native package and PG launcher are not interlocked today. Production stays BLOCKED until independently installed and verified. |

There is deliberately **no production adapter** and no claim that the fixture
protocol can fence unwrapped arbitrary writes. Unknown production writers are a
hard installation blocker. The 549-file manifest is retained unchanged, but it
does not bound logical memory preservation. Production must additionally account
for Hindsight, structured memory, audit/authorization history, all relevant PG
databases, queue state and backups. Historical `awaiting_consent -> interrupted`
failure and unresolved writer attribution remain failed historical evidence.
No lifecycle exception is added.

## Phase 1: separately authorized elevated read-only capture

Review and pin both files before authorizing execution:

* `scripts/repository/inspect-maintenance-bindings.ps1`
* `scripts/repository/InspectMaintenanceJobs.cs`

This phase does **not** use `OfflineFixtureJob.cs`. The inspector contains no
Job mutation, service control, ACL change, privilege adjustment or elevation.
It reads the fixed WinSW XML, service identity, selected relevant processes and
their immediate controlling parents. Command lines and XML environment values
are never emitted. XML DTD/entity resolution is prohibited. It duplicates only
query-access handles and closes only its own copies. It reports available Job
limits and confirmed membership, with incomplete/nested hierarchy explicitly
unknown. It cannot infer a controlling Job from membership alone.

Proposed Owner action, **not executed automatically**: open a separately
authorized elevated **PowerShell 7 x64** window. Confirm the two SHA256 values
against the final evidence report, then run the exact pinned checkout script:

```powershell
$captureRoot = 'C:\Users\louis\.codex\worktrees\offline-maintenance-b\subscription-chat'
Get-FileHash -LiteralPath "$captureRoot\scripts\repository\inspect-maintenance-bindings.ps1", "$captureRoot\scripts\repository\InspectMaintenanceJobs.cs" -Algorithm SHA256
& "$captureRoot\scripts\repository\inspect-maintenance-bindings.ps1"
```

Capture stdout through the Owner's existing evidence handling. No raw XML,
credentials, broad handle dumps, process environment, ACL edits, service stop or
configuration changes are authorized. AccessDenied or missing controlling handles
are valid BLOCKED results. A Job hierarchy not established by the capture needs
additional narrowly approved read-only evidence, never a guessed PASS.

## Bounded bootstrap approval proposal — future, not executable approval

1. Authorize only the hashed elevated read-only capture above. Reconcile actual
   WinSW version/XML, controlling Jobs, Bridge/Memory Startup links, Native Host
   manifest/executable and PostgreSQL launcher. Record unavailable evidence.
2. Produce an exact source-pinned production adapter/install plan for those
   bindings, including all independent writers and an actual memory shutdown /
   read-only recovery sequence. Review it independently. No global patches.
3. Request a separate one-time maintenance authorization specifying exact
   configuration diffs, installation hashes, scope, duration, before/after
   evidence and reversal. ACL or new privilege changes require explicit scope.
4. Before any stop/install, prove external admission closure for the **currently
   deployed** source. Do not infer this from Backend shutdown, UI inactivity,
   promotion.lock or a new version's Gate. Drain without changing Owner tasks.
   If external closure cannot be demonstrated, stop and design that minimal
   binding; the current fixture is not authorization to bypass the gap.
5. During the future authorized window preserve actual files and logical data,
   gracefully isolate all writers, install a deployment-independent interlock,
   then test old/new/rollback startup before initialization while frozen. Retain
   the latch through any failure until recovery is independently verified.
6. Only after those gates pass request controlled U1 promotion approval. Keep
   U1 disabled; all eight deferred criteria stay deferred. No real-data handoff.

This tranche authorizes none of steps 1–6 in production. Evidence/testing and
code-only review do not adopt a new preservation baseline or approve deployment.
