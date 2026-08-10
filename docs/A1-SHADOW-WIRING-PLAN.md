# A1 — `checkEvidence` IN SHADOW: WIRING PLAN AND MEASUREMENT DESIGN

**Owner GO, 2026-08-10: wire `checkEvidence` in shadow. Compute, record, do not block.**
**Then decide enforcement with numbers.**

Written before any code, because the measurement design decides what gets built.

---

## 0. RECORDED ORDERING RULING

> **Owner: 「Do not touch #37 while A1 is in shadow.」**

**Browser evidence is a source A1 was never designed for, and proving a guard on a source it was
never built for is not proving it.**

`checkEvidence` was written against `aroma_system` reads: rows from endpoints with a declarable
`queryScope`, a knowable `limit`, and a server that either does or does not report a total. A
Superstore search-results page shares the vocabulary but not the situation — no declarable scope,
no knowable limit, a store predicate nobody chose, and no total, ever.

If E0-B1 became the first production caller, the shadow numbers would describe how the gate
behaves on the one source it was not built for, and that result would then be used to decide
enforcement for the source it WAS built for. PR #37 stays untouched until A1 has fired on real
turns on its own path.

---

## 1. WHERE IT HOOKS IN

One composition point, and it is the one A2 P2 already uses:

| | |
|---|---|
| **Function** | `validatePlan(plan, { evidenceSets, itemsBySource, message })` — `answerPlan.js:1054` |
| **Called from** | `readResultView.js:321` |
| **Existing precedent at the same point** | `verifyClaimBindings(...)` — `answerPlan.js:1259`, computed and acted on by nothing |

It already holds both halves: the model's claims (`plan`) and the evidence descriptors
(`evidenceSets`). Nothing new needs to be threaded through the call path.

**Shadow means shadow.** The returned `plan` is not touched, no branch reads the verdict, and the
rendered reply must be byte-identical with the shadow computation present and absent — asserted by
test, because 「it only adds metadata」 is a claim about code and this project has been wrong about
that before.

---

## 2. THE MEASUREMENT PROBLEM

> **Owner: 「If the regex misses most real universal claims, the shadow numbers will look
> reassuring for the wrong reason — a low block rate because the gate is blind, not because the
> claims are sound. Say how you would tell those apart.」**

### The block rate cannot answer this. Ever.

A block rate is one number produced by two unknowns multiplied together:

```
blocks  =  (what claims the system actually makes)  ×  (what the detector can see)
```

A low number is equally consistent with sound claims and with a blind detector, and **no amount of
care in computing it separates the two.** To interpret it at all, one of the two factors has to be
measured independently. That is what the design below does, and it is why the instrument is not
「count the refusals」.

---

## 3. THE INSTRUMENT

### Layer 0 — record what the gate SAW, not only what it did

Every shadow evaluation records the claim text, the verdict and reason, **and the descriptor's
structural fields**: `truncated`, `completeness`, `matchingTotal`, `sourceTotal`, `filtersApplied`,
`rowShape.hasLocation`, `readState`, `limitKnown`.

Without the inputs, a question asked later can only be answered by re-running production.

### Layer 1 — split the denominator

The gate has an opinion only when a claim is universal AND the evidence is weak. So four numbers,
never one:

| | |
|---|---|
| **A** | turns evaluated |
| **B** | turns whose evidence was **structurally weak** — derived from the descriptor alone, no prose read |
| **C** | turns the gate had **any opinion** on (gate-eligible) |
| **D** | would-have-blocked, **reported against C** |

「2% of all turns blocked」 and 「the gate had an opinion on 5% of turns and refused 40% of those」
are the same data and opposite conclusions. Only the second is a statement about the gate.

### Layer 2 — the blind-spot set. This is the discriminator.

```
BLIND-SPOT SET  =  { evidence structurally weak }  ∩  { gate passed }
```

Every member is exactly one of two things:

- **(a)** a properly hedged claim — the system is sound, or
- **(b)** a universal claim the regex did not recognise — the gate is blind.

There is no third possibility, the set is small (weak evidence is a minority of turns), and it is
reviewable by hand.

> **The reason this works: membership is decided by the DESCRIPTOR, which the regex plays no part
> in producing. The structural detector audits the prose detector. A gate can never be used to
> measure its own blindness, and every design that tries is circular.**

### Layer 3 — sensitivity, from captured text and not from imagination

Recall is measured by hand-labelling the claims in the blind-spot set as universal / not.

⚠ **The corpus must come from Layer 0 captures, never from examples I invent.** If I write the
probe list myself I will write probes the regex catches — the same defect as a test that measures
the thing it was derived from.

⚠ **And my labelling is a model reading prose — the very activity the gate is criticised for.** The
difference is that it is offline, recorded, and auditable rather than load-bearing at runtime.
**Chef should spot-check a sample of my labels**; if he disagrees with them, the recall number is
worthless and should be recomputed from his.

**Pre-registered prediction, from reading the pattern before seeing any data.** `UNIVERSAL` is:

```js
/\b(all|every|none|no\s+\w+\s+(is|are|has|have))\b|全部|所有|一共|總共|冇任何|沒有任何|每一/i
```

These are universal claims in the register Aroma actually replies in, and **none of them match**:

| claim | why it escapes |
|---|---|
| 「一張都冇」 | universal negation; only `冇任何` is listed |
| 「冇一張係未找」 | `冇一張` is not `冇任何` |
| 「無一例外」 | absent entirely |
| 「都收晒貨」 | `晒` marks completion in Cantonese and appears nowhere |
| "not a single one is outstanding" | `no\s+\w+\s+(is\|are)` does not fit |

If the shadow data shows the blind-spot set populated by claims of this shape, **the low block rate
is explained by blindness and not by soundness**, and enforcement must wait for the detector.

### Layer 4 — pre-registration, written before the data exists

Recorded now so the interpretation cannot be chosen after seeing a reassuring number. This is the
「do not tune after a failed canary」 rule applied to interpretation instead of prompts.

| result | ruling |
|---|---|
| Blind-spot set populated, hand review finds real universals | **Gate is blind.** Block rate means nothing. Fix the detector before enforcement is discussed. |
| Blind-spot set small, or its contents properly hedged | The low block rate is **real evidence of soundness**. Enforcement is arguable on numbers. |
| **C is tiny (gate-eligible under ~5% of turns)** | **The gate is inert on production traffic regardless of accuracy.** Enforcing it would be theatre, and the honest report says so. Neither of us named this outcome in advance; it is a real possibility and it is recorded here so it cannot be quietly skipped. |

---

## 4. DOES SHADOW MAKE THE PROSE-READING WORSE, OR JUST VISIBLE?

**Both, and they are not in tension.**

**Visible**: until now nothing recorded what the gate was shown and what it concluded. Layer 0 is
the first time the blindness becomes measurable rather than arguable.

**Worse**: the shadow report is the artifact that will be used to decide enforcement. A reassuring
number produced by a blind gate is a *stronger* argument for enforcement than having no data at
all — before shadow, nobody could claim the gate works; after a naive shadow report, somebody can,
with a chart. The failure mode is not that the gate stays blind. It is that the gate stays blind
**and acquires evidence.**

That risk is created by the measurement, so it is the measurement's job to close it. Layers 1–4
exist for that and for nothing else.

---

## 5. WHAT THIS PHASE DOES NOT DO

No enforcement, no branch reading the verdict, no change to any rendered reply, no provider or
routing change, no restart or deploy, no PR #37 work, no Wisdom work.
