# DESIGN — L2-1: WHO REPAIRS A FAILED RESTART

> **Owner: 「the thing that repairs a failed restart is the thing that failed to restart. Layer 2
> does not move until this has an answer, and the answer may be 「a person」.」**

Design only. Nothing here is built. Every number below is measured from
`C:\Aroma\xiangxiang.log` (493 lines, 2026-07-24 → 2026-08-08), the per-launch server logs under
`C:\Aroma\logs\`, and the live Task Scheduler state, read on 2026-08-08.

**Conclusion first: a person stays in this loop, and the reason is not caution — it is that the
failure this would repair has not happened yet, and the only thing that ever reported it was
wrong.** §5 says what would have to change. §6 proposes the one step that is not a repairer.

---

## 1. WHAT ACTUALLY HAPPENS TODAY

### 1.1 The mechanism, as it really is

`C:\Aroma\xiangxiang.ps1` is a 20-line shim; the body is
`scripts/launcher/xiangxiang-body.ps1` in the repo, hash-pinned in `governance/launcherPin.js`.

It is **one-shot**. It probes `/health`, starts `node src/index.js` if nothing is there, polls for
up to ~15s, writes one line to the log, and **exits**. After that line, nothing in this system is
watching her. There is no supervisor, no retry, no scheduled re-check of liveness.

Two entry points: the Startup shortcut (`-Mode Startup`) and the Owner opening it (`-Mode Open`).

### 1.2 The part that decides the answer

Every failure branch in the launcher ends the same way:

```powershell
Write-Log '...'
if ($Mode -eq 'Open') { Show-Msg '...' }
return
```

**The message box is gated on `Open`. At boot — the only time a restart happens unattended —
every failure is silent by construction.** There are five such branches:

| branch | boot-time signal |
|---|---|
| 8090 held by a foreign process | log line only |
| `ANTHROPIC_API_KEY` (User) empty | log line only |
| `HUB_TOKEN` (User) empty | log line only |
| repo not on `main` | log line only |
| not healthy within ~15s | log line only |

And a sixth case has no line at all: **a crash after a successful start.** The launcher log
records *launches*. It has no concept of a stop. All 493 lines are starts.

### 1.3 What the record actually shows — 15 days

| outcome | count |
|---|---:|
| started and healthy | 165 |
| already up, skipped | 4 |
| refused: repo not on `main` | 3 |
| **timed out** | **1** |
| refused: foreign holder on 8090 | 0 |
| refused: missing key | 0 |

Measured `starting node` → `health probe matched`, over 164 launches:

| min | median | p90 | max | >5s | >10s |
|---:|---:|---:|---:|---:|---:|
| 1.05s | **1.10s** | 1.56s | 6.43s | 1 | 0 |

The 15s budget has ~9× headroom over the worst real start.

### 1.4 THE SINGLE RECORDED FAILURE WAS NOT A FAILURE

```
2026-07-26T13:06:37  [Startup]  starting node src/index.js (hidden)
2026-07-26T13:06:52  [Startup]  server did not become healthy within ~15s
2026-07-26T13:15:24  [Startup]  health probe matched: 香香 already up; skip start
```

That launch's own server log, `xiangxiang-server-20260726-130637.log`:

```
[AROMA-HUB] sandbox sweep: scanned=14627 deleted=0 skipped=14627 errors=0
[AROMA-HUB] Listening on 127.0.0.1:8090
```

Empty `.err.log`. **She started.** The launcher declared a failure on a server that was coming up,
and 8m32s later found her running. The probable cause is the 14,627-file sandbox sweep, which
runs before `listen` and is variable-cost — but the cause matters less than the record:

> **The entire observed history of 「she failed to restart」 is one event, and that event was a
> healthy server being mis-reported. True positives: 0. False positives: 1.**

This is the single most important input to the design. A repairer keyed to today's only failure
signal would have a 100% record of acting on healthy servers.

### 1.5 Who notices, how, how long

**The Owner, by opening the page.** That is the whole answer today. There is no other path that
reaches a human.

One external detector already exists and is better than it looks —
`AromaXiangXiang-ErrandRecall`, daily 07:00, `scripts/scheduler/run-scheduled-errand.ps1`:

```powershell
Write-Log ('FAIL: 8090 is not answering — she is not running. ' + ...)
exit 4
```

It deliberately exits non-zero so Task Scheduler records a failure — the file's own comment says
swallowing the error "would make a broken schedule look like a healthy one that had nothing to
report". Its log, `C:\Aroma\logs\errand-scheduled.log`, is 36 lines with **zero FAIL entries**.

So: the detector exists, is correctly built, **has never fired**, and its only reader is a
`LastTaskResult` field in a UI nobody opens. That is HR-47 in the present tense, and it is also
the twelve-day shape (§2.2) waiting to happen.

**Time-to-notice, honestly:** bounded only by when the Owner next opens the page. The daily task
would observe a persistent outage within 24h and tell no one.

### 1.6 The one structural fact that changes the whole question

`run-scheduled-errand.ps1` states it plainly: *「8090 only exists while the Owner is logged on」*.

Her uptime is coupled to his session. **The scenario 「she is down and he is not there」 is mostly
not a failure with consequences**, because there is currently almost nothing she is supposed to be
doing while he is away. That is exactly what Layer 2 would change — which is why this question is
correctly placed before it, and why the answer today is not the answer forever.

---

## 2. THE THREE CANDIDATES — WHAT EACH ONE FAILS AT, SILENTLY

Restating the shapes as I am evaluating them: **(a)** a watchdog with power over her source,
**(b)** an external supervisor process, **(c)** OS-level supervision (Windows Service + SCM
recovery). Judged against what this project has learned, not against elegance.

### 2.1 (a) A watchdog that reverts

**Introduces: a component whose power exceeds its judgement, and whose successes are unverifiable.**

- **The judgement is measurably bad today.** Per §1.4, the only signal it could act on has fired
  once, wrongly. A reverting watchdog on 2026-07-26 would have `git reset` a clean tree to repair
  a server that was already listening.
- **The silent mode is a mechanically-successful revert that fixes nothing.** `git reset --hard`
  succeeds, the restart still fails for the real reason (a missing env var, a held port), and the
  log says 「reverted」. That is 「script 失敗係唔郁之後同你講成功咗」 with a git command attached —
  worse, because a revert is not a no-op: it silently destroys the diff that would have explained
  the failure.
- **Layer-3 hole, from a direction the existing gate does not face.** `agent/workOrder.js` makes
  the permission / approval / audit / flag / credential files *structurally un-allowlistable* —
  an approved Work Order can never point at them. A watchdog that can write her source is outside
  that gate entirely. The repo's protection is built against the agent, not against a repairer.
- **It cannot distinguish 「the code is broken」 from 「the environment is broken」**, and 4 of the
  5 fail-closed branches (§1.2) are environment. Reverting code for an empty `HUB_TOKEN` is not
  a repair; it is damage with a success message.

**Verdict: rejected.** Not "later" — the power/judgement ratio is wrong at any point on the
roadmap, and this project has a better gate for source changes already.

### 2.2 (b) An external supervisor

**Introduces: a second thing that can be dead without saying so — and this project has already
paid for that exact shape.**

The precedent is on disk. `C:\ProgramData\AromaBackup\logs\b2-sync.log`:

```
2026/08/07 02:00:03 NOTICE: Failed to copy: directory not found
Errors:                 1 (retrying may help)
```

That leg failed daily from 2026-07-26 and was reported on 2026-08-07 — **twelve days** — because
the only reader was a log file. A supervisor is the same object: something whose whole job is to
watch, whose own death is watched by nothing.

Three silent modes, all with precedent here:

1. **The supervisor is dead.** Twelve-day shape. Its absence is indistinguishable from
   "nothing has gone wrong", which is precisely the reading it invites.
2. **The supervisor is alive and the probe is wrong.** The launcher already shipped this bug: the
   old probe matched a literal string in the `/demo` markup, so a page rename made a *healthy*
   server read as unhealthy — and, per the launcher's own comment, *would have judged a running
   香香 to be a FOREIGN process and refused to start*. A supervisor with that bug does not fail
   to repair; it repairs the wrong thing, repeatedly.
3. **Spawn success read as service health.** `Start-Process` returning is not `/health`
   answering. A supervisor that restarts in a loop, each spawn "succeeding" and each process
   dying, produces a log full of successes and a system that is down.

**Verdict: viable only if it is itself observed, and only after a detector has fired for real.**
A supervisor that nothing checks converts one silent failure into two.

### 2.3 (c) OS-level — Windows Service + SCM recovery

**Introduces: a restart policy that cannot see health, plus a change to what she is.**

This environment already runs one such service — `AromaXiangXiangBackend`, 127.0.0.1:8081,
LocalService, auto-start, installed out-of-band. It is a live example, not a hypothetical.

- **SCM restarts on process *exit*, never on *unhealthy*.** The failure that actually costs
  something — alive, holding 8090, answering nothing — is invisible to it. Worse, that state
  reads as **`foreign`** to the launcher, which then fail-closes and refuses to start. Two
  mechanisms, both silent, deadlocking each other.
- **Recovery counters reset.** A service that restarted eleven times overnight and a service that
  never faltered present identically the next morning.
- **It changes what she is, not just how she starts.** 8090 today lives in the Owner's interactive
  session. Session 0 changes her environment, her file visibility, and her identity — the
  scheduler-profile-invisibility failure in this project was exactly that class (backup tasks
  failing 0x1 because a scheduler logon could not see user-profile files), and the A6 service's
  own `PERSONA_SOURCE` is unreadable from a non-elevated session. Moving her under SCM to solve
  restart-repair imports a category of bug this project has already been bitten by twice.

**Verdict: rejected for 8090 specifically.** The coupling to the Owner's session (§1.6) is not an
accident to be engineered away; it is currently a safety property.

---

## 3. WHAT WOULD PROVE IT WORKS — HR-47

> A restart-repair mechanism that has never repaired a real failed restart is a detector that has
> not been seen to fail.

The launcher's five fail-closed branches are a ready-made exercise set, and four are safe to
trigger deliberately. **Correct behaviour differs per branch — and for two of them, correct
behaviour is to REFUSE, not to repair.** Any mechanism must be exercised against all five and
judged on its *report*, not on whether she came back.

| # | break, safely | how | correct outcome |
|---|---|---|---|
| 1 | repo not on `main` | `git switch` to a scratch branch, run `-Mode Startup` | **REFUSED** — never auto-checkout |
| 2 | foreign holder on 8090 | a stub listener that binds 8090 and answers nothing | **REFUSED** — never kill an unknown holder, never pick another port |
| 3 | missing credential | clear `HUB_TOKEN` in a child env only | **REFUSED** — fail closed |
| 4 | spawn-then-die | start with `PORT` already held so `listen` throws; process exits non-zero, `.err.log` gets a stack | **FAILED**, with the stack named |
| 5 | slow start / the real 2026-07-26 case | delay listen past the budget (a large cold sweep, or an injected pre-listen delay) | **ALREADY_HEALTHY on re-probe** — must NOT act |

Case 5 is the one that matters most, because it is the only one that has actually occurred, and
because a repairer that mishandles it does damage on the one input history has actually supplied.

Case 2 is the one that must be exercised with a stub rather than with her: killing a foreign
holder is the single most dangerous thing such a mechanism could do, and the stub proves refusal
without ever pointing the mechanism at a real process.

**None of these prove the mechanism against an unattended, unanticipated failure.** They prove it
against five anticipated ones. That gap should be stated wherever the mechanism is documented,
in the shape this project uses: *what it cannot see*.

---

## 4. THE CONSTRAINT — 「REPAIRED」 vs 「RAN AND DID NOTHING」

> Owner: 「Any automated repair must distinguish 「repaired」 from 「ran and did nothing」. If it
> cannot, it is worse than no repair, because I would stop watching.」

**This project has already solved this once, and the solution is on disk today.**
`C:\ProgramData\AromaBackup\logs\coredata-backup.log`, one JSON object per run:

```json
{"outcome":"CREATED","verification":"staging restore-verify PASS; B2 copy+check PASS;
  B2 restore-verify PASS (15 files re-hashed from downloaded bytes)", "exitCode":0, ...}
{"outcome":"NO_CHANGE","verification":"already present on BOTH staging and B2 for this exact
  content hash", "exitCode":0, ...}
{"outcome":"NO_CHANGE","failureStage":"DRYRUN_PLAN_ONLY",
  "detail":"dry run: nothing staged, nothing uploaded", "exitCode":0, ...}
```

All three are `exitCode: 0`. The exit code carries nothing. **The `outcome` + `verification`
pair is what makes them distinguishable**, and the verification sentence names the evidence —
*re-hashed from downloaded bytes*, not *upload returned 200*.

That is the required shape, and it is the acceptance criterion for anything built here:

1. **A closed outcome vocabulary**, every value meaning something different to the reader:
   `REPAIRED` · `ALREADY_HEALTHY` · `REFUSED` · `FAILED`.
2. **`REPAIRED` requires a proved post-condition** — `/health` answering `service: aroma-hub`,
   the same proof the launcher uses — **and must name what was wrong.** "Restarted successfully"
   without a named fault is `ALREADY_HEALTHY` wearing a repair's clothes.
3. **`REFUSED` must name the branch.** It is a *success* of the design (§3 cases 1–3) and must
   never be logged as a failure, or the log trains the reader to ignore it.
4. **Exit code is not the contract.** The old rclone leg exited on a `directory not found` for
   twelve days. The vocabulary is the contract.
5. **The mechanism may not report its own success** (HR-54): it re-probes after acting and reports
   what it observed, never what it attempted.

---

## 5. THE HONEST ANSWER: A PERSON STAYS IN THIS LOOP

Not as caution, and not as a deferral. Three measured reasons:

1. **There is nothing to build against.** Fifteen days, 165 healthy starts, zero true failures,
   one false positive (§1.4). A repairer would be tuned on a signal whose entire history is one
   wrong reading. HR-47 is not satisfiable here — you cannot see a detector fail on a failure
   that has not occurred.
2. **Her uptime is coupled to his session** (§1.6). "Down while he is away" is, today, mostly not
   a failure with consequences. Automating repair of a consequence-free state buys nothing and
   adds a component that can fail silently.
3. **Detection is strictly prior to repair, and detection is not built.** The crash-after-start
   case produces *no signal at all* (§1.2). Building a repairer on top of an absent detector
   means the repairer's most important input does not exist.

### What would have to change for that to stop being true

In order. Each is a precondition for the next.

1. **She has to be needed while he is not watching.** This is the real trigger, and it is what
   Layer 2 is about. The moment an unattended job has consequences, "down and unnoticed" becomes
   a real cost and the arithmetic above inverts. Until then, the answer is a person because a
   person is sufficient.
2. **A detector must exist for the case that has no signal** — she was up, she is not now. That
   is a different mechanism from the launcher's start-time probe and is buildable independently.
3. **That detector must have fired on a real failure at least once** (HR-47), and the failure
   must be in the record, so that whatever repairs it is exercised against something that
   actually happened rather than five things I imagined in §3.
4. **The repair must satisfy §4's vocabulary** — and must be readable in one line, because a
   mechanism the Owner checks once and then trusts is the failure mode he named.

Until all four hold, the named limitation is:

> **香香 has no automated restart repair. If she fails to start at boot, the failure is silent by
> construction, and the Owner learns of it by opening the page. A daily task would observe a
> persistent outage within 24 hours and tell nobody.**

That is a limitation worth naming rather than a gap worth filling.

---

## 6. THE ONE STEP THAT IS NOT A REPAIRER — RECOMMENDED

The current answer is 「the Owner notices by opening the page」. Most of that is not inevitable —
it is one `if` (§1.2). Every boot failure is *already detected and already logged*; it is
suppressed on its way to a human because `Show-Msg` is gated on `-Mode Open`.

**Make the existing silence loud.** Not a supervisor, not a watchdog:

- It has **no power over her source** — §2.1's whole objection does not apply.
- It is **not a second thing that can be dead unnoticed** — it lives inside the launcher, which
  the Owner already invokes, and whose own absence he would notice within one use.
- It is **exercisable against all five branches today** (§3), because all five are reachable on
  purpose and none needs a real failure to have happened.
- It changes the answer to §1.5 from **「he notices」** to **「he is told」**, which is the whole
  distance between a limitation and a hazard.

It also makes precondition 3 reachable: a failure that is announced is a failure that enters the
record, and a repairer built later would have something real to be exercised against.

**This is a proposal, not a decision, and it touches the launcher — which the Owner has ruled
stays unsolved and stays outside. It needs his GO before anything is written.**
