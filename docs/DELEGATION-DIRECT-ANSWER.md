# Source-bound delegation answer without a discarded draft

This is an isolated candidate, not a deployment or live speed claim. No ledger,
profile, model setting, permission, dependency or background service is added.

## Retained failure mechanism

The PR162 native one-turn receipt recorded three Claude Opus 5.5 / Medium helper
dispatches: intent, goal understanding and structured answer. Backend elapsed time
was 59.232 seconds. The last helper took 30.170 seconds from dispatch to recorded
finish and generated a 72,471-byte provider-input evidence envelope. Its prose was
then replaced by the existing `delegationEvidenceView.renderDelegation` projection.
The final main answer was correct; the generated draft was redundant for that turn.

`delegationDirectReplay.json` retains the exact question, two-message context,
semantic classification, goal output, raw structured answer and prompt-projected
source rows, with the original evidence receipt SHA256. Source historical work
bodies had already been omitted from that captured prompt. Tests fix Date to its
observed time; no production timestamps or records are refreshed or seeded.

## Narrow admission through existing orchestration

The existing `answerFastPath` admission runs after intent/goal preparation and the
already-authorized read in `buildPromptFor`. It reuses the existing delegation
renderer, then continues through the established chat/read/route/offer/archive
guards. It never fabricates a model envelope, main-answer usage or model identity.

Admission requires Owner subscription chat, a fresh conversation or explicit absent
prior-investigation sentinel, no tracked action goal or existing investigation,
an evidence-first understand/retrieve goal, no decision/action/outcome/join/reference,
and only settled authorized local facts. Typed needs must include delegation and
may include configuration. Historical, public, cross-source, mixed, missing and
unmapped requirements retain the model path. No sentence/keyword exception is used.

There must be exactly three unambiguous live configuration/work/delegation rows,
no truncation or other read source, and complete backend/Bridge scope coverage.
The unchanged delegation validator must accept the fresh receipt, unique channels,
catalogue states, per-job authorization and untested acceptance fields. Its existing
null/alias/role/connection limitations and exact source detail remain intact.
Missing, stale, untrusted, duplicated, partial-coverage or forged receipts fall
through; they do not acquire a successful direct-answer receipt.

## What remains unchanged

Intent and goal understanding still receive conversation context and its corrections.
Long-term-memory opt-out does not delete transient context. Source authorization,
read failure semantics, null fields, catalogue alias resolution, source IDs,
channel-specific roles, evidence admission, route/offer protection and run-level
reservation/send limits are unchanged. The source rendering remains identical.
Generic footer wording and English role labels are outside this candidate.

Nine real acceptance ledgers remain paused and byte-identical. Their unused capacity
is neither reset nor transferred. This source change introduces no activation entry
or quota. A future live measurement requires a separately authorized usable entry
and allowance; this tranche only prepares reviewed deployment material.

## Verification meaning

Regression first reproduces the old extra adapter call. Offline full-intake replay
then asserts identical source-bound main text, the same goal/context and one read,
seven channel facts, unchanged null model, no action, and no invented main-answer
usage. The goal/answer adapter calls fall from two to one. Both existing semantic
opinions remain in the injected offline harness. The native baseline had three
guarded CLI dispatches; the candidate's actual dispatch count is not measured here.
Admission rejection cases and neighboring successful answer/guard paths are tested.
The raw retained output is the fallback fixture, not an independently live model.

Omitting the observed last call does not prove a 30-second live saving: subscription,
host, source and evidence timing vary. No new model acceptance is performed here.
Full suite, exact-SHA independent review, CI and a concrete approval package must
complete before any separately approved promotion. Hold remains in place.
