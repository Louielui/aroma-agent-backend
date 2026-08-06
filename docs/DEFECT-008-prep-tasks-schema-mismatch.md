# DEFECT-008 — raw SQL written around a wrong schema definition

<!-- record-status: ACTIVE 2026-08-06 -->

**Repo: `aroma-system` (production). Recorded, NOT fixed.**
**Found 2026-08-06, INCIDENTALLY, while answering a question about `totalCount`.**

---

## One line

**`POST /api/v1/ai/prep-tasks/draft` bypasses Drizzle and uses raw SQL because the schema
definition is wrong: `db.ts` declares `planned_batch`, and the actual column is
`batch_count`.**

## Why it is a defect in TWO places

| | |
|---|---|
| **the schema** | `db.ts` describes a column that does not exist. Anything else built on that definition will be wrong in the same way, and will look correct until it runs |
| **the workaround** | raw SQL routed around the wrong definition, so the mismatch produces **no error anywhere** — the one signal that would have led someone to the schema is gone |

**The second is what makes it worth recording.** A schema mismatch that throws is a bug
someone fixes in an afternoon. A schema mismatch that has been carefully worked around is a
bug that waits, and the next person to use `planned_batch` from the Drizzle model will
rediscover it from scratch.

## Not investigated

- whether any other table in `db.ts` disagrees with its real columns;
- whether the Drizzle model is wrong or the migration is — **the two possibilities have
  different fixes**, and this was found while looking at something else.

## Suggested direction — NOT APPLIED

Fix the definition rather than the call site, then remove the raw SQL. The workaround is the
symptom; leaving it in place while correcting `db.ts` would leave two truths again.
