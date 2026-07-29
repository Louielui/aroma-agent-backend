# Phase 3b — final operating checklist, at the physical console

**Read this through before starting.** Two switches into session 5 and back; everything
else is in session 3. Part B is one paste.

Already done, elevated, and not repeated here: `deploy-companion.ps1` (three kill bindings
demonstrated against a live Companion, 17/17 CONTAINMENT HOLDS), `register-observer-task.ps1`
(Interactive/Limited, 0 triggers, observer SHA `910618A1…`/13226, C4 baseline XML
`338ac8cd…`), `verify-staging.ps1` (closure match True, standalone load exit 0).

---

## STEP 0 — session 3, no elevation. VERIFY WHO AND WHERE YOU ARE

Everything measured so far in session 3 was measured **over RDP**. At the console the
session may reconnect with the same id or be a new one, and the display may not be the same
size. Neither has been measured. This step is not a formality.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-console-check.ps1
```

**Expected:** `STEP 0 OK - at the console, session 5 present.`

**Already measured once at the console, and the display DID change:**

| | over RDP | at the console |
|---|---|---|
| dpiX | 144 | **120** |
| resolution | 2496 × 1664 | **1920 × 1080** |
| whole-screen samples | 64,896 | **32,400** |
| **sentinel samples** | 1,250 | **1,250 — unchanged** |
| positive / negative thresholds | 500 / 20 | **unchanged** |

This is exactly the risk that made this step necessary, and the load-bearing numbers
survived only because the sentinel is specified in **physical pixels** with WinForms
auto-scaling off. Had it been sized in logical units, the 400 × 200 floor would have meant
something different on each display and the thresholds would have silently drifted.

| If | Do |
|---|---|
| `*** STOP ***`, `AromaOperator still signed in : False` | Session 5 is gone. Gate task, escape-hatch verification and A4b baseline are all bound to that session id and must be redone. **Report before touching anything** |
| `NOT AT THE CONSOLE` (exit 21) | You are still on RDP. Steps 2–4 must be at the console. Sit at the machine and re-run |
| session id is **not 3** | Not fatal on its own — session 3 was only ever the Owner side. **Note it and report** |
| resolution differs again from `1920 × 1080 / 120` | Not fatal. Only the whole-screen total moves; the sentinel figure and thresholds do not. **Record the numbers** and carry on |

---

## STEP 0b — session 3, ELEVATED. Stage everything session 5 will need

**This step was missing and it would have cost a full Part A redo.** AromaOperator cannot
read `C:\Aroma` at all — `listRepo` = false, 17/17 — so every script the harness touches
must already be in `C:\AromaOperator-Probe\`.

Verified by inspection of `stage3-harness.ps1`: exactly **one** script dependency
(`observer.ps1`, line 360), **zero** dot-sourcing, and no path under `C:\Aroma` other than
the evidence directory, which is explicitly allowed. `stage3-baseline.ps1` is also needed
there because STEP 1 runs it from session 5.

```
Copy-Item C:\Aroma\aroma-agent-backend\scripts\computer\stage3-harness.ps1  C:\AromaOperator-Probe\ -Force
Copy-Item C:\Aroma\aroma-agent-backend\scripts\computer\observer.ps1        C:\AromaOperator-Probe\ -Force
Copy-Item C:\Aroma\aroma-agent-backend\scripts\computer\stage3-baseline.ps1 C:\AromaOperator-Probe\ -Force
Get-ChildItem C:\AromaOperator-Probe\*.ps1 | ForEach-Object { '{0}  {1}  {2}' -f $_.Name, (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Length }
```

Compare every line against the table at the end of this file. Any mismatch ⇒ **stop**.

## STEP 1 — switch to session 5, run the A4b baseline, switch back

The one thing that cannot be checked from session 3. DPI is per-user and the fresh profile
carries the default wallpaper.

**1a.** Start → your avatar → **Switch user** → sign in as **AromaOperator**.

**1b.** Session 5, no elevation:

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AromaOperator-Probe\stage3-baseline.ps1
```

**Expected:** `BASELINE OK`, with **`OWN signature hits : 0`** and **`OWNER signature hits : 0`**.

| If | Do |
|---|---|
| either signature count is **not 0** | Right-click desktop → Personalise → Background → **Solid colour → black**. Re-run. Do **not** proceed until both are 0. Do not loosen anything to make it pass |
| DPI differs from what STEP 0 showed | Note both numbers and **carry on** — session 5 is the one that matters for the harness. Report the pair |
| the script will not run | **STOP and report.** Do not improvise |

**1c.** Switch back to **louis** (leave AromaOperator signed in).

---

## STEP 2 — session 3, no elevation. Mint the manifest

> Steps 2–4 must be done **at the console**, not over RDP. RDP and console can differ in
> resolution and DPI, and the owner reference capture and sentinel are compared against
> numbers taken here.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-manifest.ps1
```

**Expected:** prints `ownerNonce` and `operatorNonce`. **Write both down.**

| If | Do |
|---|---|
| `exit 3`, "already exists and is NOT consumed" | A previous run was never used. Either use those nonces, or re-run with `-Force` to discard. Your call — but note which you did |
| any other failure | **STOP and report** |

---

## STEP 3 — session 3, no elevation. Owner reference capture

Only possible while session 3 is **Active**. Once you switch to session 5 it is gone.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-owner-reference.ps1 -ManifestPath C:\Aroma\ComputerOperator-Evidence\stage3-manifest.json
```

**Expected:** an image path, SHA-256, and `nonBlackRatio` well above 0.01.

| If | Do |
|---|---|
| `exit 5`, "not Active" | You are not at the console session. **STOP** |
| `exit 6`, black reference | Screen is blanked or locked. Wake it and re-run |

---

## STEP 4 — session 3, no elevation. Open the owner sentinel and LEAVE IT OPEN

Replace `<ownerNonce>` with the value from STEP 2.

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\stage3-sentinel.ps1 -Role owner -Nonce <ownerNonce>
```

**Expected:** a **magenta** 400×200 window, `SENTINEL VERIFIED`, and
`attestation written: …stage3-sentinel-owner-<ownerNonce>.json`.

**Leave this window open for the rest of the procedure.** Closing it voids the negative
result — and without the attestation file the harness marks E1 and E8 `INVALID` rather than
reading their absence as isolation.

| If | Do |
|---|---|
| `exit 6`, colour mismatch | Something is on top of it (NVIDIA overlay is a common one). Close overlays, re-run |
| `exit 7`, not primary screen | Move it to the primary display and re-run |
| "COULD NOT WRITE ATTESTATION" | **STOP.** Without it the negative rows cannot be adjudicated |

---

## STEP 5 — switch to session 5. THE ONE PASTE

**5a.** Switch user → **AromaOperator**.

**5b.** Session 5, no elevation. **This is the only command in Part B.** It verifies the
hash and runs only on a match — there is no override:

```
$f='C:\AromaOperator-Probe\stage3-harness.ps1'; $e='FAE20D38378812C5CF5AAEF4C8E34F23ED46D6A5FB1948A824D9E2726D29051A'; $n=27854; $a=(Get-FileHash $f -Algorithm SHA256).Hash; $b=(Get-Item $f).Length; "hash : $a"; "bytes: $b"; if($a -eq $e -and $b -eq $n){'MATCH - running'; powershell -NoProfile -ExecutionPolicy Bypass -File $f}else{'MISMATCH - DO NOT RUN'}
```

**Expected:** `MATCH - running`, then a row table, then `STAGE 3 COMPLETE` or
`STAGE 3 HALTED: <reason>`.

**Either way, do nothing else.** Every branch is already decided — no judgement is needed
here, which is the point.

| If | Do |
|---|---|
| `MISMATCH` | Do **not** run it. Switch back and report |
| `STAGE 3 HALTED: …` | Normal, recorded outcome. Continue to STEP 6 |
| it appears stuck for **more than 6 minutes** | The wall clock is 5 min. Wait to 6, then see the escape hatch below — but **only after STEP 7** |

---

## STEP 6 — session 5, BEFORE switching back. Confirm the result exists

The last-resort console dump is on **this** screen. Once you switch away you cannot read
it, and closing the window destroys it.

```
Test-Path C:\Aroma\ComputerOperator-Evidence\stage3-results.json
```

| If | Do |
|---|---|
| `True` | Good. **Still leave the PowerShell window open** |
| `False` | **DO NOT CLOSE THE WINDOW.** The console holds the dumped JSON and is the only copy. Scroll up, select all, copy, and save it to **`%USERPROFILE%\manual-results.txt`** — *not* the probe directory, which AromaOperator cannot write to by design. Only then continue |

---

## STEP 7 — switch back to louis

Leave AromaOperator signed in. Leave the harness window open. Leave the owner sentinel open.

---

## STEP 8 — session 3, no elevation. Collect

```
Get-Content C:\Aroma\ComputerOperator-Evidence\stage3-manifest.json
Get-ChildItem C:\Aroma\ComputerOperator-Evidence\stage3-*
```

Send me `stage3-results.json`, both marker files, and the manifest.

**The manifest decides whether a redo is needed — not the evidence directory.**

| Manifest | Ruling |
|---|---|
| `consumed: false` | nonce unused; Part B may be re-run alone |
| `consumed: true` | nonce burned; **full Part A redo** |
| unreadable / missing | **full Part A redo** — the safe direction |

Close the owner sentinel and the harness window **only after** I have confirmed the results
are readable.

---

## ESCAPE HATCH — and when it may be used

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Aroma\aroma-agent-backend\scripts\computer\owner-escape-hatch.ps1
```

Session 3, **elevated**. Unelevated it cannot work: cross-session `PROCESS_TERMINATE`
returns `ERROR_ACCESS_DENIED`, measured with a positive control.

### It kills the harness too

Default mode stops the observer task and terminates **any PowerShell running as
AromaOperator in a session that is not yours** — which includes the harness itself. It
cannot tell a stuck observer from a working one.

**Only use it when all of these hold:**

- you are back in session 3 (STEP 7 done)
- the harness is believed stuck or dead — over 6 minutes with no `COMPLETE` or `HALTED`
- you have already done STEP 6, or accepted that the console dump will be lost

**Never** run it while the harness is legitimately running. It would kill a healthy run
mid-measurement, burn the nonce, and cost a full Part A redo — the exact outcome it exists
to avoid.

Expected: per-target `gone : True` and `residueLeft : False`. Anything still running is
reported with its PID.

---

## Staged-file hash table — check STEP 0b against this

| file | SHA-256 | bytes |
|---|---|---|
| `stage3-harness.ps1` | `FAE20D38378812C5CF5AAEF4C8E34F23ED46D6A5FB1948A824D9E2726D29051A` | 27854 |
| `observer.ps1` | `910618A13F66FA6F70E436AE202150BE75862E70C7D2F6ABBAA9F5A67E6B6700` | 13226 |
| `stage3-baseline.ps1` | `F8494D0FF9FDD6390DC10CAF3DC28CDD2AE2D9FA629A714C64B347794FCE2298` | 10247 |

`observer.ps1` is unchanged from the hash recorded when the Observer task was registered,
so the task's SHA pin still matches.

**The harness hash changed** from the earlier `8C0D5D55…`/27449. That earlier build wrote
its fallback into the probe directory, which AromaOperator cannot write to — the fallback
could never have fired. Re-stage; do not run the old one.
