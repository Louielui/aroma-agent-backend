# `scripts/probes/` — ONE-OFF DIAGNOSTIC PROBES. **NOT TESTS. NOT COVERAGE.**

Everything in this directory is a throwaway script written to answer one question on one
day, usually by spending a real (paid) model call. They are committed so the Owner can read
the diff instead of trusting a summary of what was run.

**Do not read anything here as coverage.** A probe asserts nothing, runs on no schedule, and
is never executed by `node --test`. If a probe proves something that must keep being true,
the finding belongs in a real test under `src/`, not here.

## Rules for anything added here

1. **Scratch data only.** Set `AROMA_DATA_DIR` to a `mkdtemp` directory *before* requiring
   anything. `AROMA_DATA_DIR` defaults to production (`MAINTENANCE-BACKLOG.md` M-3, still
   open) and a probe wrote 25 records into the Owner's live store this week by forgetting it.
2. **Never touch a live store through a real seam** unless the store instance is one the
   probe itself constructed.
3. **Print facts, never content.** Modes, enums, counts, token totals. No prompt, no reply
   text, no retrieved rows, no credential.
4. **Record everything the question could possibly need, before spending the call.** The
   first on-arm run below cost a paid call and captured `parseResult` but not
   `parseErrorReason`, so it proved the parse failed and nothing about how. The Owner's
   reason for wanting these committed: a reviewable script would have caught that gap
   *before* the call was spent.
5. **Date the finding in the header**, so a stale probe cannot be mistaken for current truth.

## Index

| Probe | Question | Answer | Date |
|---|---|---|---|
| `contractVariable.js` | Does `CONVERSATION_CONTRACT` cause an explicit change request to be classified as non-commit? | **No.** `mode='ask'` with the contract both on and off. Candidate eliminated. | 2026-08-05 |
| `commitExample.js` | Does the classifier prompt's OWN commit example produce `mode='commit'`, and if so do steps 3–5 hold? | **`commit` — with ZERO tasks.** Refused at `no_actionable_task`. Steps 3–5 still unexercised. | 2026-08-05 |

### What the two probes together establish

The card is unreachable from **two different classifier failures**, not one:

| Message | mode | refused at |
|---|---|---|
| 「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」 (the Owner's) | `ask` | `not_a_commit_intent` |
| 「幫我把 Timeline 的輪詢在終止狀態後停掉」 (the prompt's own example) | `commit` | `no_actionable_task` — zero tasks |

The prompt says 「tasks 至少 1」 for commit. The second message satisfies step 2 and fails on
the task count instead, so **steps 3–5 have still never been exercised by a real model.**

Observed and worth noting separately: the turn router classified the prompt's own commit
example as `CONVERSATION / default`, not ACTION. The probe forces `interactionMode:'proposal'`,
so live that message would not reach the proposal lane at all. That is a third thread and it
is an artifact-adjacent observation, not a proven defect.
