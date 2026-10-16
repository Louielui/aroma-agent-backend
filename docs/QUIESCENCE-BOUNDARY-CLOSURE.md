# Quiescence boundary closure: offline assessment

Deployment readiness: **BLOCKED**. This change closes an unsafe *success* path,
not all production writer boundaries. No product is deployed or enabled here.
OPEN still runs native work and returns the native Node results. After native
work starts, drain cannot claim idle merely because its direct process/thread
exits. Its existing durable admission lease is deliberately unresolved, including
across host exit. There is no automatic expiry, PID polling proof, lock steal,
termination-success assumption, or new authority to clear a lease.

## Protected state and independent writers

The retained 549-file manifest covers Backend task/conversation/authorization
files, scheduler-action records, launcher/configuration and Native packages.
Its membership is not changed. Hindsight's and PostgreSQL's physical storage is
separate; that does not authorize dropping logical memory records, principals or
access history from a future deployment preservation contract.

| Writer / trigger | Actual boundary and protected effect | Assessment |
| --- | --- | --- |
| Backend HTTP, Browser Read/consent, tasks, background callbacks | Shared admission, actual Node persistence; pending work refuses idle | Offline fenced; installed runtime not yet bound |
| Bridge, memory gateway, model workflows | Shared HTTP admission and async lifetime; gateway launches Python for structured records/audit | Native uncertainty prevents a successful freeze; no containment claim |
| Native Host / Browser Operator | Installed versioned EXE launches nativeHost.cjs, which launches native input | Direct child is insufficient; unresolved native lease blocks freeze |
| Hindsight Python API and workers | Owner supervisor -> Node launcher -> Python wrapper/worker -> PostgreSQL | Separate logical memory writer; no independent idle/isolation proof; required external-memory acknowledgment remains unavailable |
| PostgreSQL / pg0 instance | Resident postgres and its workers, independent of Backend client lifetime | No shutdown/admission proof; cannot infer idle from completed client calls or exclude memory authorization/history merely because DB files are outside the 549-file manifest |
| Scheduled ErrandRecall | Installed task calls run-scheduled-errand.ps1, which POSTs Backend and writes only its separate log | Backend route admission applies once installed; trigger is not an independent task-record writer |
| Core, TruthData, ReleaseRecords backups | Separate backup staging/log/B2 destinations | Not a reason to stop unrelated business services; inaccessible external scripts remain unverified rather than assumed safe |
| Xiangxiang archive backup | Existing CMD invokes Backup-XiangxiangArchive-v2.ps1 | Backup destinations are separate; any Backend request is still subject to common admission; source hash and installed-task evidence retained |
| Promotion/recovery and Native publication | Trusted external control plane can change source, package and launch bindings | Must be coordinated by the sole authorized deployment executor; not an ordinary business lease |

## Native process paths

The source survey includes all spawn/exec/fork APIs and Worker construction.
Relevant families include subscription CLIs, Agent Bridge/Claude workers, Native
input, structured memory Python, Git/repository helpers, promotion drivers,
Windows Sandbox/WSL and browser processes, scheduler PowerShell and backup tools.
The exact source locations are retained in the external spawn inventory.

Generic Node callbacks expose only immediate child close/worker exit. A descendant
can close inherited stdio, detach and write after its parent exits. Failed calls
to terminate a closed child handle cannot account for that descendant. All these
uncontained paths remain **unsupported for a successful freeze**. Sync native
calls conservatively retain uncertainty even on error; no command-name allowlist
pretends that Git, Python, a shell or a model CLI cannot spawn descendants.

This also means startup Git probes can block drain. The changed candidate is
therefore not deployment-ready. Further closure needs an independently verified
existing isolation boundary or a narrow explicit native execution boundary with
OS-enforced descendant lifetime. Do not grow global patch exceptions or add an
unreviewed generic process framework. No such boundary is installed by this work.

## Actual Windows bindings (read-only evidence)

- Backend: AromaXiangXiangBackend, LocalService, existing service-v2 EXE. CIM
  identity is readable; the actual WinSW XML returns AccessDenied. Executable,
  arguments and working directory in that XML are **unknown**, not replaced with
  source expectations. Existing service entry source is not installed XML proof.
- Bridge Startup shortcut: node.exe -> scripts/memory/serviceSupervisor.cjs bridge
  -> scripts/subscription/startBridge.js. Supervisor is mutable product checkout
  code, not the content-addressed external interlock.
- Memory Startup shortcut: same supervisor with hindsight -> startHindsight.cjs
  -> Python work_trace_runtime.py. PostgreSQL has independent resident workers.
- Native: HKCU Chrome registration points to the 4fff4bf7 versioned manifest and
  ImagineBrowserReadHost.exe. The existing publisher builds a direct Node launch;
  installed package/manifest hashes are retained. Installed binary containment or
  external interlock is not inferred from matching JavaScript source alone.

The existing new/older rollback Backend/Bridge/Native disposable-process tests
still demonstrate parking before initialization under the proposed external
launcher. They do **not** prove that those installed bindings use that launcher.

## Separate one-time bootstrap approval plan (not executable approval)

No installer or restart is run in this phase. A future Owner approval must name
the exact reviewed installer, configuration/bundle hashes, protected manifest,
service/shortcut/Native before-and-after bindings and recovery evidence. No new
credential, DACL grant, service identity or browser origin is proposed.

1. Obtain an Owner-run elevated **read-only** capture of the exact WinSW XML and
   launch identities without changing its ACL. Independently hash and validate
   the capture. Stop if actual arguments/working directory remain unknown.
2. Resolve native descendant containment and the Hindsight/PostgreSQL logical
   preservation/admission/isolation contract offline. Require measured idle and
   completion evidence; never authorize a synthetic external-memory acknowledgment.
3. Prepare the fixed external bundle, recovery plan and immutable launch bindings
   for Backend, Bridge supervisor and Native publication. Include supervisor
   respawn, logon/Task Scheduler, new release and old rollback entry paths. Preserve
   service-environment hydration, Native framing/origin and all existing auth.
4. Review a bounded bootstrap maintenance procedure separately. It must establish
   enforceable external admission/isolation *before* stopping an idle application;
   user inactivity or promotion.lock is insufficient. Do not cancel tasks. If no
   such admission barrier exists, bootstrap remains BLOCKED. No safe installer is
   claimed by this prose plan.
5. Only after that approval and verified prerequisites: preserve exact pre-state,
   adopt no fresh baseline implicitly, bind the external interlock while safely
   isolated, verify frozen cold starts and older rollback before initialization,
   verify protected bytes/records, then perform only authenticated verified release.
   Any unexpected write or failed containment keeps the barrier closed and enters
   the separately reviewed recovery procedure; no automatic restore/replay/thaw.

Until these prerequisites are satisfied, offline tests and a source review cannot
be reported as installed production enforcement. Historical deployment failures
and unresolved writer attribution remain unchanged. U1 is inactive, with all
eight deferred acceptance criteria preserved.
