# Xiangxiang Lab — Conversation Persistence v0.1 (WRITE ONLY)

**Status:** **ENABLED 2026-08-01.** Third-party scope narrowed by Owner decision **A′** on
2026-08-02, and **backed up locally with a proven restore** the same day. **Not off-site** — see §3.

## What this is

It records what was said, so that a **later** phase can decide whether anything should ever be
read back. v0.1 gives the model **no readback at all**.

It exists because an audit on 2026-08-01 established that Xiangxiang had **no persisted
conversation history of any kind**:

- the UI held conversations in a plain in-memory JavaScript array (`src/demo/assets/app.js:55`)
  with no localStorage, sessionStorage, IndexedDB or cookie anywhere;
- conversation ids were `c1`, `c2`… — a counter that restarts at 1 on every page load;
- the model received `history.slice(-8)` (`src/intake/distillPrompt.js:84`) — the last 8 turns,
  from browser memory;
- chat replies wrote nothing (`src/intake/intakeService.js:496`);
- `src/store/store.js:78` states outright: *message content / api key are intentionally never
  accepted here*;
- and the operational store held **0 decisions, 0 tasks, 0 events** against 33 model calls.

Collecting first and reading later is deliberate. A reader designed before the data exists is a
guess about what the data looks like.

## Governance decisions (Owner, 2026-08-01)

| | |
|---|---|
| Content | full verbatim user and assistant turns, not summaries |
| Retention | permanent, until the Owner deletes |
| Store | independent Lab store; production data is never written |
| Readback | **none** in v0.1 — no prompt, persona, or Decision Recall change |
| Auto-memory | none — no Memory, Decision or Task is created |
| Delete | single turn, whole conversation, date range, everything |
| Export | full JSON export |
| Redaction | before write; best-effort |
| Opt-out | 「這段不要記錄」 and equivalents |
| Archive | append-only, except deletion, which is audited |
| Flag | `XIANGXIANG_ARCHIVE`, default OFF |
| Third-party data (A′, 2026-08-02) | a turn that used external read context keeps the **user's words** and omits the **assistant's body** |

## Third-party data — Owner decision A′ (2026-08-02)

The first real conversation was a Gmail lookup, and it exposed a gap nobody had decided on. The
governance table above was written about **the Owner's own** secrets. Other people's data was
never separately considered — and it arrived anyway.

Not through the retrieved mail: the read block and the context card are not passed to the Lab and
never were. It arrived through the **assistant's reply**, which quoted the mail and is stored
verbatim. A verbatim assistant turn was in scope; a supplier's name landing on an unbacked disk
was not something anyone had agreed to.

**A′:** when a turn *actually used* external read context —

- the **user turn is stored in full**. The Owner asking about his mail is the Owner's data.
- the **assistant body is not stored at all**. Not summarised, not redacted, not hashed.
- an **omission record** takes its place, holding position, order, timestamp, model, provider,
  lane, requestId, the reason, and the **source kinds** (`drive`|`gmail`|`calendar`|`github`) —
  and nothing else. No card, no snippet, no subject, no name, no count, not even a length.
- `redactedKinds` is **`null`**, not `[]`. An empty array would assert that redaction ran and
  found nothing, which is a claim about text this code never examined.

The omission is **structural, not a promise**: on that path the reply is never passed to the
function that writes files. A caller that passes it anyway still produces a record with no text
in it, and a test proves it by searching the file's raw bytes.

### Two opposite defaults, on purpose

| | Direction | Why |
|---|---|---|
| Write failure | fail-**OPEN** — reply anyway | a missing note costs something nobody could read later |
| Third-party data | fail-**SAFE** — omit the body | a wrongly-kept reply puts someone else's business on a disk with no backup and no consent, and cannot be undone by noticing |

So `readContextUsed` must be an explicit `false` for a body to be kept. `undefined`, `null`,
`'false'`, `0` and `{}` all omit. If the pipeline ever stops reporting, bodies quietly stop being
stored — visible in the archive. The opposite mistake would have been invisible.

### What "actually used" means

Recorded at the one line that prepends the block to a prompt, per provider, and resolved for the
provider that **actually answered** — not inferred from flags. `READ_ACCESS=on` is not the same
claim as "this answer was built on somebody's mailbox": the flag can be on while the fetch returns
nothing, and a fallback from GPT to Claude changes the answer. A flags-based guess is wrong in
both directions.

## Model and provider provenance

The first live record stored `model: null` — because `telemetry.model` was never assigned
**anywhere in the codebase**. The archive was faithfully writing down a value nothing produced.

Provenance now comes from the **adapter's own result** for the call that actually happened
(`noteProvider`), never from a config default read back and never inferred from the provider
name. Tests use two adapters returning *different* model ids, so "the right model" is a claim
that can fail; one adapter would make any id look correct.

## Three things stated honestly

### 1. Redaction is harm reduction, not a guarantee

A password can be any string. `hunter2` is a password and is indistinguishable from a word.
Pattern detection catches the shapes it knows and misses the rest, and what it misses is exactly
what nobody wrote a pattern for.

**The archive is therefore protected as if it contains secrets**, because it does:

- its own directory, `C:\Aroma\XiangxiangLab\conversation-archive`, outside the repo
- its own ACL: louis / SYSTEM / Administrators only, inheritance off
- **AromaOperator has no access** — the Computer Operator account has no business reading the
  Owner's conversations
- gitignored, and the real path is outside the repo anyway
- **not in any backup chain**

No document, comment or screen may describe the archive as clean, and a test enforces that.

### 2. Write failure is fail-OPEN — the opposite of the Computer Operator audit

If an archive write fails, **the conversation still completes**. The failure is surfaced on the
response (`labArchive`), never swallowed, and never allowed to become "Xiangxiang cannot answer
you".

This is the deliberate opposite of the Computer Operator's audit, which is fail-CLOSED:

| | Computer Operator audit | Lab archive |
|---|---|---|
| Direction | fail-CLOSED — no record, no action | fail-OPEN — no record, reply anyway |
| Why | the record is part of the **authorisation chain**; an unrecorded desktop action is one nobody can evidence afterwards, and the containment argument rests on being able to say what happened | it **authorises nothing**. It is an additional feature beside a conversation that was going to happen regardless |
| Cost of the other choice | acting unrecorded | a full disk takes the assistant away |

Both defaults are written down where they apply so neither gets "corrected" to match the other.

### 3. Backed up locally, with a proven restore — but NOT off-site

**Built 2026-08-02.** `scripts/lab/Backup-XiangxiangArchive.ps1`, plus the scheduled task
`XiangxiangArchive-LocalBackup` (daily 02:30, runs as `louis`, verified by an on-demand run that
returned 0).

Each run snapshots the archive to `D:\XiangxiangArchiveBackups\snapshot-<UTC>\`, writes a manifest
of sha256/size/record-count, then **restores that snapshot into a scratch directory and compares
the bytes** — against the manifest *and* against the live source. A snapshot whose restore does
not match is **deleted**, and the run fails. A backup that cannot be restored is worse than none,
because it is trusted. (Precedent: **AromaTruthData-B2Sync** — a store is not backed up until a
restore has been proven.) Retention: 30 snapshots.

**It has its own directory with its own ACL, and that is not fussiness.** `D:\AromaCoreBackups` —
the existing chain — grants **Everyone: FullControl**. The archive is protected to
louis/SYSTEM/Administrators only. Copying it into the existing chain would take a locked store of
conversations and drop it somewhere anybody on the machine can read. The script **refuses** to
write to a destination that is inherited, or that grants Everyone / Authenticated Users / Users /
AromaOperator, and it re-checks on every run rather than trusting what it set once.

**What this still does not protect against**, stated rather than implied:

- **Not off-site.** Both copies are in the same room. A fire or a burglary takes both. Sending
  conversation text to Backblaze is a decision about publishing the Owner's conversations — and
  any third-party data still in them — to an outside company, and it has not been made.
- **D: is a removable disk.** NTFS permissions do not travel with it. Anyone who walks off with
  the drive can read the snapshots on another machine. Encryption would fix that and would add a
  key to lose; no decision yet.

### Off-site: deliberately not done (Owner decision, 2026-08-02)

Not an oversight, not a missing step. The Owner has **accepted the residual risk** rather than
publish his conversations to an outside company:

- D: is removable media, and NTFS permissions do not travel with the disk — offline or
  administrator access on another machine reads it.
- fire, theft and hardware failure all still hit both copies, because both are in one place.

Mitigations in force meanwhile: **D: does not leave the controlled location**; the archive backup
directory re-verifies its own ACL on every run; **nothing is uploaded to B2 or any other cloud**.

**Re-evaluate on 2026-11-02** — after roughly three months of real data — whether encrypted
off-site backup is then worth it. Recorded as M-2 in [MAINTENANCE-BACKLOG.md](../MAINTENANCE-BACKLOG.md).

### Backups and the delete button are in conflict

`delete` removes a turn from the live archive — and every snapshot taken before that moment still
holds it. The Owner would be told the turn was deleted while it still existed on D:. Snapshots are
whole-file copies, so there is no way to reach into one and remove a line without rewriting it,
and a rewritten snapshot no longer matches the manifest that proves it intact.

The honest resolution is blunt: **after deleting anything, run
`Purge Xiangxiang Archive Backups.cmd`**, which removes the entire chain. The next backup starts
fresh. The cost — losing snapshot history — is the price of a delete button that means what it
says, and it is printed on the screen before it happens.

**Owner decision, 2026-08-02 — this trade-off is ACCEPTED and is not a defect.** Written here so
that nobody later reads it as an oversight or a missing feature and "fixes" it. When the Owner
asks for a conversation to be deleted:

1. existing snapshots are **not edited** — a rewritten snapshot no longer matches the manifest
   that proves it intact, and a repaired backup is an untrustworthy backup;
2. **every backup chain that could contain it is purged whole**;
3. a **new baseline** is taken from the cleaned active archive;
4. the Owner is **told plainly** that the entire backup history at earlier points in time is
   gone with it.

Immutable backups and a real delete button cannot both be had. This system chooses the delete
button, knowingly.

### Purging records that are already stored

`scripts/lab/purge-records.js` does the three separable things and reports each, because
"deleted" has to survive a harder question than *is it still in the active file?*

| | |
|---|---|
| **Logical** | an audit line naming ids, counts, hashes, time and the Owner's reason — and **no deleted text, name, subject or summary**. An audit that kept them would defeat the deletion it records. |
| **Physical** | the active archive is rebuilt from the **original line bytes** of the records that stay, written to a temp file, **fsync'd**, closed, and moved into place by atomic rename. No `.bak`, no `.old`, no copy of the previous file under any name — keeping one would be keeping the thing being deleted. |
| **Snapshots** | every snapshot holding a target is **removed whole**, never edited. |

The scan for leftovers runs **in the same process**, because to look for the deleted text you
need the deleted text, and writing it to a needle file would create a fresh copy of exactly what
was being removed. It is held in memory and only counts are printed.

Needles are split into **distinctive** (the whole turn, multi-word capitalised sequences, 6-character
CJK windows) and **generic** (single Latin words). Only distinctive hits decide the verdict. The
first version failed that: every Latin word of 4+ characters was a needle, so the scan reported
"residue" in ten files — the launcher, a batch file, some JSON — because a reply about somebody's
mail contains ordinary English and so does everything else. A scanner that cries wolf gets ignored.

**What may be claimed:** zero readable residue in the active archive and in every snapshot.
**What may not:** forensic unrecoverability. A rename unlinks bytes; it does not scrub the sectors
that held them, and nothing here has evidence about the state of the disk.

## Where things are

| | |
|---|---|
| `src/lab/redaction.js` | secret patterns + the opt-out phrases |
| `src/lab/thirdPartyScope.test.js` | A′ — proven against the file's raw bytes |
| `src/lab/archiveEndToEnd.test.js` | HTTP → real pipeline → real file, in one test |
| `src/intake/provenanceTelemetry.test.js` | model/provider/read-context signal from the real pipeline |
| `src/lab/conversationArchive.js` | append-only writer, delete, export, audit |
| `src/lab/labArchiveHook.js` | the single flag-gated entry point |
| `src/routes/demoRouter.js` | **one** guarded block, after the reply exists |
| `scripts/lab/xiangxiang-archive.js` | the Owner's stats / export / audit / delete CLI |
| `scripts/lab/provision-lab-archive.ps1` | the directory and its ACL |
| `C:\Aroma\XiangxiangLab\conversation-archive\archive.jsonl` | turns, one JSON per line |
| `…\audit.jsonl` | skips, write failures, deletions — never content |

## Append-only, with one named exception

Turns are appended and never edited. **Deletion rewrites the file**, because the Owner asked to
be able to remove data and a tombstone that leaves the text on disk is not removal. Each deletion
writes an audit line naming the selector, the count and the remainder — **never the deleted
text**. An audit that kept the text would defeat the deletion it records.

## Owner commands

```bash
node scripts/lab/xiangxiang-archive.js stats
node scripts/lab/xiangxiang-archive.js export > my-conversations.json
node scripts/lab/xiangxiang-archive.js audit
node scripts/lab/xiangxiang-archive.js delete --turn <turnId>
node scripts/lab/xiangxiang-archive.js delete --conversation <conversationId>
node scripts/lab/xiangxiang-archive.js delete --from 2026-08-01 --to 2026-08-31
node scripts/lab/xiangxiang-archive.js delete --all
```

The export carries verbatim conversation text and is **exactly as sensitive as the archive**.

## Turning it on and off

Two double-clickable operations on `C:\Aroma\`:

| | |
|---|---|
| `Enable Xiangxiang Archive.cmd` | → `scripts/lab/Enable-XiangxiangArchive.ps1` |
| `Disable Xiangxiang Archive.cmd` | → `scripts/lab/Disable-XiangxiangArchive.ps1` |
| `Backup Xiangxiang Archive.cmd` | → `scripts/lab/Backup-XiangxiangArchive.ps1` |
| `Purge Xiangxiang Archive Backups.cmd` | → `scripts/lab/Purge-XiangxiangArchiveBackups.ps1` |

Each one backs up `C:\Aroma\xiangxiang.ps1` and verifies the backup by hash **before** editing,
adds or removes exactly the one line `$env:XIANGXIANG_ARCHIVE = 'on'`, proves line-by-line that
nothing else moved and that the encoding and line endings are unchanged, restarts **only** the
8090 backend, and polls `/health`. Enable **restores the original launcher and restarts it
automatically** if the new one is not healthy. Each writes a record — `activation-*.json` /
`deactivation-*.json` in `C:\Aroma\XiangxiangLab\` — containing hashes, pids and the diff, and
**no conversation content**.

**Disable is not erase.** It stops new writes and keeps everything already collected. Removing
data is the separate, deliberate `delete` command below.

With the flag off, `recordExchange` returns before requiring the archive module, so nothing is
loaded, no directory is created and no byte is written. That is structural, not a promise, and
it is asserted by a test.

### What enablement could not prove, and why

An environment variable inside a running process cannot be read from outside it, and `/health`
does not report flags. The only way to prove the flag took effect is a conversation turn — and
manufacturing one would put fake text into the Owner's archive. So the scripts stop short and say
so: **the next real message is the proof.** Its reply carries a `labArchive` field and
`archive.jsonl` appears. If neither happens, the flag did not take.

### Restarting the launcher from a script

Use `Start-Process` **without** `-Wait`, and let the health poll be the wait:

- `& powershell.exe -File $Launcher | Out-Null` hangs forever — the launcher's hidden `node`
  child inherits the stdout handle, so the pipeline never sees end-of-stream;
- `Start-Process -Wait` hangs forever too — it waits for the whole process *tree*, which now
  includes the server that was just started successfully.

Both were hit during this enablement. In both cases the restart had already **succeeded**; only
the script was stuck, which is the kind of failure that looks like a broken deploy and is not.

## What v0.1 explicitly does NOT do

- does not read anything back to the model
- does not modify persona, prompt, or Decision Recall
- does not create Memory, Decision or Task
- does not touch production stores
- does not affect the Computer Operator
- does not back itself up
- does not claim to be clean, and does not claim to be durable
