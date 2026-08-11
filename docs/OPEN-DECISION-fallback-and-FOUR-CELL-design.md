# OPEN POLICY QUESTION — PROVIDER FALLBACK IS ONE-DIRECTIONAL

**Recorded 2026-08-11. NOT DECIDED. Owner instruction: 「do not decide it」.**

> **Owner: 「Fall back to GPT, to a smaller model, or fail honestly are three different systems
> and I want to choose.」**

## THE ASYMMETRY, AS IT STANDS TODAY

`intakeService` builds a fallback for exactly one direction:

```
primary = openai  ->  openai fails  ->  falls back to claude
primary = claude  ->  claude fails  ->  nothing
```

The browser's picker **defaults to `claude`** and sends that hint on every turn, and the hint
is checked before the router flag. So the provider the Owner actually uses is the one with
nothing behind it.

On 2026-08-10 that turned one incompatible schema field into a total outage rather than a
degraded answer. The field was the trigger; **the asymmetry was the reason it was fatal.**

## THE THREE OPTIONS, AND WHAT EACH ONE MAKES THE SYSTEM

**A — fall back to GPT.** Symmetrical with what exists. A Claude failure is invisible to the
Owner except for the attribution line, and the turn is answered.
*What it costs:* the reply comes from a provider that is **never sent the external read
context** (`readContextUsed` is correctly false for GPT). So the fallback is not the same
answer from a different voice — it is a *less-informed* answer, silently. It also sends the
Owner's words to a second vendor on a turn where he picked the first.

**B — fall back to a smaller model of the same family.** Keeps the context boundary and the
vendor. A `claude-opus-5` failure degrades to `claude-haiku-4-5-20251001` rather than to
nothing.
*What it costs:* it makes the model in use silently variable, which is the defect HR-62 was
just written about — and it would be doing it deliberately this time. It is only honest if
`servedBy` reports the model, which it now does.

**C — fail honestly.** No fallback. The turn reports that the provider refused and why.
*What it costs:* the Owner gets nothing on that turn. Against: every fail-closed decision in
this project has been that a stated absence beats a substituted answer, and today the Owner
had no idea a whole lane was one flag away from dead.

## WHY IT IS NOT BEING DECIDED IN THE MEASUREMENT ROUND

Fixing it would change what the measurement means: a system with a fallback and a system
without one behave differently under exactly the conditions being measured. The four-cell run
measures the model. Resilience is a separate question and deserves its own round.

## WHAT MUST NOT HAPPEN

**This must not be decided by whoever implements it.** All three options are one small change,
all three look reasonable in a diff, and the difference between them is a product decision
about what the Owner is owed when a provider refuses.

---

# FOUR-CELL MEASUREMENT DESIGN

**Written 2026-08-11, BEFORE the run. Owner instruction: 「the attribution has to be fixed in
advance, not explained afterwards」.**

## THE CELLS

| | A4 schema BROKEN (union+enum) | A4 schema FIXED (anyOf) |
|---|---|---|
| **claude-haiku-4-5-20251001** | cell 1 | cell 2 |
| **claude-opus-5** | cell 3 | cell 4 |

## WHAT EACH COMPARISON IS ALLOWED TO ATTRIBUTE

| comparison | attributes to | and to nothing else |
|---|---|---|
| **cell 2 − cell 1** | the **schema fix** | model held constant |
| **cell 4 − cell 2** | the **model** | schema held constant |
| **cell 3** | exists only to show cell 1's failure is not haiku-specific | not compared for quality |

Cells 1 and 3 are expected to be total failures (HTTP 400). They are run anyway, because a
baseline nobody measured is a baseline someone will later assume.

## ⛔ WHAT IS ABSENT FROM ALL FOUR CELLS — WRITTEN BEFORE THE RUN

**The judge / minimality fix (`goalPlanContract`, distinct reads, the `necessity` field) affects
NONE of these cells, and cannot.**

`src/intake/goal/` is **unwired**: no production file imports it, and an isolation test asserts
that. B never runs on a chat turn. Therefore no difference observed between any two cells can
be caused by it.

This is written down now precisely because it is the kind of thing that gets read backwards
into a result six weeks later — 「she got better around the time we fixed the planner」 — when
the planner was not connected to the thing that got better.

**Equally absent, for the same reason:** the `servedBy` model-string change (a label), the
truncation warning (a label), and the token-budget changes (400 unchanged; the dispatcher's
1024 is not on the chat path).

## WHAT IS MEASURED

Per question, per cell: input tokens, output tokens, wall time, and the four structural
counters — `stopReason`, `parseResult`, whether the Traditional guard fired, and the
answer-plan drop counts (`droppedFacts` / `droppedSentences` / `droppedItems` /
`sectionsNotDeclared`, with `modelItemCount` beside `keptItemCount`).

## THE THREE QUESTIONS

1. `邊啲貨低過安全存量要落單，邊個供應商，有冇貨喺途中？`
2. `上次盤點同而家嘅存量對唔對得上？`
3. `有邊啲供應商已經停用或者冇聯絡方法，但我哋仲要向佢哋訂貨？`

**The Owner never enumerated a third question.** Q1 and Q2 are the two named acceptance cases;
Q3 was chosen because the captured shapes say it needs two operations, a real join, and a field
(`cutoffTime`) that is empty on every row — so it exercises a refusal that ought to happen.
It is named here so it can be rejected before the run rather than after.

## ⛔ THE LIMIT, FIXED IN ADVANCE

**Three turns per cell show DIRECTION, not RATE.** Twelve paid calls cannot establish how often
anything happens. Any later use of these numbers as a rate is a misuse of them, and this
sentence exists so that misuse cannot be innocent — the same failure as `count:43`, one level up.

The replies themselves are written to a file for the Owner to read. **This design does not
judge which answers were better**, and the author's judgement of Claude versus Claude is the
one place his bias has nowhere to be corrected from.
