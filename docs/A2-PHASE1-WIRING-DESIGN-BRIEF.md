# A2 PHASE 1 — EVIDENCE GATE WIRING DESIGN BRIEF

**AUDIT + DESIGN ONLY. No production source file was modified.** This document is the only
file created. Every claim below carries a file path and a function or line reference.

| | |
|---|---|
| Audited at | `c705241` (branch `feat/a1-evidence-truth-contract`) |
| Approved A1 code | `1b91a6457d23710334c0df5e16f40d969583baca` |
| A1 closure | `c705241e9a9ffc23538b54f9bb44658b9e872f27` |
| main | `63947dc95a1a6c5a506ce8bfa9a98a519a1bb7c5` — unchanged |

---

## 1. EXACT CURRENT PRODUCTION CALL PATH

```
HTTP  ──▶  src/routes/*  ──▶  intakeService.processIntake(message, adapter, history, opts)
                                        │
   ┌────────────────────────────────────┴──────────────────────────────────────┐
   │ ONE model call. Structured output: DISTILL_WITH_PLAN_SCHEMA               │
   │   answerPlan.js:175  (additionalProperties:false, required[] enumerated)  │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        ▼
   intakeService.js:769 / :834   enforceReadState(reply, perSource, message)     ← A1-adjacent
   intakeService.js:775 / :838   enforceNoReadClaim(...)                          ← the no-read guard
   intakeService.js:771 / :836   enforceTraditional(...)
                                        ▼
   intakeService.js:777 / :839   buildReadResultReply({ reply, answerPlan,
                                    evidenceSets, itemsBySource, perSource, … })
                                        │  readResultView.js:489
                                        ▼
                  ┌─────────────────────┴─────────────────────┐
                  │ WRAPPER: enforceRouteEvidence()           │  readResultView.js:490-505
                  │   INERT when evidenceSets.length > 0      │  routeEvidenceGuard.js:116
                  └─────────────────────┬─────────────────────┘
                                        ▼
              buildReadResultReplyInner()      readResultView.js:508
                  plan present?  ──yes──▶  renderValidatedPlan()   readResultView.js:314
                                                    │
                                                    ▼
                          validatePlan(plan, {evidenceSets, itemsBySource, message})
                                              answerPlan.js:949
                                              │
                                              ├─ answerPlan.js:989  splitSentences(directAnswer)
                                              │    per sentence: sentenceIsSupported()  :992
                                              ├─ per item:  sourceId must exist         :1018
                                              ├─ per fact:  value must be in evidence   :1081
                                              └─ per limitation                          :1118
                                              returns { plan, drops[], droppedFacts,
                                                        droppedItems, droppedSentences,
                                                        answerSurvived, keptItemCount, … }
                                                    │
                                                    ▼
                          readResultView.js:368-392  outcome decision + logAnswerPlan()
                                                    ▼
                                          rendered reply string
                                                    ▼
                          intakeService.js:795 / :857  return { reply: view.reply, … }
                                                    ▼
                                              HTTP / chat response
```

### Ambiguity reported rather than smoothed over

**`processIntake` has six return exits. Only two pass through `buildReadResultReply`.**

| exit | path | passes the view? |
|---|---|---|
| `intakeService.js:795` | chat + `mode==='commit'` | **yes** |
| `intakeService.js:857` | `mode !== 'commit'` (the ordinary chat/read path) | **yes** |
| `:805` | proposal lane, not a commit intent | no — server-authored literal |
| `:819` | demo commit, narrowing | no — grounded reply |
| `:912` | execution proposal | no — `buildGroundedReply()` |
| `:942` | commit tail | no |

The four that bypass it are **ACTION-lane** exits. Under `turnRouter.routeTurn()` the ACTION
route reads nothing, so `evidenceSets` is empty there and an evidence gate would have nothing to
check. **I did not fully trace `:912` and `:942` to prove `evidenceSets` is always empty on
those paths** — I traced the router's contract, not those two functions. That is stated as an
open item, not asserted.

---

## 2. RECOMMENDED INSERTION POINT

> **Inside `validatePlan()` — `src/intake/answerPlan.js:949` — as a per-unit check alongside the
> existing `sentenceIsSupported` / `sourceId` / fact loops, with the verdict returned in the
> existing `drops[]` array.**

Concretely: the sentence loop at `answerPlan.js:989-992` and the fact loop at `:1081` are already
iterating exactly the units a claim gate should judge, already hold `evidenceSets`, and already
have a structured place to record a rejection.

**Second choice, if Phase 2 wants the smallest possible blast radius:** call it from
`renderValidatedPlan()` (`readResultView.js:314`) immediately after `validatePlan` returns,
reading `v.plan` and `evidenceSets`. This does not require touching `answerPlan.js` at all, but
it can only judge whole fields, not the sentences within `directAnswer`.

---

## 3. WHY THAT POINT IS SAFER THAN WHOLE-ANSWER GATING

1. **The evidence is already there and already indexed.** `validatePlan` builds
   `evidenceIndex(evidenceSets, itemsBySource)` at `:950`. A gate at the end of the pipeline
   would have to be handed the evidence again, and every re-plumbing is a chance to hand it a
   different set from the one the answer was built against.
2. **The units are already separated.** `splitSentences` (`answerPlan.js:941`) exists, is shared
   with `routeEvidenceGuard`, and is used at `:989`. A whole-answer gate would have to
   re-segment — a second implementation of the one thing both halves must agree on.
3. **Refusal is already partial and already recorded.** `drops[]` carries
   `{kind:'item'|'fact'|'limitation', sourceId, field, why}`. A pass/fail over the whole
   response cannot express 「this clause, not that one」, and this pipeline has already paid for
   that: `readResultView.js:360-367` records a live turn where one unverifiable sentence
   destroyed a validated appointment, and the Owner's ruling was **drop the sentence, keep the
   rows.**
4. **A whole-answer gate would be applied to rendered markdown** — headings, `**bold**`, `｜`
   separators added at `readResultView.js:405-409`. Judging prose that the server itself
   assembled is strictly worse input than judging the fields it was assembled from.

---

## 4. GATING UNIT RECOMMENDATION

> **Two units, both already structural. Not the whole answer, and not free prose.**

| unit | where | what the gate would judge |
|---|---|---|
| **`directAnswer` sentence** | `answerPlan.js:989` | the universal-claim / coverage test |
| **`plan.sections[].items[].facts[]`** | `answerPlan.js:1081` | already `{sourceId, field, value}` — claim-local and evidence-linked by construction |

`limitations[]` should be **excluded**. A limitation is a statement that the answer is
incomplete; refusing it for incompleteness would delete the very sentence that makes the answer
honest.

---

## 5. REFUSAL BEHAVIOUR RECOMMENDATION

> **Drop only the offending claim, and record it — matching what this pipeline already does.**

| option | verdict |
|---|---|
| **drop only the offending claim** | **recommended** — identical to the existing sentence/fact/item drops, and to `enforceRouteEvidence`, which withholds per sentence (`routeEvidenceGuard.js:127`) |
| deterministic fallback | already exists for total loss — `minimalAnswer(evidenceSets)`, used at `readResultView.js:372`/`:380`. Reuse, do not duplicate |
| mark unanswerable | **no.** `plan.unanswerable` is the MODEL's declaration; the server overwriting it would put a server verdict in a model-owned field |
| recompose | **no.** Requires a second model call. Explicitly out of scope |
| reject the whole answer | **no.** This is the 2026-08-05 defect the Owner already ruled against |

**Escalation is already implemented and should be reused, not rebuilt:** when everything is
dropped, `answerSurvived` goes false and `readResultView.js:369-373` falls back and logs it.

---

## 6. SHADOW-MODE DESIGN

`EVIDENCE_GATE_MODE = off | shadow | enforce`. **Design only — not added.**

- `off` — not called. Byte-identical to today.
- `shadow` — **the same decision function on the same inputs**, verdict recorded, **verdict
  discarded**. No drop applied, no sentence removed, no counter that feeds rendering.
- `enforce` — the verdict is applied per §5.

**The one property that makes shadow trustworthy:** the shadow call must be the *same call* as
enforce, differing only in whether the return value is used. If shadow computes a verdict a
different way, it measures something enforce will not do.

Structurally that means one function returning a verdict, and exactly one branch that decides
whether to act on it — never two code paths.

**No second LLM call, no retry, no paid call**: the gate is pure and synchronous —
`evidenceGate.js:53` takes `{claim, evidence}` and returns `{ok, reason, detail}`. Nothing in it
performs I/O.

⛔ **`detail` must never be logged.** `evidenceGate.js:117-121` interpolates numbers into a
human-readable string; the numbers are safe, the field is a free-form sentence and is the wrong
thing to put in a log line. Log `reason` (a closed enum, `GATE` at `evidenceGate.js:36`) only.

---

## 7. SAFE TELEMETRY FIELDS

Shape for discussion; **not implemented**. Every field is a count, an enum or an id.

```
event         'EVIDENCE_GATE'          constant
mode          'shadow' | 'enforce'
outcome       'pass' | 'refuse'
reason        GATE.* enum only         evidenceGate.js:36 — never `detail`
unit          'sentence' | 'fact'      which unit was judged
sourceCount   int                      evidenceSets.length
evidenceCount int                      rows across sets
requestId     string | null
```

**Must never appear:** claim text, sentence text, `detail`, row values, field values, titles,
`sourceId` (a real business id), prompts, model prose, document or email content.

Precedent for exactly this discipline: `readResultView.js:497-502` logs
`{withheld: <count>, sources, requestId}` and its comment states 「COUNTS ONLY. The withheld
sentences are exactly the content that must not be logged.」

---

## 8. RISKS AND FAILURE MODES

**⛔ RISK 1 — THE `UNIVERSAL` REGEX WOULD STILL ACT ON FREE PROSE. Reported as a design
weakness, as instructed, and NOT solved here.**

At the recommended insertion point the sentence unit is *structurally delimited* but its
**content is still natural language**, and `checkEvidence` tests it with
`UNIVERSAL = /…全部|所有|一共|總共|冇任何|沒有任何|每一/i` (`evidenceGate.js:45`). So:

- moving the gate to `validatePlan` improves **which text** is judged (a model-authored sentence
  rather than rendered markdown) and **what it is judged against** (the indexed evidence);
- it does **not** remove prose matching. A universal claim phrased without those tokens passes,
  and a non-universal sentence containing one is refused.
- The `facts[]` unit is genuinely free of this — `{field, value}` is compared to evidence, not
  read for meaning. **That asymmetry is the honest state: half the proposal is structural, half
  is not.**

**RISK 2 — Coverage.** The gate would cover only turns that produced an `answerPlan`.
`buildReadResultReplyInner` (`readResultView.js:520-530`) already logs `no_plan_returned` when a
read turn arrives without one; those turns would be ungated.

**RISK 3 — Double refusal.** `enforceRouteEvidence` and `checkEvidence` are complementary today
(`routeEvidenceGuard.js:116` returns inert when `evidenceSets.length > 0`), but nothing enforces
that they stay disjoint. A test should pin it.

**RISK 4 — Refusal becomes silence.** If a gate drops the only sentence and rows also failed, the
Owner sees the deterministic fallback. That is correct behaviour and it must be **logged as a
gate-caused fallback**, not merged into `answer_unsupported`, or the cause becomes invisible.

**RISK 5 — Today the gate would refuse nearly every universal claim**, because `sourceTotal` is
`null` on all six endpoints (A1 closure record). **Shadow mode is what makes this measurable
before it is enforced** — and if the shadow rate is very high, the correct response is a scope
signal, not a loosened gate.

---

## 9. FILES A FUTURE IMPLEMENTATION PHASE WOULD MODIFY

| file | change |
|---|---|
| `src/intake/answerPlan.js` | call the gate in the sentence loop (`:989`) and fact loop (`:1081`); add its verdicts to `drops[]`; extend the returned counters |
| `src/intake/readResultView.js` | surface a gate-caused drop in the outcome decision (`:368-392`) so it is distinguishable in `logAnswerPlan` |
| `src/agent/evidenceGate.js` | **no logic change.** Possibly export a unit label. `UNIVERSAL` is not to be touched |
| *(mode plumbing)* | wherever the project reads flags — **not designed here, not added** |

`src/context/adapters/aromaSystemRead.js` and `src/context/readContext.js` need **no change**:
A1 already supplies `completeWithinScope`, `matchingTotal`, `sourceTotal`, `truncated`,
`limitKnown`.

---

## 10. TESTS A FUTURE IMPLEMENTATION MUST ADD

1. **Shadow changes nothing.** Same input, `mode=off` vs `mode=shadow` → **byte-identical
   reply**, asserted on the string, plus a telemetry line present in shadow and absent in off.
2. **Shadow and enforce compute the same verdict.** The recorded verdict in shadow equals the
   verdict acted on in enforce for the same fixture — the property that makes shadow evidence.
3. **Enforce drops only the offending unit.** A plan with one refused sentence and two valid
   items keeps both items (the 2026-08-05 ruling, re-pinned at the new layer).
4. **A gate-caused fallback is distinguishable** from `answer_unsupported` in `logAnswerPlan`.
5. **No content in telemetry.** A fixture whose claim contains a supplier name and an amount →
   assert neither appears in the emitted line, and that `detail` is absent. (Same shape as
   `turnRouter.test.js`'s allowlist test.)
6. **The two guards stay disjoint** — `enforceRouteEvidence` inert whenever the gate runs.
7. **`limitations[]` are never gated.**
8. **Seen-to-fail for each**, before being trusted.

---

## 11. CAN THE ANSWER PLAN CARRY A CLAIM-LOCAL SCOPE SIGNAL? — YES, STRUCTURALLY

The schema at `answerPlan.js:107` is `additionalProperties: false` with an explicit `required`
list. **A model therefore cannot smuggle a scope field in, and cannot supply one unless it is
declared** — which is exactly the property a structural signal needs.

- **`facts[]` are already claim-local and evidence-linked** via `sourceId` (`:144`).
- **`directAnswer` is free prose** (`:112`, 「一至兩句」) and cannot carry a scope by itself. A
  future signal would be a **new sibling field** — a declared scope for the answer, checkable
  against `evidence.queryScope` **without reading a word of the sentence**.

That is the shape the A1 closure record names as future work. **It is not designed here and no
field was added.**

---

## 12. CONFIRMATION — NOTHING CHANGED

- **No production source file was modified.** This document is the only file created.
- No wiring, no environment variable, no feature flag, no change to `checkEvidence`, no change
  to `UNIVERSAL`, no new regex, no natural-language scope detection.
- No merge, no restart, no deploy. `main` remains `63947dc`.
- No Aroma System server/API change. No second LLM call, no retry, no paid call.
- Persona, Conversation Contract, Decision Recall and provider routing untouched.
- **Implementation awaits a separate Owner GO.**
