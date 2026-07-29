# Phase 3b — final operating checklist, at the physical console

**Read this through before starting.** Two switches into session 5 and back; everything
else is in session 3. Part B is one paste.

Already done, elevated, and not repeated here: `deploy-companion.ps1` (three kill bindings
demonstrated against a live Companion, 17/17 CONTAINMENT HOLDS), `register-observer-task.ps1`
(Interactive/Limited, 0 triggers, observer SHA `910618A1…`/13226, C4 baseline XML
`338ac8cd…`), `verify-staging.ps1` (closure match True, standalone load exit 0).

> **SUPERSEDED 2026-07-29 — `register-observer-task.ps1` must be re-run.** `observer.ps1`
> changed to `5281BC37…`/14216, so the SHA in that task's description no longer describes
> the staged file. Back up `observer-task-baseline.xml` before re-running; it is overwritten
> in place. Full detail in the hash table at the end of this file.

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
$f='C:\AromaOperator-Probe\stage3-harness.ps1'; $e='0A4DC9E44BEC3F4111248EEC2C8D7B1CE716810BC20FAFBC846D29D0C4C8FE91'; $n=29039; $a=(Get-FileHash $f -Algorithm SHA256).Hash; $b=(Get-Item $f).Length; "hash : $a"; "bytes: $b"; if($a -eq $e -and $b -eq $n){'MATCH - running'; powershell -NoProfile -ExecutionPolicy Bypass -File $f}else{'MISMATCH - DO NOT RUN'}
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

**Updated 2026-07-29.** Every row below was re-measured, not carried over.

| file | SHA-256 | bytes |
|---|---|---|
| `stage3-harness.ps1` | `F7ADEB9016FD8C82F1B00913C07DE11F0012C7924B34759A222B863C7CB22BEC` | 34917 |
| `observer.ps1` | `5281BC37E5EB028D5609680B4A10687C2D9BEC82954B7ABBFDE7341709F89FE9` | 14216 |
| `stage3-baseline.ps1` | `EBAF59DF3CACBCD9F5DD775EBA64B6DB2BB5E9E606FAF3A1538B403E8298B5D6` | 10244 |
| `tierA-probe.ps1` | `B61AE1EC3ABBE93313BDBE34D5F4538E28B7CBCD08FA7736A2DF85902F5C8D41` | 34178 |
| `assertionRegistry.ps1` **new** | `22F88E59838090F8261261FEB0E576442BD333D32A2DF18FF90BD13A77C35C18` | 10098 |
| `assertion-registry.json` **new** | `E79C5D6000AC25228E6528372D8AC086CE1839471815825A1E29E16A896E932F` | 26505 |
| `stage3-topup.ps1` **new** | `AF770CAB4B189819A4DF9670EA73CAC899D11D0EFB88EFE79B2716151559874E` | 32863 |

`stage3-owner-clip.ps1` (`5E4083F05172484CE4C921D3A76E03EA535571FCF2CFF39837EB0F60B56B0BC6`,
13810) runs on the OWNER side in session 3 and is **not** staged into the probe directory.

> These hashes are of the repo working tree as it stands. This repo normalises line endings
> on checkout, so a fresh clone will hash differently. Copy from
> `C:\Aroma\aroma-agent-backend\scripts\computer\`, then `Get-FileHash` the staged copy and
> compare. If it does not match, stop.

### `observer.ps1` CHANGED — and the sentence that used to be here was the drift

This table previously said *"`observer.ps1` is unchanged from the hash recorded when the
Observer task was registered, so the task's SHA pin still matches."* **That is now false.**
The observer changed on 2026-07-29 (per-node read failures are counted instead of swallowed;
a zero-node read returns a named refusal instead of `ok = true`):

```
910618A1…  13226   ->   5281BC37…  14216
```

**The task will still start.** The SHA is recorded in the task DESCRIPTION only —
Task Scheduler verifies nothing, and no code reads that string at run time. What actually
protects the staged file is its ACL: an explicit DENY on Write / Delete / ChangePermissions
/ TakeOwnership for AromaOperator, plus ALLOW ReadAndExecute. So the pin is a **record, not
a gate**, and its failure mode is precisely the one this project keeps finding: copy a new
file in, everything keeps working, and the record quietly describes a file that is gone.

So `register-observer-task.ps1` must be re-run elevated — **and back the C4 baseline up
first**, because it writes `observer-task-baseline.xml` to a fixed filename with
`Set-Content` and the previous baseline is overwritten with no copy kept:

```
Copy-Item 'C:\Aroma\ComputerOperator-Evidence\observer-task-baseline.xml' `
          'C:\Aroma\ComputerOperator-Evidence\observer-task-baseline-pre-uiafix-20260729.xml'
```

Nothing reads that baseline yet — the script's own closing note asks for an observer-task row
in the Tier A probe and **that row was never added**, so no check would have noticed the
overwrite either.

**The harness hash also changed twice.** `8C0D5D55…`/27449 (fallback written into a directory
AromaOperator cannot write to — it could never have fired) → `0A4DC9E4…`/29039 → the current
`F7ADEB90…`/34917 (reads the assertion register; refuses to print STAGE 3 COMPLETE when the
cross-check is dirty). Re-stage; do not run an older one.

**`stage3-harness.ps1` and `tierA-probe.ps1` now EXIT 13** if `assertionRegistry.ps1` and
`assertion-registry.json` are not beside them in the probe directory.
