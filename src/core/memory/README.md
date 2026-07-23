# Aroma Core — M1 Memory Foundations

> **Memory is not authority. Governance remains the sole authority for operational state.**
>
> Memory preserves long-term cognition. Governance determines operational truth and
> execution. Nothing in Identity, Personality, Experience, or Skills can directly
> influence execution — it informs; governance decides.

Governed, versioned, **append-only** storage core for Xiang Xiang's four cognitive
stores: `identity`, `personality`, `experience`, `skills`. **M1 is storage only** —
no runtime, no LLM, no persona/intake/proposal coupling, no retrieval, no skill
invocation, no backup, no migration, no DB. It currently has **no consumer**.

## Two artifact kinds (never mixed)

- `records/<recordId>/<revisionId>.json` — immutable **content revision**
  (payload, provenance, selectors, revision number, supersedes, contentHash).
- `events/<recordId>/<eventId>.json` — immutable **lifecycle event**
  (targetRevisionId, eventType, actor, approval, rationale, expectedPreviousState,
  store-controlled sequence, timestamp label [audit only], eventHash).

State is **derived** from the event log by the resolver — approval is never
written back into a revision, and a state change never copies the payload.

## Governance invariants

- **Approval ≠ activation.** created → review_ready → approved → *separately*
  activated/admitted. No auto-admit (structural: ADMITTED/ACTIVATED requires a
  prior APPROVED).
- **Active** requires valid hashes + APPROVED + ACTIVATED/ADMITTED + no later
  DEPRECATED/SUPERSEDED + validity window. Two active → `AMBIGUOUS_ACTIVE_STATE`
  (never resolved by "highest revision").
- **Append-only**: no in-place edit, no delete. Supersede/deprecate/reject are events.
- **Truth** = records + events. `index.json` is a rebuildable projection.
- **Ordering** authority = revision number + store-controlled sequence, never labels.
- **Lock**: stale locks are never auto-removed (operator recovery only).
- **Domain-scoped authority** (recorded, not ranked): identity / behavior /
  advisory / capability.

## Config

Real use requires `AROMA_CORE_DIR` (absolute; fail-closed — no default, never the
repo or `./data`). Data lives **outside the repo / gitignored**. Tests use temp dirs.

## Not in M1

`PERSONA_IDENTITY`, `buildPersonaSystem`, `distillPrompt`, intake, proposal/run/
dispatch, LLM, Guardian backup impl, DB, migration, retrieval, skill invocation.
Identity migration is **M2** (shadow + equality verification, then approved cutover).
