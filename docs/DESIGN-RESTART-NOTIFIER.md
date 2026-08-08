# DESIGN — L2-1b: THE NOTIFIER

> **Owner GO, 2026-08-08: 「It touches the launcher, so I approve that specifically: the launcher
> is the thing being changed, the change is removing an `if`, and I want to see the exact diff
> before it runs.」**

Companion to `DESIGN-RESTART-REPAIR.md`. **APPLIED AND PROVEN 2026-08-08 — see the record at the**
**end of this file.** §5 is the diff exactly as the Owner reviewed it. Running the proofs then
forced two further fixes (#35, #36) which are NOT in that diff — they are in the record and in the
applied file. Four of the five branches were exercised; the fifth is honestly unproven.

**One correction to the brief, stated up front:** the change is *not only* removing an `if`. Four
of the five branches are exactly that. The fifth is the branch that produced the only recorded
failure in this system's history, and that failure was false — un-gating it unchanged would ship
a notification that lies on the one input history has actually supplied. §4 is that argument;
§5's diff carries the fix; taking it is the Owner's call and it is separable.

---

## 1. WHERE THE NOTIFICATION LANDS

> 「It cannot be 首頁 alone — if 8090 is down there is no 首頁.」

Correct, and it disqualifies every in-app surface. What is left, measured rather than assumed:

| channel | depends on 8090? | delivery provable? | verdict |
|---|---|---|---|
| **MessageBox** (`System.Windows.Forms`) | no | **yes — blocks until dismissed** | **chosen** |
| WinRT toast | no | **no** | rejected, §1.2 |
| Windows Event Log | no | no reader | rejected — the ErrandRecall problem exactly |
| a file on the Desktop | no | no push | rejected — becomes wallpaper |
| email / external send | no, but needs network + credentials | not locally | rejected, §1.3 |

### 1.1 Why MessageBox, and the evidence it works

It is **already in this launcher** and has **already reached him**. On 2026-07-27 the launcher
refused three times on `repo not on main` — 16:40:32, 16:43:10, 17:56:01. The first two are three
minutes apart. That gap is a human reading a dialog and doing something about it. The channel has
been seen to fire; nothing else on the list has.

It is also the only option whose **success is provable from inside the mechanism**:
`MessageBox::Show` does not return until the box is dismissed. The return is evidence a human
acted. Everything else on the list returns immediately whether or not anyone was reached.

### 1.2 Why the toast was rejected — it fails the Owner's own constraint

Probed live on this machine, 2026-08-08. The WinRT types are present, and:

```
toast: Show() returned without throwing
```

**That sentence is the entire problem.** `Show()` returns identically whether the toast was
rendered, suppressed by Focus Assist, dropped for an unregistered AppUserModelID, or silently
discarded. It is 「ran and did nothing」 reporting success — the thing that was ruled disqualifying
for a repairer. A notifier does not get an exemption from a rule written for the mechanism it is
replacing. (I cannot tell from here whether a toast actually appeared on the screen during that
probe. That inability *is* the finding.)

### 1.3 The honest answer to 「is it a Windows notification and nothing else?」

**Yes. A modal dialog in the interactive session, and nothing else.**

There is no channel that reaches him while he is logged off — not without adding an outbound
sender with credentials, a network dependency, and a failure mode that can be dead for twelve
days (`b2-sync.log` is the local precedent).

But the limitation is smaller than it looks, and the reason matters:

> **The channel's reach is exactly the scope of the need.** Her uptime is coupled to his logon
> session (`run-scheduled-errand.ps1`: *「8090 only exists while the Owner is logged on」*). If he
> is not logged on there is no box — and there is also no 8090, and nothing she was supposed to be
> doing. The notifier cannot tell him about a failure while he is away because while he is away
> there is not yet a failure with consequences.

That stops being true the moment Layer 2 gives her unattended work. That is the same trigger
already named in `DESIGN-RESTART-REPAIR.md` §5, and it is one trigger for both mechanisms rather
than two independent things to remember.

---

## 2. SHOULD THE NOTIFIER ALSO CARRY ErrandRecall's EXIT 4?

> 「a working detector whose only reader is a field nobody opens… or is two detectors reporting to
> one channel the start of the thing we keep removing?」

**Yes to the channel. No to anything that sits between them.** The distinction is sharp and it is
the one this project keeps re-learning:

> **A shared FUNCTION is a primitive. A shared PROCESS is an aggregator.**
>
> If `run-scheduled-errand.ps1` calls the same `Notify-Owner` itself, there is no new component,
> no registry of detectors, and nothing that can be dead — the detector either runs and speaks or
> does not run, exactly as today. If instead something *watches both and reports*, that is a third
> thing whose own death is unwatched, and it is the twelve-day shape with a nicer name.

This is the same rule as the shared UI primitives elsewhere in the estate: restyle once and it
cascades, because the primitive is called, not consulted.

### 2.1 But not in this change, and here is the blocker

`AromaXiangXiang-ErrandRecall` is `LogonType: Interactive` with **`StartWhenAvailable: True`**.
A missed 07:00 run fires as a catch-up shortly after the next logon — *racing the Startup
launcher*. Median start is 1.10s and the task's probe allows 10s, so the race is usually won, but
「usually」 is what §4 is about. A catch-up run that probes 200ms into logon would announce
「she is not running」 about a server that is starting normally.

That is the same false-positive class as branch 5, in a different mechanism, and it needs the
same treatment: a settle-and-re-probe before it is allowed to speak.

**So: recommended, scoped out of this diff.** Folding it in would mean this change is no longer
「the launcher, one file」, and it would carry an unproven fix for a race in a second file. It is
its own change with its own proof, and the proof is listed in §3 as case 6.

---

## 3. VERIFICATION — FIVE BRANCHES, FIVE PROOFS

> 「a notifier that has never fired is HR-47… five branches means five separate proofs, not one.」

Agreed, and it is stronger than that: **for three of the five, firing is not enough — the box must
say REFUSED, because those branches are the fail-closed design working.** A notifier that reports
correct behaviour as breakage trains the reader to dismiss it, and then it protects nothing.

Each case below is reversible, touches nothing persistent, and is run against `-Mode Startup`
(the mode that is silent today) so the proof is of the path that actually matters.

| # | branch | how to break it, safely | what must appear | reverts by |
|---|---|---|---|---|
| 1 | repo not on `main` | `git switch -c proof/notifier-1` in the repo, run `-Mode Startup` | **拒絕啟動** + the branch name | `git switch main` |
| 2 | foreign holder | a stub PowerShell TCP listener binding 8090, answering nothing | **拒絕啟動** + 「冇殺對方、冇轉 port」. The stub must still be alive afterwards | stop the stub |
| 3 | missing `HUB_TOKEN` | ~~clear it in a child process env only~~ — **this method does not work**, see below | **拒絕啟動** + names HUB_TOKEN | — |
| 4 | spawn-then-die | ~~`PORT` bound by the §2 stub~~ → **`NODE_OPTIONS` set to an invalid flag**, so node exits immediately | **啟動失敗** + exit code + the `.err.log` path, within seconds not 60s | nothing to revert — env var, one shell |
| 5 | slow start (the real 2026-07-26 case) | ~~hold the port for ~20s~~ → **a `node.cmd` shim first on `PATH`** that delays ~22s, launcher unmodified | **NOTHING.** A log line reading `SLOW: Ns` and no box | remove the shim dir from `PATH` |

⛔ **Two of the three methods above were wrong as planned, and are struck through rather than
quietly replaced** — a document about proofs is the last place to overwrite a mistaken instruction
as if it had never been given.

- **Case 3's** planned method cannot work: the branch reads the **User registry store**
  (`GetEnvironmentVariable('HUB_TOKEN','User')`), so clearing a child process env changes nothing.
  Exercising it for real means blanking a live credential. Not done — see the applied record.
- **Case 5's** planned method would have proved the *wrong branch*: holding the port makes the
  launcher's first probe return `foreign`, so it refuses (case 2) and never starts node at all.
| 6 | *(deferred, §2.1)* ErrandRecall catch-up race | run the task within 1s of launcher start | **NOTHING** — not yet built | — |

**Case 5 is the acceptance test for the whole change.** It is the only failure mode that has ever
occurred here, and the correct output is silence. A notifier that passes 1–4 and fails 5 is worse
than no notifier, because its single real-world firing would be wrong.

**Case 2 must be run against a stub, never against a real process.** Refusing to touch an unknown
port holder is the most consequential thing the launcher does; proving refusal must not involve
pointing it at anything that matters.

**What these five do not prove**, stated so the green is not read as more than it is: they prove
five *anticipated* branches on a machine with a logged-on user and a working desktop. They do not
prove the box appears during the logon storm — that needs a real reboot, and it is the one proof
that cannot be faked. It should be taken on the next real restart, deliberately, with case 1 armed.

---

## 4. THE FIFTH BRANCH IS NOT AN `if`

Removing the gate on branch 5 unchanged would produce, over the 15 days of record, **exactly one
notification — the false one.** 2026-07-26 13:06:52 logged `did not become healthy within ~15s`
while that launch's own server log read `Listening on 127.0.0.1:8090` with an empty `.err.log`,
and she was found running 8m32s later.

The first notification the Owner ever received from this mechanism would have been wrong. There is
no faster way to teach someone to dismiss a dialog.

So the diff also:

- **polls 60s instead of 15s** — the median is 1.10s and the max 6.43s, so this costs nothing on a
  normal start (the loop breaks the moment `/health` answers) and removes the only observed
  false positive;
- **takes `-PassThru`** so 「still starting」 and 「the process is gone」 are different facts with
  different words, instead of both being 「timeout」;
- **does not notify a slow start at all** — it logs `SLOW: Ns`, so the next argument about this
  budget has data rather than one anecdote.

This is ~20 lines and it is separable. Branches 1–4 are pure un-gating and can be taken alone.

---

## 5. THE EXACT DIFF

`scripts/launcher/xiangxiang-body.ps1`, **50 insertions, 11 deletions, one file.** Parses clean
(`[Parser]::ParseFile` → no errors). **Not applied.**

**No pin update is needed.** `governance/launcherPin.js` pins the sha256 of the **shim**
(`C:\Aroma\xiangxiang.ps1`), not the body — the body is protected by living in the repo, where
every change is a diff. This change does not touch the shim.

```diff
@@ -21,6 +21,27 @@ function Write-Log([string]$m) {
 function Show-Msg([string]$text) {
   try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($text, '香香') | Out-Null } catch { }
 }
+# ── THE NOTIFIER (L2-1). Every failure below used to be gated on -Mode Open, so at boot —
+# the only time a restart happens unattended — it was silent BY CONSTRUCTION. The detector
+# already existed and already wrote the log line; the line just never reached a human.
+#
+# ⛔ REFUSED IS NOT A FAILURE. Four of the five branches are fail-closed working correctly:
+# a foreign port holder, a missing credential, a repo off main. If those read as breakage,
+# the reader learns to dismiss the box, and then it protects nothing (HR-47's other half).
+# So the outcome word is part of the message, not a tone.
+#
+# ⚠ WHAT THIS CANNOT DO, stated so it is not read as more: it reaches an interactive
+# session and nothing else. If the Owner is not logged on there is no box — and there is
+# also no 8090, because her uptime is coupled to that same session. The channel's reach
+# matches the need's scope TODAY. When Layer 2 gives her unattended work, it stops matching,
+# and that is the trigger to revisit, not a date. See docs/DESIGN-RESTART-REPAIR.md §5.
+function Notify-Owner([string]$outcome, [string]$text) {
+  # BLOCKING ON PURPOSE. MessageBox::Show does not return until it is dismissed, so the
+  # return IS evidence a human saw it. The WinRT toast was rejected for exactly this: its
+  # Show() returns without throwing whether or not the toast is ever delivered, which is
+  # 「ran and did nothing」 wearing a success. A notifier may not report its own success.
+  Show-Msg ($outcome + "`n`n" + $text)
+}

@@ -53,7 +74,7 @@ if ($state -eq 'ours') {
 if ($state -eq 'foreign') {
   Write-Log 'port 8090 held by a FOREIGN process; fail-closed, not starting, not picking another port'
-  if ($Mode -eq 'Open') { Show-Msg '8090 已被其他程式佔用，香香未啟動' }
+  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '8090 已被其他程式佔用。香香冇啟動，亦冇殺對方、冇轉去第二個 port。'
   return

@@ -62,12 +83,12 @@ $hub = [Environment]::GetEnvironmentVariable('HUB_TOKEN', 'User')
 if ([string]::IsNullOrEmpty($key)) {
   Write-Log 'ANTHROPIC_API_KEY (User) is empty; fail-closed'
-  if ($Mode -eq 'Open') { Show-Msg '缺少 ANTHROPIC_API_KEY（使用者環境），香香未啟動' }
+  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '使用者環境入面缺少 ANTHROPIC_API_KEY。香香冇啟動。'
   return
 }
 if ([string]::IsNullOrEmpty($hub)) {
   Write-Log 'HUB_TOKEN (User) is empty; fail-closed'
-  if ($Mode -eq 'Open') { Show-Msg '缺少 HUB_TOKEN（使用者環境），香香未啟動' }
+  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '使用者環境入面缺少 HUB_TOKEN。香香冇啟動。'
   return

@@ -123,7 +144,7 @@ $env:AGENT_BRIDGE = 'on'
 if ($branch -ne 'main') {
   Write-Log ("repo not on main (on '" + $branch + "'); fail-closed, not starting")
-  if ($Mode -eq 'Open') { Show-Msg ('香香 未啟動：程式庫不在 main（目前 ' + $branch + '）') }
+  Notify-Owner '拒絕啟動（fail-closed 正常運作）' ('程式庫唔喺 main，而家喺 ' + $branch + '。香香冇啟動，亦冇自動 checkout。')
   return

@@ -154,19 +175,37 @@ Write-Log ("server logs: " + $SrvOut)
-Start-Process node -ArgumentList 'src/index.js' -WorkingDirectory $Repo -WindowStyle Hidden `
-  -RedirectStandardOutput $SrvOut -RedirectStandardError $SrvErr
+# -PassThru so the poll below can tell 「still starting」 from 「the process is gone」. Those are
+# different facts and they need different words; without the handle both look like a timeout.
+$proc = Start-Process node -ArgumentList 'src/index.js' -WorkingDirectory $Repo -WindowStyle Hidden `
+  -RedirectStandardOutput $SrvOut -RedirectStandardError $SrvErr -PassThru

-# poll health up to ~15s until our app answers
+# ⛔ WHY THIS POLLS FOR 60s AND NOT 15s — THE ONLY RECORDED FAILURE WAS THIS BRANCH, AND IT WAS
+# WRONG. 2026-07-26 13:06:52 logged 'did not become healthy within ~15s'. That launch's own
+# server log says 'Listening on 127.0.0.1:8090', its .err.log is empty, and she was found up
+# 8m32s later. Across 164 measured starts the median is 1.10s and the max is 6.43s, so 15s was
+# not tight — but 「usually 1 second」 is not 「never 20」, and a notifier that fires on the one
+# event that has ever happened, wrongly, teaches the Owner to dismiss the box. Un-gating this
+# branch WITHOUT this change would have shipped exactly that.
+#
+# A slow start is NOT a failure and is NOT notified — it is logged with its measured time, so
+# the next person arguing about this budget has data instead of one anecdote.
 $ok = $false
-for ($i = 0; $i -lt 15; $i++) {
+$waited = 0
+for ($i = 0; $i -lt 60; $i++) {
   Start-Sleep -Seconds 1
+  $waited = $i + 1
   if ((Probe-Server) -eq 'ours') { $ok = $true; break }
+  if ($proc -and $proc.HasExited) { break }   # dead is dead; no point waiting out the clock
 }
 if ($ok) {
-  Write-Log 'health probe matched after start'
+  if ($waited -gt 15) { Write-Log ("health probe matched after start — SLOW: " + $waited + "s (median is ~1s)") }
+  else { Write-Log 'health probe matched after start' }
   if ($Mode -eq 'Open') { Start-Process $Url }
+} elseif ($proc -and $proc.HasExited) {
+  Write-Log ("server process EXITED after " + $waited + "s with code " + $proc.ExitCode + "; see " + $SrvErr)
+  Notify-Owner '啟動失敗' ("香香 開咗之後即刻死咗（" + $waited + " 秒，exit code " + $proc.ExitCode + "）。`n錯誤內容：" + $SrvErr)
 } else {
-  Write-Log 'server did not become healthy within ~15s'
-  if ($Mode -eq 'Open') { Show-Msg '香香 啟動逾時，請查看 C:\Aroma\xiangxiang.log' }
+  Write-Log ("server still not healthy after " + $waited + "s; process is alive but not answering /health")
+  Notify-Owner '啟動失敗' ("香香 開咗但 " + $waited + " 秒都仲未應 /health，程序仲喺度行緊。`n記錄：C:\Aroma\xiangxiang.log`n伺服器輸出：" + $SrvOut)
 }
```

### 5.1 What is deliberately NOT in it

- **No repairer.** Nothing here restarts, reverts, kills, or checks out anything. Every failure
  branch still ends in `return`.
- **No new process, no new scheduled task, no new file.** One file changes.
- **No change to the shim**, so no pin update and no new commit on `launcherPin.js`.
- **No change to `-Mode Open` behaviour** other than the wording and the longer poll.
- **ErrandRecall is untouched** (§2.1).

---

## 6. WHAT THIS CLOSES

> Owner: 「note in the record what this closes.」

**L2-1 is answered: a person stays in the loop, and the reason is measured rather than cautious.**

Across 164 measured starts over 15 days there were **0 true restart failures and 1 false one** —
the detector being wrong about a healthy server. A repairer built on that signal would be built
on noise. That is not a limitation parked awaiting removal; **it is what the evidence supports
today, and the evidence will say so if it changes** — which is precisely what §4's `SLOW: Ns` line
and the notifier's own firing record exist to make possible.

The notifier does not weaken that finding. It makes the next one possible: a failure that is
announced is a failure that enters the record, and a repairer, if it is ever justified, will have
something real to be exercised against instead of five cases someone imagined in a document.

**Status: designed, diff written, parses clean, NOT APPLIED.** Awaiting the Owner's read of §5.

---

# APPLIED AND PROVEN — 2026-08-08

Owner GO received for all four hunks, including the last one: 「the 15→60 and the dead-versus-
unresponsive split are the parts that make this trustworthy, not optional extras… Without
-PassThru both states read as a timeout, and they need different actions from me.」

**Status: applied, five branches exercised, she is back up on `main` and answering `/health`.**

## THE INSTRUMENT, PROVED FIRST

`catch-box.ps1` waits for a dialog, **reads its text**, writes it to a file, and closes it.
Reading the text is the point — 「a box appeared」 is not the claim; the claim is that a specific,
correct sentence reached the screen.

Seen-to-fail, in both directions, before it certified anything:

- no dialog present → `exit 7`, file reads `((NO BOX APPEARED))`
- a dialog present → `exit 0`, file reads `TITLE: 香香` + the full body

It also had to be rewritten once. The first version matched the window by its **title**, which is
Chinese — and PowerShell 5.1 decodes a BOM-less `.ps1` as ANSI, so the literal became mojibake and
`FindWindow` never matched. The instrument now matches on the dialog **class** (`#32770`) and is
deliberately pure ASCII, so it cannot fail that way regardless of how it is saved. **The launcher
itself was checked for the same trap and is fine — it kept its BOM (`ef bb bf`).**

## THE FIVE

All run against `-Mode Startup` — the mode that was silent by construction — and all re-run
against the final file after the fixes below.

| # | branch | result | evidence |
|---|---|---|---|
| 1 | repo not on `main` | **PASS** | box: 拒絕啟動（fail-closed 正常運作）/ 「程式庫唔喺 main，而家喺 proof/notifier-1。香香冇啟動，亦冇自動 checkout。」 |
| 2 | foreign holder on 8090 | **PASS** | box: 拒絕啟動 / 「冇殺對方、冇轉去第二個 port」 — **and the stub was still alive afterwards**, so the refusal is real, not merely claimed |
| 3 | missing `HUB_TOKEN` | **NOT RUN** | see below — it requires clearing a live credential |
| 4 | spawn-then-die | **PASS** | box: 啟動失敗 / 「即刻死咗（3 秒，exit code 9）」 + the `.err.log` path. Returned in 3s, did not wait out the budget |
| 5 | slow start | **PASS — SILENT** | no box (`exit 7`), log line `health probe matched after start — SLOW: 23s (median is ~1s)` |

### ⛔ CASE 5'S PASS LOOKS LIKE NOTHING HAPPENING. IT IS THE ACCEPTANCE TEST.

Owner: 「state it that way in the record, because a proof whose success looks like nothing
happening is the one someone later mistakes for an untested branch.」

**Case 5 is not an untested branch. Its correct output is silence, and the silence was measured.**
The instrument watched for 55 seconds and returned `exit 7` — its proved-negative result, not an
absence of evidence. The positive evidence is the log line: she took **23 real seconds**
(10:26:32.73 → 10:26:56.11) and it was recorded as a slow start rather than announced as a
failure. Under the old 15s budget this exact launch would have produced a box, and the box would
have been wrong — which is the entire argument of §4 reproduced on demand.

The delay was real, not simulated: a `node.cmd` shim placed first on `PATH`, so **the launcher
ran completely unmodified** and she genuinely started slowly.

### Case 3 — UNVERIFIED, BY OWNER'S RULING. NOT A GAP.

> **Owner, 2026-08-08: 「Case 3 stays unverified. I am not emptying a live credential to prove a
> branch that shares its code path with two that passed — and your refusal to call it verified by
> argument is the right call. Record it as unverified with the reason, not as a gap.」**

**This is a closed decision, not an outstanding item.** It is not waiting for a quieter week, and
it should not be re-proposed. The branch is unverified because verifying it costs more than the
verification is worth, and that trade was made deliberately with the facts in view:

- what it would prove: that a third caller of `Notify-Owner` reaches the screen, when two already
  demonstrably do, with identical wording and an identical call;
- what it would cost: blanking a live credential in the User registry store and restoring it
  seconds later, with a window in which an interruption leaves `HUB_TOKEN` empty.

**The state is 「unverified」, and 「unverified」 is the honest word — not 「effectively covered」.**
HR-48 is why: cases 1 and 2 make a *correct argument* that this branch works, and a correct
argument is exactly what that rule exists to refuse. The fence did not run here. Saying so is the
record; upgrading it by reasoning would be the defect.

The branch reads `[Environment]::GetEnvironmentVariable('HUB_TOKEN', 'User')` — the **User
registry store**, not the process environment. Clearing it in a child shell does nothing;
exercising this branch for real means blanking a live credential and restoring it seconds later.

**I did not do that, and I am not going to without being asked.** If the process were interrupted
mid-window the token would be gone from the store. It is recoverable, but it is his credential and
the decision is his, not mine.

What is known without it: cases 1 and 2 prove the identical `Notify-Owner` path with the identical
REFUSED wording, and this branch differs only in which variable it tests. That is an argument, and
**HR-48 is explicit that an argument is not a fence** — so it is recorded as **unproven**, not as
「effectively covered」.

## TWO DEFECTS THE PROOFS CAUGHT — NEITHER FOUND BY READING

**#35 — `ExitCode` was blank.** Case 4 fired the right branch and named the right log, but printed
`exit code ` with nothing after it. Cause: when `Start-Process` is given
`-RedirectStandardOutput`/`-RedirectStandardError`, the object `-PassThru` returns never populates
`ExitCode` — not even after `WaitForExit()`. `HasExited` works, which is why the branch was right
and the number was missing. Fixed with `$proc.EnableRaisingEvents = $true`, which makes .NET
retain the handle. A fallback now prints 「讀唔到」 rather than a blank, because an unknown
rendered as an empty gap is an unknown the eye skips.

**#36 — the budget was not in seconds.** `$waited` counted **loop iterations**, was named as if it
were seconds, and was printed with an `s` suffix. One iteration is not one second: `Probe-Server`
sleeps 1s and, on a closed port, its `Get-NetTCPConnection` fallback costs roughly another. Case 5
took 23 real seconds and the counter reached about 12 — so **the SLOW line did not fire at all on
the first run**, and the budget everyone had agreed was 「60 seconds」 was really 60 iterations,
nearer two minutes. Replaced with a `Stopwatch`, so the loop bound and the reported number are
both real seconds.

#36 is the sharper one. It sat inside the single line whose whole purpose is to give the next
person data instead of an anecdote — and the number it would have handed them was wrong. It was
invisible to reading and visible the moment a real slow start was staged.

## WHAT IS STILL NOT PROVEN

- **Case 3**, above.
- **The box appearing during the logon storm.** Every proof here ran on a machine with a settled
  desktop. Whether a modal dialog is seen at boot, behind whatever else is starting, cannot be
  faked — it needs a real reboot.

  **NOT SCHEDULED, and deliberately so.** Owner: 「I will tell you before my next real restart and
  you can leave the repo off main so the box is waiting. Not scheduled — I am not restarting to
  test.」 Restarting *in order to* test would make the boot the artificial part and prove the
  wrong thing; the proof is worth having only on a restart that was going to happen anyway. When
  he gives notice, arming it is one command — `git switch -c proof/boot-notifier` — and the box
  should be waiting at logon. Until then this stays honestly unproven.
- **Anything unanticipated.** Five branches were exercised because five branches exist in the
  source. That is not the same as proving the notifier speaks when something nobody imagined
  goes wrong.
