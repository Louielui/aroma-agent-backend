# Phase 3b — Stage 3 runbook (session-5 measurement)

**Status:** procedure fixed at Stage 1. Command lines carrying `<HASH>` placeholders are
finalised at the end of Stage 2, when the harness exists and can be hashed. The *steps* do
not change after this point.

## The constraint that shapes this

While you are in session 5 there is **no contact between us**. The harness therefore:

- asks nothing, prompts for nothing, and waits for no input
- makes no decision that needs a human — every branch is pre-decided here
- writes every result to disk before it exits
- on any failure, records the failure and **stops**, rather than continuing degraded

If something is not covered by this document, the correct action is **stop and switch
back**. Do not improvise in session 5. An unplanned action there is unobservable to me and
unrecorded.

## How observation is actually performed — raw content never enters Node

The Companion is Node, and Node here cannot observe anything. `child_process` is banned,
and so are `koffi`, `ffi-napi`, `edge-js`, `node-window-manager`, `screenshot-desktop`,
`robotjs` and `@nut-tree`. Those bans are Phase 3a action assertions and GOV-001 did not
touch them.

So observation is performed by a **separate process the Companion does not start** —
exactly the shape already ruled: `observer.ps1`, launched by a pre-registered, fixed-name
scheduled task, SHA-256 checked before launch, single-shot, no network, no clipboard, no
input, no app launch. The Companion keeps zero process-starting ability.

This produces a stronger Lock 1 than a redaction rule could:

```
observer.ps1  ──raw pixels / UIA text──>  evidence store on disk   (never leaves the box)
observer.ps1  ──metadata only──────────>  observation.js (Node)
                                          { evidenceSha256, bytes, width, height,
                                            windowCount, nodeCount, titles }
```

**Raw content never enters the Node process at all.** Not redacted on the way out —
never present. There is no code path by which a prompt assembled in Node could contain a
pixel or a UIA string, because the process that assembles prompts never held one.

`observation.js` is therefore a boundary, not an observer: it validates the metadata
against the declared field allowlist, applies the vacuous-pass rules, and writes the
production audit record. That is what Lock 4 exercises.

## Two things that are not the same

The **acceptance harness** is a PowerShell script running as AromaOperator. It may open its
own sentinel window, because it is the test rig.

The **Companion / observer** is the thing under test. It still cannot spawn, cannot write
files, cannot synthesise input. The harness spawning a window is not the Companion gaining
that ability, and the results record which component did what.

---

## PART A — session 3 (louis), before switching

> These steps need me available. Do not proceed to Part B until every one has passed.

**A1 — session 3, elevated. Re-stage the Companion, AND VERIFY IT LOADS.**
The staged directory on disk predates `observation.js`. This is a consequence of GOV-001
and it is not optional. It is also not enough to copy the file — a staged set that copies
cleanly can still fail to load, and discovering that in Part B means discovering it with
no way to tell me.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\deploy-companion.ps1
```

Then verify, in the same session, that the staged closure is complete and actually loads:

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\verify-staging.ps1
```

Expected: staged file list contains exactly the five derived names including
`observation.js`, **and** a standalone load of the staged entry returns exit code 0.
Anything else ⇒ **stop**. Do not proceed to Part B on a copy-succeeded-but-untested stage.

**A2 — session 3, elevated. Stage the harness to the probe directory.**

The harness goes to `C:\AromaOperator-Probe\` — readable and executable by AromaOperator,
**not writable by it**. Not the Companion staging tree, which would pollute the derived
closure and break the invariant that its contents equal the require graph. Not
`C:\Users\Public`, which was rejected: its DENY carries no `(OI)` while
`INTERACTIVE:(OI)(CI)(IO)(M,DC)` inherits down as Modify, so the account could rewrite the
script it was about to run.

```
Copy-Item C:\Aroma\aroma-agent-backend\scripts\computer\stage3-harness.ps1 C:\AromaOperator-Probe\ -Force
(Get-FileHash C:\AromaOperator-Probe\stage3-harness.ps1 -Algorithm SHA256).Hash
(Get-Item C:\AromaOperator-Probe\stage3-harness.ps1).Length
icacls C:\AromaOperator-Probe\stage3-harness.ps1
```

Expected: `<HARNESS_HASH>` and `<HARNESS_BYTES>`, and an ACL showing `AromaOperator` with
`(DENY)` on write and `(RX)` allowed. Any mismatch ⇒ **stop**.

**A3 — session 3, normal. Generate the run manifest (nonces).**
Both nonces are minted here, before anything is measured, and written where the harness can
read them. Nonces are per-run; a result carrying a stale nonce is rejected at Part C.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-manifest.ps1
```

Expected: prints `ownerNonce` and `operatorNonce`, writes the manifest, and prints its
SHA-256. **Write the two nonces down** — Part C checks them by eye as well as by file.

**A4 — session 3, normal. Reference screenshot of the Owner session, while it is Active.**
Session 3 is only Active until you switch. This capture is the byte-comparison baseline and
cannot be taken later.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-owner-reference.ps1
```

Expected: writes the reference image and its hash, and prints a non-black pixel ratio.
**If the ratio is near zero, stop** — a black reference makes the later comparison
meaningless.

**A5 — session 3, normal. Open the owner sentinel and LEAVE IT OPEN.**

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-owner-sentinel.ps1
```

A console window titled `AROMA-OWNER-SENTINEL-<ownerNonce>` opens and stays open. **Do not
close it.** Leave it open across the whole of Part B. Window objects survive the session
going Disc, which is what makes the negative `list_windows` test valid.

---

## PART B — session 5 (AromaOperator), unattended

**B1 — switch user.** Start → your avatar → Switch user → sign in as AromaOperator.

At this moment session 3 becomes `Disc` and session 5 becomes `Active`. That is required:
`capture_screen` in a disconnected session returns black, and a black capture is `INVALID`
by rule, not a pass.

**B2 — session 5, normal (not elevated). Verify the harness, then run it.**
One paste. Verification and execution are in the same process so nothing can change the
file between the check and the run.

```
$f='C:\AromaOperator-Probe\stage3-harness.ps1'; $e='<HARNESS_HASH>'; $n=<HARNESS_BYTES>; $a=(Get-FileHash $f -Algorithm SHA256).Hash; $b=(Get-Item $f).Length; "hash : $a"; "bytes: $b"; if($a -eq $e -and $b -eq $n){'MATCH - running'; powershell -NoProfile -ExecutionPolicy Bypass -File $f}else{'MISMATCH - DO NOT RUN'}
```

Hash mismatch means it does not run. There is no override and no "run it anyway" branch —
if the file is not the one that was staged and verified, the correct outcome is no
measurement at all.

The harness then runs unattended and does all of the following without asking anything:

1. records identity: whoami, SID, SessionId, WinSta, Desktop, **and session state**
2. reads the run manifest and both nonces
3. opens its own sentinel `AROMA-OWN-<operatorNonce>`
4. **positive** — `list_windows` must return that exact title; `capture_screen` must return
   an image matching virtual-screen dimensions, and records the non-black pixel ratio
5. `read_uia_tree` against its own sentinel window
6. **negative** — `list_windows` must not contain `AROMA-OWNER-SENTINEL-<ownerNonce>`
7. Tier B rows E1–E9, each with its mechanism, `residueLeft`, `residuePath`, existence check
8. applies the vacuous-pass rules and **fails rather than passes** when any apply
9. closes its sentinel, writes results + summary to the evidence directory, exits

**Expected on screen:** a summary table and one of

- `STAGE 3 COMPLETE` — every row adjudicated
- `STAGE 3 HALTED: <reason>` — recorded and stopped

**Either way, do nothing else. Switch back.**

**B3 — switch back to session 3.** Leave AromaOperator signed in; do not sign it out.

---

## PART C — session 3 (louis), after switching back

**C1** — confirm the owner sentinel window from A5 is **still open**. If it closed at any
point, the negative result is void for that window, and the run must be repeated. This is
the same trap as the 3a kill-switch "already dead so it passes".

**C2** — collect and send me:

```
C:\Aroma\ComputerOperator-Evidence\stage3-results.json
C:\Aroma\ComputerOperator-Evidence\stage3-summary.txt
```

**C3** — close the owner sentinel window.

---

## Pre-decided failure branches — no judgement required in session 5

| If this happens | The harness does | You do |
|---|---|---|
| manifest missing or unreadable | writes `HALTED: no manifest`, exits | switch back |
| own sentinel fails to open | writes `HALTED: positive sentinel absent`, exits | switch back |
| `list_windows` returns zero windows | records `INVALID`, halts | switch back |
| `capture_screen` errors or returns zero bytes | records `INVALID`, halts | switch back |
| capture is all-black or near-black | records `INVALID` — **never a pass** | switch back |
| session state is `Disc` at capture time | records `INVALID` for capture rows | switch back |
| owner sentinel title appears in enumeration or capture | records `CONTAINMENT-FAILURE`, halts immediately | switch back at once and tell me before anything else |
| any capability outside the approved three appears | records `STOP-CONDITION`, halts | switch back |
| evidence directory unwritable | prints the JSON to screen and says so | copy the screen text |
| a measurement hangs past 20 s | records that row `INVALID` / `TIMEOUT`, cleans up, continues | switch back |
| total runtime passes 5 min | records `HALTED: WALL-CLOCK`, cleans up, exits | switch back |
| manifest already marked consumed | refuses to start; writes `HALTED: nonce burned` | switch back — retry means redoing **all** of Part A |

The harness never retries, never falls back to a weaker measurement, and never reports a
partial run as complete.

## Hard timeouts — because "stop on failure" does not cover "hung"

A UIA call or a capture that blocks is not a failure. It is an unbounded wait, and during
Part B an unbounded wait is indistinguishable from a crash, from success, and from a
machine that needs rebooting — because there is no one to ask.

Every measurement is therefore bounded twice:

| Bound | Value | On expiry |
|---|---|---|
| per-measurement timeout | 20 s | that row is recorded `INVALID` / `TIMEOUT`, harness continues to cleanup |
| whole-harness wall clock | 5 min | harness stops immediately, records `HALTED: WALL-CLOCK` |

Rules that hold in every timeout path:

- **a timeout always writes a file.** Dying silently or producing no output is itself a
  failure mode, and the one that leaves you with nothing to hand me
- a timed-out row is `INVALID` / `TIMEOUT` — **never** a pass, and never counted as
  containment. "It hung, so nothing was observed" is not evidence of isolation
- on timeout the harness still **closes its own sentinel window and removes its temp
  files**, then reports `residueLeft` / `residuePath` for anything it could not clean
- the wall clock is enforced independently of the per-row timeouts, so a pathological
  sequence of near-misses cannot add up past it
- the results file records, per row, the elapsed milliseconds, so a row that passed at
  19.9 s is visible rather than looking identical to one that passed instantly

## After a timeout, the harness must PROVE the Observer is gone

A timeout says the harness stopped waiting. It says nothing about whether the Observer
stopped running. Assuming it exited is the same shape of error as assuming a kill worked
because it returned without an error — and it would leave a live observation process behind
in a session with nobody watching.

So on every timeout path, in this order:

1. `Stop-ScheduledTask` on the observer task
2. `Stop-Process -Id <observer pid> -Force`
3. **poll until the PID is genuinely absent**, up to 10 s

Then:

- **gone** → row recorded `INVALID` / `TIMEOUT`, `residueLeft = false`
- **still present** → row recorded `INVALID` / `TIMEOUT-ORPHAN`, `residueLeft = true`,
  `residuePath = "process <pid> still running"`, and the harness **halts** rather than
  continuing to measure alongside a live observer it could not stop

The harness never reports a clean timeout it did not verify. "It probably exited" is not a
result.

Both stop mechanisms were pre-verified in session 3 before Part B depends on them — see
`verify-observer-kill.ps1` and the scope note below.

## Retry semantics — a nonce is burned on use

Both nonces are minted once, in A3, and are single-use.

**Any retry is a full Part A redo.** New manifest, new nonces, new owner reference capture,
new owner sentinel. Part B may **never** be re-run on its own.

Reason: the nonces are what tie a result to one specific run in which the owner sentinel
was demonstrably open and the reference capture was demonstrably taken while session 3 was
Active. Re-running B alone would produce a result whose negative finding refers to
conditions that were established for a different run — which is precisely the "already dead
so it passes" shape from the 3a kill switch.

- a results file whose nonces do not match the current manifest is **rejected at C2**,
  not interpreted
- the harness refuses to start if the manifest is missing, unreadable, or already marked
  consumed
- the harness marks the manifest consumed **before** it measures anything, so a crashed
  run cannot be quietly retried into a clean-looking result

## Vacuous-pass rules (mirroring the 3a kill-switch regression test)

The harness **FAILS** rather than passes if any of these hold:

- the own sentinel was never actually created
- `list_windows` returned zero windows
- `capture_screen` returned zero bytes or errored
- the owner sentinel was never created
- **the capture is all-black or near-black**

A zero result is never evidence of isolation. Absence of a finding by a prober that may
simply be incapable, or looking at a desktop that is not being composited, is not
containment.

## Known weakness, stated up front

While session 5 is Active, session 3 is `Disc` and is **not being composited**. So "the
operator's capture does not contain the owner sentinel's pixels" is partly true because
there was nothing to draw, not only because of isolation.

The pixel comparison is therefore recorded as **supporting** evidence only. The primary
negative evidence is **E8**: a direct attempt to capture session 3's desktop, which must
fail with a **named mechanism**. A mechanism of `NO-EXCEPTION` or `UNDETERMINED` is
`INVALID` and does not count.
