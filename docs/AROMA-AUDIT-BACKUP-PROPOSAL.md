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
> This is **not built** — deliberately, on the Owner's instruction, because building it now
> would be building for a flag that is off. It is written here so whoever enables the flag
> hits the condition first. `computerSupervisor.js` is where the record is assembled.

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

`C:\ProgramData\AromaBackup\scripts\aroma-truthdata-backup.ps1`, line 40:

```powershell
# BEFORE
$SourceRoot = 'C:\Aroma\aroma-agent-backend\data'          # the ONLY source

# AFTER
$SourceRoot  = 'C:\Aroma\aroma-agent-backend'              # repo root
$IncludeDirs = @('data', '.aroma\agent-audit', '.aroma\computer-audit')
```

…and the tree walk restricted to `$IncludeDirs` rather than the whole root — **without that
restriction the script would sweep `node_modules`, `.git` and the source tree.**

**I cannot test this.** The file is not writable by me, and I will not run an untested change
against the backup pipeline. Two things to verify on the first elevated run:

1. the reported `fileCount` rises by exactly **2**, and the tree hash covers both audit files;
2. the B2 listing under prefix `aroma-truth-data` shows the two new paths and nothing else.

**Volume:** 2 files in 9 days, ~5 KB. This adds nothing meaningful to the nightly transfer.

---

## 5. What this fixes

The Owner's own sentence, which applies to these records today: 「an audit trail with no
offsite copy is a trail that dies with the machine.」

`data/` has been backed up nightly to B2 since the truth-data pipeline was installed.
**`.aroma/` is covered by nothing** — verified by reading all three installed backup scripts.
The one real agent execution record in existence has no second copy.
