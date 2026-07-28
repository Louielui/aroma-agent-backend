# Phase 3b — handoff: what is done, what is left, what not to redo

**As of 2026-07-28.** Branch `feat/computer-3b-observation`. `main` untouched.

## State

Stage 1 and the Node side of Stage 2 are complete and verified. The Stage 3 specification
is locked in `PHASE3B-STAGE3-RUNBOOK.md`. What remains is six PowerShell files and two
hashes — implementation against a spec that is already fixed, not design.

Suite: **1600 tests, 1595 pass, 0 fail, 4 skipped.** `COMPUTER_OPERATOR` off, `app.js` has
zero references, 8090 untouched, `C:\Aroma\ComputerOperator-Test` still absent.

## Done and verified

| Thing | Evidence |
|---|---|
| `observation.js` boundary + adjudication | 36 tests. Vacuous-pass rules, field allowlists, signatures, baselines |
| Lock 1 (three proofs) | `lock1NoModelExposure.test.js` — require graph, reverse grep, live spy **proven to fire** |
| Lock 3 | 7-day sweep runs and the aged file is gone from disk; audit refuses foreign-session titles |
| Lock 6 | four-flag matrix still green with observation code present |
| `observer.ps1` | three capabilities run: 12 windows / 2496×1664 capture, nonBlack 0.995377 / 9 UIA nodes |
| `stage3-sentinel.ps1` | colour verified 1249/1250, primary-screen check, refuses to open unrecognisable |
| `stage3-baseline.ps1` | session 3: 64896 samples, both signatures 0 hits, DPI captured |
| `owner-escape-hatch.ps1` | `-Verify` passed elevated cross-session: stand-in alive → killed → PID gone, residue 0 |
| `verify-observer-kill.ps1` | both bindings, fresh stand-ins, PID polled to absent |
| GOV-001 | 3a invariant narrowing: 1 assertion moved, 11 preserved, 13 added |
| EVIDENCE-001/002/003, BACKLOG-001 | residue artefact, session-5 17/17, composite surface, EPERM flake |

## Left to build

All six are specified in the runbook. None require new decisions.

1. `stage3-harness.ps1` — the big one. Must implement, in order: mark manifest consumed
   **before measuring** (halt if it cannot be written), write `STARTED`, re-measure the
   same-round baseline **before opening any sentinel**, open own sentinel, run the three
   capabilities and Tier B rows with 20 s per-row and 5 min wall-clock timeouts,
   write-then-verify results with retry → fallback path → console dump, write `COMPLETED`.
2. `observer-kill.ps1` — Stop-ScheduledTask + Stop-Process, poll until PID absent, report
   `TIMEOUT-ORPHAN` and halt if it survives.
3. observer scheduled-task registration **with C4-level protection** — baseline XML export,
   unconditional comparison, full re-registration from backup, halt on failure. Mirror
   `tierA-probe.ps1`'s C4 block; it is the worked example.
4. `stage3-manifest.ps1` — mint both nonces, write to the evidence directory.
5. `stage3-owner-reference.ps1` — owner reference capture while session 3 is Active.
6. `verify-staging.ps1` — five derived names including `observation.js`, plus a standalone
   load returning exit 0.

Then fill `<HARNESS_HASH>` and `<HARNESS_BYTES>` in the runbook.

## Requires the Owner, elevated — cannot be verified by the assistant

- observer scheduled-task registration
- `observer.ps1` staged location SHA-256 + ACL measurement

## Working rules that produced the findings — keep them

Every one of these caught something real:

- **run it, do not parse-check it.** DPI, the wallpaper risk and the Lock 3 selectivity flaw
  were all found by executing, never by reading
- **a zero result is only evidence against a same-round positive baseline**
- **never infer from absence.** "No STARTED" had two causes and the optimistic one was wrong
- **an unexplained block is not containment** — `NO-EXCEPTION` and `UNDETERMINED` are INVALID
- **refuse, do not trim.** Dropping a bad field destroys the evidence that something tried
- **no baseline, no destructive attempt**
- report **mechanism verified** and **real value unverified** as separate columns

## Do not redo

Session 5 must stay signed in — see the standing precondition. Sleep is already disabled
(standby/hibernate AC = 0). The interactive logon, gate task, escape-hatch verification and
A4b baseline are all bound to the current session id and are lost if it drops.
