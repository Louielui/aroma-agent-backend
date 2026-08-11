# THE OPUS-5 ROUND — WHAT IT ESTABLISHED, AND WHAT IT DID NOT

**Live on `claude-opus-5` for roughly one hour, 2026-08-11. Rolled back the same day on
evidence. Recorded because the round is worth more than the switch.**

> **Owner: 「『The stronger model is better』 was the assumption I brought in.」**

---

## THE HEADLINE

**opus-5 was not simply slower. It produced THREE distinct failure modes in about eight calls,
and the one property that was actually asked of it — answer-plan validation — it failed on
2 of 2 answered turns.**

| failure mode | evidence |
|---|---|
| no plan validation | `ANSWER_PLAN outcome: fallback, reason: no_plan_returned` ×2 |
| empty response | `distill parse rejected: empty_response` ×1 |
| adapter timeout | `Claude API network error: timeout of 30000ms exceeded` ×1 |

⛔ **Whether this is opus, this prompt, or this schema is NOT established.** Three questions on
one model is direction, not rate, and the same limit applies here as everywhere else this month.

---

## THE FOUR CELLS

| | A4 schema BROKEN | A4 schema FIXED |
|---|---|---|
| **haiku-4-5** | 0/3 answered (HTTP 400) | **3/3** · in 45,972 out 1,435 · median 28.8s · plan **validated** ×3 |
| **opus-5** | 0/3 answered (HTTP 400) | **2/3** · in 32,382 out 1,373 · median 31.6s · plan **fallback** ×2 |

- **cell 2 − cell 1 = the schema fix.** 0/3 → 3/3. **The largest effect of the whole round, and
  it has nothing to do with the model.**
- **cell 4 − cell 2 = the model.** 3/3 → 2/3, and validated → fallback.
- cell 3 confirms cell 1's failure was not haiku-specific.

Four structural counters, both live cells: `parseResult ok`, `stopReason end_turn`, the
Traditional guard **never fired**, answer-plan drops **all zero**.

**Absent from all four cells, as written down before the run:** the judge/minimality fix
(`src/intake/goal/` is unwired), the `servedBy` label, the truncation warning, and the token
budgets. None of them can have contributed to any difference above.

---

## THE DIAGNOSIS, AT THE RESOLUTION ONE INSTRUMENTED RUN GIVES

Probes on all eight `answerPlan: null` sites and on every parse. Same question, same code, two
models:

```
haiku   PARSED@1012 plan:none  -> step1 read -> PARSED@1683 plan:HAS
                               -> step2 read -> PARSED@1683 plan:HAS
                               -> step3 final -> ANSWER_PLAN validated

opus    PARSED@1012 plan:none  -> step1 read -> step2 final
                               -> (PARSED@1683 NEVER FIRED)
                               -> ANSWER_PLAN fallback / no_plan_returned
```

### ⛔ NOT ONE OF THE EIGHT NULL BRANCHES FIRED.

I expected a branch to be discarding the plan. **Nothing discards it.** It is never produced:

- The first parse has no plan on BOTH models — that call does not carry the plan schema, which
  is by design.
- haiku then goes round the loop, and **each loop iteration's parse carries the plan**.
- opus goes to FINAL at step 2 **without passing through the loop's parse at all**, so the
  plan-bearing call never happens.

**The null branches are innocent. haiku takes three steps and collects a plan on the way; opus
short-circuits to FINAL in two and never reaches the call that would produce one.**

### WHAT REMAINS UNKNOWN, NAMED NARROWLY

**What makes opus's step 2 resolve to FINAL without a model call through `intakeService:1683`.**
That is now one question about one code path, rather than eight candidate branches.

---

## THE CORRECTION THAT MADE THIS LESS ALARMING AND NOT LESS NECESSARY

The fallback template **is** evidence-bound. `minimalAnswer()` returns count, kind, provenance
and the honest limitation, **never arbitrary rows** — 「a degradation is always a true, smaller
answer rather than a confident wrong one」.

So the worst case was never 「unchecked rows」.

**But opus's replies ran 693 and 680 output tokens, which is not template-shaped, and what
carried that prose past the plan layer is NOT established.** That is why the rollback still
happened: when the proving mechanism is skipped, the safe assumption is that the proof is
absent.

---

## WHY THE SWITCH WAS STILL WORTH MAKING

1. It surfaced the `temperature` defect (HR-66) — a 400 on every Claude turn that had been
   waiting in a sibling adapter's comment for weeks.
2. **The startup smoke test caught that within four minutes of the restart it was built for**,
   on its first real execution.
3. It produced the first measured comparison this project has of two models on the same path.

---

## STILL OPEN, CARRIED FORWARD

- **`ClaudeAdapter:167` reads `data.content?.[0]?.text` — the FIRST content block only.** Not
  today's cause (a raw call returned a single text block), but a real fragility on a model
  family that increasingly returns multiple blocks.
- **The 30-second adapter timeout** (`ClaudeAdapter:155`), and the ruling that it must tell the
  truth before it is made longer: 「佢仲喺度諗」 and 「失敗咗」 are different facts and only one
  of them is true.
- **The regression flake**: one run reported 2 failures while naming only 1; two immediate
  re-runs reported 1. Seen twice, never reproduced, still on the list.
