# `.aroma/` offsite backup — inspection first, then exactly what to add

**Owner instruction:** 「State whether .aroma contains anything that should NOT go offsite
before you add it — I do not want to discover later that we shipped something to Backblaze
that should have stayed here… I would rather back up less and know what I backed up.」

**Nothing has been changed.** The installed backup script is ACL-locked (`AromaBrain\louis` =
`ReadAndExecute, Synchronize`; a write test is denied), so this is a proposal to apply
elevated, not an edit — the same pattern as the earlier backup work.

---

## 1. What is actually in `.aroma/` today

**Two files. About 5 KB total.**

```
.aroma/agent-audit/2026-07-27T18-23-16-266Z-audit_ba733b89.json    391 B
.aroma/computer-audit/2026-07-28T12-00-05-512Z-caudit_3yw5fs.json  913 B
```

### `agent-audit` — every field, read in full

`id` · `createdAt` · `kind` · `approvalId` · `workOrderHash` · `who` (`"louie"`) · `ok` ·
`exit` · `branch` · `filesChanged` · `risks` · `cost`

`filesChanged` is `["docs/canary/agent-canary.md"]` — a **repo-relative path**, not content.

### `computer-audit` — every field, read in full

`id` · `createdAt` · `kind` · `approvalId` · `workOrderHash` · `who` · `steps[]` ·
`ok` · `abortReason` · `risks` · `evidenceRetentionDays` · `dryRun`

Each step: `n` · `action` · `targetApp` · `startedAt` · `durationMs` · `outcome` ·
`refusalReason` · `before`/`after` = `{ screenshotSha256, fileSha256, fileBytes, windowTitle, exists }`

---

## 2. Against the Owner's five questions

| | Present? |
|---|---|
| File **contents** | **No.** Only SHA-256 hashes and byte counts. A hash is one-way and carries nothing back. |
| **Diffs / patch bodies** | **No.** The patch body is written by `patchStore` to `C:\Aroma\AgentPatches`, which is outside this tree entirely. |
| **Paths outside the repo** | **No.** `filesChanged` is repo-relative. |
| **Tokens / credentials** | **No.** Nothing resembling one, and the audit writer takes ids and enums only. |
| **Third-party content** | **Not in these two records** — but see the caveat below. |

### ⚠️ THE ONE CAVEAT — `windowTitle`

`computer-audit.steps[].before/after.windowTitle` is `null` in the only record that exists
(a dry run that refused). **The schema permits it to hold the title of whatever window was
focused** — which can be an email subject, a document name, or a customer's name.

It is the only field in either kind that can carry text originating outside this system. It
is not present today, and Computer Operator is off, so nothing is currently at risk. Stated
now rather than discovered later.

> ### 🔒 CONDITION ON ENABLING COMPUTER OPERATOR — Owner ruling, 2026-08-05
>
> **Before `COMPUTER_OPERATOR` is ever turned on, `windowTitle` must be either OMITTED from
> the audit record or REDACTED before it is written.**
>
> The Owner's reasoning, recorded because it is what makes this a condition rather than a
> preference: *a window title can carry a customer name or an email subject, and once it is
> in an offsite backup it is out.*
>
> Redaction has to happen **at write time**, not at backup time. `.aroma/agent-audit/` and
> `.aroma/computer-audit/` are append-only and are about to be replicated to Backblaze
> nightly; a title written once is copied offsite that night and cannot be recalled from a
> backup afterwards.
>
> ### ✅ DONE 2026-08-05, before anything was enabled
>
> **`windowTitle` is gone from the record entirely.** It is no longer an evidence field, so
> there is nothing to redact and nothing to leak — verified by a test that passes a customer
> name and a document filename through the builder and asserts neither survives.
>
> **A hash was the obvious answer and was rejected.** `screenshotSha256` and `fileSha256` sit
> in the same list, so `windowTitleSha256` looked consistent — but a screenshot has enormous
> entropy and a window title has almost none. 「Inbox - Gmail」, 「Invoice 88.pdf - Adobe
> Acrobat」, 「陳先生 - WhatsApp」 are guessable; anyone holding the offsite backup
> brute-forces a dictionary of plausible titles against the hash. That is obfuscation wearing
> the word redaction — **worse than the title itself, because it looks solved.** A salted
> HMAC resists it and buys a key that can be lost, must be excluded from its own backup, and
> must survive a restore, to protect one field.
>
> **What the title was actually for is kept.** The audit question it answered is: did the
> focused window change between before and after — did the agent type into the window it was
> supposed to? That is **one bit**, `windowChanged`, derived at write time from the two
> titles, with neither title stored. Tri-state per HR-5: `null` means one or both titles were
> absent, which is a different claim from `false`.
>
> The builder is `src/computer/computerAudit.js`; a caller-supplied `windowChanged` is
> ignored, so it can only ever be derived.

---

## 3. What should go, and what should NOT

**GOES — the two audit kinds:**

- `.aroma/agent-audit/`
- `.aroma/computer-audit/`

**STAYS — the other two artifact kinds, which do not exist yet:**

`artifactStore.js` declares four kinds: `tasks`, `results`, `agent-audit`, `computer-audit`.
The first two have never been written here, but they would land in the same tree, and a
`results` artifact is **not** the same safety class:

```js
// src/workers/runWorkerInBackground.js
result = { …, ok: false, error: err && err.message ? err.message : String(err), … }
artifactStore.write('results', result)          // plus `...enrich` on the success path
```

That is **arbitrary worker output and raw error strings** — text nobody has reviewed.

> **So: back up the two audit directories BY NAME, never the whole `.aroma/` tree.** Backing
> up a directory backs up whatever is put in it later, and the two kinds that do not exist
> yet are exactly the ones that would carry unreviewed content offsite.

This is the Owner's 「back up less and know what I backed up」, applied literally.

---

## 4. The change to apply (elevated, by the Owner)

### ⚠️ I CHANGED THIS RECOMMENDATION AFTER READING THE SCRIPT PROPERLY

My first proposal was to edit `$SourceRoot` at line 40 and add an include list. **Do not do
that.** Having read the whole script, that edit is far more invasive than it looks:
`$SourceRoot` is referenced at nine places, and the staging layout hardcodes `data` as the
subdirectory in three more — `Get-CanonicalTree -Root (Join-Path $stagingDir 'data')` and the
same at the two verification sites. Repointing the root means touching all of them, in a
locked production backup script, with a change I cannot test.

Recorded rather than quietly swapped: the earlier suggestion was made from the top of the
file and it was wrong.

### The proposal instead: DO NOT TOUCH THE BACKUP SCRIPT AT ALL

Mirror the two audit directories into a folder the existing, proven, hash-verified pipeline
already covers, twenty minutes before it runs. The backup script keeps its single source
root and its verification protocol untouched.

- **Copy only, never purge** (`/E`, not `/MIR`). Both sources are append-only, so nothing
  needs deleting — and `/MIR` against a wrong path deletes. The risk is removed rather than
  managed.
- **Two separate calls into two distinct subfolders**, so neither can be mistaken for the
  other.
- **Idempotent**: re-running the block replaces the task rather than stacking a second one.

The block itself is in §6.

**What to verify on the first run:**

1. `C:\Aroma\aroma-agent-backend\data\audit-mirror\agent-audit\` and `…\computer-audit\`
   exist and hold **1 file each**;
2. the next nightly `aroma-truthdata-backup` reports `fileCount` **higher by exactly 2**;
3. the B2 listing under prefix `aroma-truth-data` shows the two new relative paths and
   nothing else.

**Volume:** 2 files in 9 days, ~5 KB. Nothing meaningful is added to the nightly transfer.

**One consequence to accept knowingly:** the truth-data tree hash will now change whenever an
audit record is written, not only when the stores change. That is the intended behaviour —
it is what makes the audit trail part of the backed-up set — but it means a nightly run that
previously reported `NO_CHANGE` may now report `CREATED`.

---

## 5. What this fixes

The Owner's own sentence, which applies to these records today: 「an audit trail with no
offsite copy is a trail that dies with the machine.」

`data/` has been backed up nightly to B2 since the truth-data pipeline was installed.
**`.aroma/` is covered by nothing** — verified by reading all three installed backup scripts.
The one real agent execution record in existence has no second copy.

---

## 6. The elevated block — for the Owner to run, reviewed first

Run in an **elevated** PowerShell. It creates the mirror folders, copies what is there now,
and registers one scheduled task at 02:10 — twenty minutes before `AromaTruthData-B2Sync`.

It touches **no** file under `C:\ProgramData\AromaBackup\scripts`.

```powershell
$ErrorActionPreference = 'Stop'

$Src  = 'C:\Aroma\aroma-agent-backend\.aroma'
$Dst  = 'C:\Aroma\aroma-agent-backend\data\audit-mirror'
$Kinds = @('agent-audit','computer-audit')   # ONLY these two — never the whole tree

foreach ($k in $Kinds) {
  if (-not (Test-Path -LiteralPath (Join-Path $Src $k))) { throw "missing source: $k" }
  New-Item -ItemType Directory -Force -Path (Join-Path $Dst $k) | Out-Null
}

# /E copy-only, NO /MIR: both sources are append-only, so nothing needs deleting and
# nothing here can delete. /R:2 /W:2 bounds a locked-file retry. Exit codes 0-7 are success.
$cmds = $Kinds | ForEach-Object {
  '"{0}" "{1}" /E /R:2 /W:2 /NFL /NDL /NJH /NJS' -f (Join-Path $Src $_), (Join-Path $Dst $_)
}
$inner = ($cmds | ForEach-Object { "robocopy $_ ; if ($LASTEXITCODE -ge 8) { exit 1 }" }) -join ' ; '

# Run it once now, so the first nightly backup already carries the two records.
foreach ($c in $cmds) {
  $null = Start-Process -FilePath 'robocopy.exe' -ArgumentList $c -NoNewWindow -Wait -PassThru
}

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -Command "' + $inner.Replace('"','\"') + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At 2:10am
$set     = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Idempotent: replace rather than stack a second task.
Unregister-ScheduledTask -TaskName 'AromaAuditMirror' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'AromaAuditMirror' -Action $action -Trigger $trigger `
  -Settings $set -RunLevel Highest -User 'SYSTEM' -Description `
  'Mirror .aroma agent-audit + computer-audit into data\audit-mirror so the existing truth-data backup carries them offsite. Copy-only, never purges.' | Out-Null

Get-ChildItem -Recurse -File $Dst | Select-Object FullName, Length
```

**Then verify** the three things in §4, and tell me the `fileCount` from the next nightly run
so the +2 can be confirmed rather than assumed.

### Why SYSTEM and not the Owner's account

The existing backup tasks already run unattended. A scheduled task under a user profile
cannot see profile-relative paths at logon-less runtime — that is the exact failure that
made both earlier backup tasks exit `0x1` and led to the toolchain being relocated to
`C:\ProgramData\AromaBackup`. Both paths here are absolute and outside any profile, so
SYSTEM is safe and consistent with the existing tasks.

### If you would rather not add a task

The alternative is one line in `aroma-truthdata-backup.ps1` that does the same copy before it
snapshots. It is smaller, but it edits the locked, proven pipeline — which is what §4 argues
against. Your call.
