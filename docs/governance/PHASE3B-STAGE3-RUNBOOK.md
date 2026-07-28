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

**A4b — SESSION 5, as AromaOperator. Baseline the things that do NOT carry over.**

> This is the one Part A step performed in session 5. Switch in, run it, switch back.
> It must pass before any sentinel is opened.

Two properties were verified in louis's session and are **not** inherited:

1. **DPI is a per-user setting.** AromaOperator is a fresh profile and may be at a
   different scale. The entire sampling arithmetic — 64,896 whole-screen samples, 1,250
   sentinel samples, the 500/20 thresholds — is stated in physical pixels measured in
   session 3. If session 5 differs, none of it applies.
2. **The desktop is not neutral.** A fresh profile carries the Windows 11 default
   wallpaper, which is full of purples and pink-magentas. The owner signature is magenta
   at tolerance 12 and trips on 20 samples. A wallpaper false positive would raise a
   `CONTAINMENT-FAILURE` for something that never happened — worse than a miss, because it
   halts everything to investigate a fiction.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AromaOperator-Probe\stage3-baseline.ps1 -Session3Json C:\Aroma\ComputerOperator-Evidence\baseline-session3.json
```

Expected: `BASELINE OK`, with **`OWN signature hits : 0`** and **`OWNER signature hits : 0`**
on a clean desktop, and DPI matching session 3.

Session 3 reference for comparison, measured: `dpiX 144`, physical `2496 x 1664`,
`scaling 1`, `64896` sampled points, both signature counts `0`.

**If it fails:**

- *signature present on the clean desktop* → set this account's desktop background to a
  **solid neutral (black or mid grey)**, remove the wallpaper, re-run. **Do not loosen the
  tolerance or raise the threshold to make it pass** — that trades a false alarm for a real
  miss, which is the wrong direction.
- *DPI differs from session 3* → **stop and report.** The coordinate arithmetic does not
  carry over and every downstream count would be wrong.

**A5 — session 3, normal. Open the owner sentinel at the REQUIRED SIZE, and LEAVE IT OPEN.**

The non-black ratio is sampled on a grid of step **8 px**, because scanning ~2M pixels in
PowerShell is slow enough to trip the per-measurement timeout. That has a consequence:

> a feature smaller than the grid step can fall **between** sample points entirely, so
> "no owner pixels found" could mean the sampling missed them.

A region is only guaranteed to contain at least one sample point once it spans the step in
both dimensions — 8 × 8 px, 64 px². That is the bare guarantee and it is not good enough to
rely on: one sample point is detectable in principle and unreliable in practice.

**The owner sentinel window must therefore be at least 400 × 200 px**, which lands on
**1250** sample points. The script sets this size; if it cannot, it fails rather than
opening a smaller window.

A capture row whose sentinel is below this floor is adjudicated `INVALID` —
`sentinel-below-detection-floor` — so a sampling miss can never be recorded as isolation.

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

0. **re-measures the clean-desktop baseline itself, before opening any sentinel.** A4b is a
   *gate* — it decides whether Part B may begin at all. This is a *same-round reference*,
   and the two are different obligations, not a repeat. By the time Part B runs, A4b is
   minutes or hours old, and a notification, a pop-up or a stray window in between would
   invalidate it silently. Under M3 a zero result is evidence only against a baseline from
   the same round.
   - either signature count non-zero → `INVALID` immediately; **no sentinel is opened and
     nothing is measured**
   - DPI differs from the A4b gate reading → `HALT`
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

**B3 — session 5. CHECK THE RESULT FILE EXISTS *BEFORE* SWITCHING BACK.**

The last-resort console dump is printed to the screen **in session 5**. Once you switch
away you cannot read it, and closing that PowerShell window destroys it outright. So the
check happens while you are still there:

```
Test-Path C:\Aroma\ComputerOperator-Evidence\stage3-results.json
```

- **True** → the result is on disk. Still **leave the PowerShell window open** until the
  results have been reviewed; if anything is wrong with the file, the console is the only
  remaining copy.
- **False** → **do not close that window.** The console holds the dumped JSON and it is the
  only record. Scroll back, select all, copy it out to a file under
  `C:\AromaOperator-Probe\` or read it directly. Only then switch back.

Do not close the session-5 PowerShell window at any point until the results have been
reviewed and confirmed readable.

**B4 — switch back to session 3.** Leave AromaOperator signed in; do not sign it out, and
do not close the harness window.

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

**C3** — check the manifest consumption record, because it and not the evidence directory
decides whether a redo is needed:

```
Get-Content C:\Aroma\ComputerOperator-Evidence\stage3-manifest.json
```

Unreadable, missing or ambiguous ⇒ full Part A redo.

**C4** — only after the results have been reviewed and confirmed readable: close the owner
sentinel window, and close the session-5 harness window.

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

## Result writing must survive its own failure

Timeouts cover "hung". `HALT` covers "went wrong". Neither covers **the write of the result
file failing** — and on this machine that is a live risk, not a hypothetical: BACKLOG-001
records an intermittent `EPERM` on `rename` under the system temp directory caused by a
transient lock.

If that happened at the end of Part B, you would switch back to nothing at all, unable to
tell "it ran and could not write" from "it never ran" — and the nonce is already burned, so
the cost of guessing wrong is a full Part A redo.

So the harness leaves a trail rather than a single artefact:

| Marker | Written | Contains |
|---|---|---|
| `stage3-STARTED-<nonce>.json` | first thing, before anything else | nonce, timestamp, session id, session state, DPI block, identity |
| `stage3-results.json` | after measurement | the full record |
| `stage3-COMPLETED-<nonce>.json` | last thing | nonce, timestamp, row count, verdict summary |

**Result writing is write-then-verify.** After writing, the harness reads the file back and
compares. On mismatch it retries; if it still cannot, it writes to a fallback path and
**prints the entire JSON to the console**, so the screen itself becomes the record of last
resort.

### How to read what you find

| On return you see | It means |
|---|---|
| `STARTED` + `results` + `COMPLETED` | the run finished; read the results |
| `STARTED` + `results`, no `COMPLETED` | it died after measuring — the results are real but possibly partial. Send them and say so |
| `STARTED`, no results | **it ran and could not write.** Not "it never ran". Check the console for the dumped JSON before doing anything else |
| no `STARTED` at all | **inconclusive on its own — see below.** Two different things produce an empty evidence directory |
| `COMPLETED` without `STARTED` | should be impossible. Treat as untrustworthy and re-run the whole of Part A |

**`STARTED` with no results is a different situation from no `STARTED`** — and without the
markers both look identical.

### Whether a redo is needed is decided by POSITIVE EVIDENCE, never by absence

An empty evidence directory has two causes, and they need opposite responses:

- the harness never launched — hash mismatch, execution policy, never started
- the harness ran and **could not write to the evidence directory at all**, which is
  exactly the BACKLOG-001 failure mode, in which case `STARTED` is missing for the same
  reason the results are

Reading "no `STARTED`" as "it never ran" picks the optimistic branch of an ambiguity. A
zero result cannot explain itself.

**The manifest consumption record is the authority.** The harness marks the manifest
consumed *before* it measures anything, so:

| Manifest says | Ruling |
|---|---|
| explicitly **not consumed** | the nonce is unused. Part B may be re-run without redoing Part A |
| **consumed** | the nonce is burned. **Full Part A redo**, whatever the evidence directory does or does not contain |
| **unreadable, missing, or ambiguous** | **default to a full Part A redo** — the safe direction |

Absence of `STARTED` is a *clue* that narrows where to look. It is never the ruling.

"The nonce is unused" may only be stated when the manifest **positively shows** it
unconsumed.

**Manifest location.** It must be writable by AromaOperator — it is marked consumed from
session 5 — and readable by the Owner from session 3. It therefore lives in the evidence
directory, which is the one location measured to satisfy both (`writeEvidence` = true in
the v1 set, EVIDENCE-002).

If the manifest itself cannot be written, the harness **halts before measuring**: a run
whose consumption cannot be recorded is a run that cannot be adjudicated afterwards.

## OWNER ESCAPE HATCH — when the harness itself is what died

The timeout path above depends on the harness being alive to run it. If the harness
crashes, or session 5 misbehaves, an Observer can be left running with nothing to stop it —
and back in session 3 you cannot stop it either. Measured, non-destructively, with a
positive control so it is a named mechanism rather than an assumption:

```
POSITIVE CONTROL  own session-3 process   canTerminate = True   OK
CROSS-SESSION     session-5 process       canTerminate = False  ERROR_ACCESS_DENIED
```

Unelevated, there is no cross-session kill. That is consistent with E6 and it is the
finding, not an inconvenience. **The escape hatch therefore requires elevation.**

### Verify it BEFORE Part A — session 3, elevated

The hatch must not be used for the first time in anger.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\owner-escape-hatch.ps1 -Verify
```

This registers a stand-in **as AromaOperator, in session 5**, via an interactive-token task
(which is why AromaOperator must already be signed in), proves it alive by reading back the
PID it wrote, kills it from session 3, and polls until the PID is genuinely absent. It
refuses to claim success if the stand-in was never proven alive, or if it landed in our own
session and so tested nothing cross-session.

Expected: `ESCAPE HATCH VERIFIED (elevated, cross-session)` and `residueLeft : False`.
Anything else ⇒ **do not begin Part A**.

### Use it — session 3, elevated, paste as-is

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\owner-escape-hatch.ps1
```

Stops the observer task, then terminates any PowerShell host running as `AromaOperator` in
a session that is not yours, polling each until gone and reporting residue for any it could
not stop. Deliberately narrow — it does not sweep that account's whole session.

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

**Stated once, plainly, so no report can drift from it: a pixel comparison NEVER on its own
constitutes evidence of isolation.** It has two independent ways of being trivially true —
the other session was not being composited, and the sampling grid can miss a small feature —
and neither has anything to do with containment. E8 is the primary evidence; the pixel
result is corroboration or it is nothing.

### Not-found is a zero result

Any observation returning `no_target_window` — or any other not-found refusal — is
adjudicated `INVALID` (`not-found-result`). The observer's ProcessId fallback finds nothing
when its own console window belongs to conhost; Part B uses `-TitleFilter`, but if anything
ever routes back to the fallback, the negative assertion would otherwise collect a cheerful
"owner window not found" that means only that the observer looked in the wrong place.

The observer looking and finding nothing says nothing about what is there.
