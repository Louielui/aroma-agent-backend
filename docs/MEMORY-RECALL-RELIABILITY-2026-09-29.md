# Memory indexing and follow-up reliability

Scope: the local Xiangxiang backend only. No restaurant production changes.

## Observed defects

- A one-character historical record was retained in canonical PostgreSQL, but
  Hindsight rejected its length. It remained `unconfirmed` with
  `memory_invalid_text`. Originals over 32,000 characters were never selected by
  the background indexer and could remain pending indefinitely.
- Follow-up recall searched only the current sentence. A question referring to
  "this project" omitted the project named in the previous owner question.
- Counting matching words equally favored long assistant/archive copies over
  concise original owner statements. Live acceptance could retrieve a correction
  while missing the original statement and its date.
- The separate legacy lab archive rejects LocalService writes with `EPERM`.
  Canonical PostgreSQL receipts remain independently available.

## Changes

- Unsupported indexing lengths become `source_only`. The original remains
  searchable in PostgreSQL; no engine call, extracted-fact count, or semantic
  success is invented. Old invalid-length failures are reconciled once.
- Index filters and health counts distinguish this state from Hindsight originals
  with zero extracted facts (`raw_only`).
- Recall includes at most two recent owner questions, with a total query limit of
  2,000 characters. Assistant answers and excluded historical text are not added.
- Source ranking weights uncommon terms, normalizes document length, and prefers
  direct owner statements. Active decisions still take precedence. Scope and
  current-state checks, twelve-result limit, and four-thousand-character excerpt
  limit remain in place.
- Follow-ups also resolve at most four recent citation IDs against canonical
  current records. IDs are lookup hints, not assistant-authored evidence. Private,
  archived and invented references cannot bypass the normal scope/state checks.
- Retrieval collapses exact episodic duplicates with the same scope and
  attribution before applying its result cap. Repeated identical questions cannot
  occupy every result slot; all original source records remain stored.
- `scripts/service/repairMemoryArchiveAcl.ps1` prepares a narrow repair for the
  existing LocalService identity, only the archive directory and its two files.
  It saves original SDDL before any changes and does not grant recursive access.
  The first Windows administrator prompt was cancelled. On the owner's retry,
  the repair completed at 2026-09-29T19:55:13Z. Four real service exchanges were
  read back and the pre-existing archive prefix hash was unchanged. Existing
  assistant-body omission rules remain in effect.

## Acceptance scope

Regression tests reproduce invalid-length indexing, follow-up context loss and
verbose-reply crowding before the fixes. Tests also preserve scope isolation,
approval, supersession, retry limits, and durable receipt capture.

Live fixtures are explicitly fictional private history, not business decisions:
the animal code from the previous acceptance; project MistBridge Z9, first code
Amber391, corrected to Indigo628; and a nonexistent project. Original Chinese
fixtures, response IDs, timestamps, boot identity and timings are recorded in the
workspace delivery evidence. Assertions compare citations with canonical source
records, not merely the presence of a date-shaped string.

Remaining work: historical indexing backlog, automatic consolidation into
reviewable knowledge, more complex long conversations, volume and
external-agent acceptance. Passing these bounded cases is not a claim of perfect
or exhaustive memory.

## Rollback

Revert the delivery commit locally and restart the backend through the normal
service mechanism. Do not reset unrelated local work or delete canonical memory.
The `source_only` state is metadata; its raw text remains stored. Any future ACL
rollback must use the SDDL evidence produced by the repair, through an authorized
Windows administrator action.
