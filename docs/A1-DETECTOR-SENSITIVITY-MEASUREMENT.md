# A1 — `UNIVERSAL` DETECTOR SENSITIVITY: MEASURED ON REAL REPLIES

**Measured 2026-08-10, against 49 sentences drawn from 202 real assistant replies in
`data/conversations` (29 conversations). No sentence was written for this exercise.**

Owner labelled all 49 blind — without the regex, the evidence, or any verdict — then the labels
were compared against the pattern. Layer 3 of the shadow plan, run early because real reply text
already existed.

---

## ⛔ THE HEADLINE. IT IS NOT EITHER RATIO.

> **THE GATE IS INVERTED. Four firings on this sample; three of them landed on sentences in which
> the assistant was declaring her own limitations.**

| # | the sentence the gate fired on |
|---|---|
| 30 | Drive 讀取只顯示了樣本，**無法看到全部**檔案清單 |
| 34 | 系統只顯示 1 筆記錄，**可能不是全部** |
| 45 | 樣本只顯示 4 項，**無法反映全部** 199 項嘅完整狀況 |

All three contain `全部`. All three **negate** it. The pattern matches the word and cannot see the
negation wrapped around it.

**Enforcing this gate today would suppress her honesty and pass the actual universal claims.** Not
「it would block too little」 — it would block the wrong direction. A system that refuses
「我睇唔到全部」 while allowing 「倉存有四項」 is worse than one with no gate at all, because the
honest sentence is the one the Owner needs and the false one is the one he cannot check.

This finding barely depends on sample size. Three of four firings landing on self-limitation is a
statement about shape, not about frequency.

---

## THE RATIOS, WHICH ARE THE SECONDARY RESULT

| | on Owner labels | excluding over-schema universals |
|---|---|---|
| **Recall** | **1 / 6** | **1 / 4** |
| **Precision** | **1 / 4** | 1 / 4 |

Both are weak point estimates — six universals is a small denominator and the number should not be
quoted as statistical evidence. **The shapes below are the finding; the ratios are the summary.**

### The five the pattern missed, and what shape each took

| # | sentence | shape |
|---|---|---|
| 18 | 今日**冇**特別安排 | Cantonese universal negation: `冇` + noun. Pattern has only `冇任何` |
| 40 | 系統記錄**沒有**地點標籤 | same: `沒有` + noun. Pattern has only `沒有任何` |
| 42 | **各項**存量無地點或時間戳記錄 | universal quantifier `各項`. Pattern has `每一`, not `各項` |
| 33 | 倉存有 A、B、C、D **四項**，當中三項已低於安全存量 | **enumeration as closure** |
| 38 | 倉存有 A、B、C、D **四項**，但多數存量偏低 | **enumeration as closure** |

### The pre-registered prediction, unsealed

Predicted: Cantonese universal negation (`一張都冇`, `冇一張`, `無一例外`, `都收晒貨`) escapes.

**Partly confirmed, and too narrow.** 18 and 40 are that family. 42's `各項` is an adjacent
quantifier that was not predicted.

**And the prediction missed the category that matters most.** 33 and 38 contain **no universal
word at all**. 「倉存有…四項」 asserts closure by ENUMERATING. There is no `全部`, no `所有`, no
`每`, no negation — nothing lexical to add to a pattern.

> **This is the result that decides what happens next. Adding words repairs 18, 40 and 42. Nothing
> repairs 33 and 38, because a claim made by enumeration has no lexical marker to detect. A prose
> detector is structurally blind to it, and no amount of pattern work changes that.**

---

## OVER-ROWS VERSUS OVER-SCHEMA — a distinction that changes what should be blocked

40 and 42 are universal in FORM but they describe **the shape of the data**, not business fact:
「記錄冇地點欄位」. That claim is supported by the DESCRIPTOR — it is literally
`rowShape.hasLocation === false` — not by having scanned every row.

- **over-rows universal** — 「所有採購單都已收貨」. A sample cannot support it. **Dangerous.**
- **over-schema universal** — 「記錄冇地點標籤」. The descriptor asserts it directly. **Safe.**

A detector that treats them alike would block a true statement that the evidence fully supports.
Owner accepted this distinction on review; it is recorded because it changes the target, not just
the accuracy.

---

## WHAT A NON-LEXICAL DETECTOR LOOKS LIKE

> **Owner instinct: 「a reply enumerating N items against evidence whose `completeWithinScope` is
> not true is making a closed-set claim regardless of wording. The gate's INPUT is wrong, not its
> pattern.」**

**The central move is right, and it is the important one.** Enumeration is a STRUCTURAL act. The
plan object already knows the reply listed four items — `keptItemCount`, declared `sections`, the
bound rows — with no sentence read. Universality-by-enumeration is invisible to language and
plainly visible to arithmetic. `keptItemCount = 4` against `matchingTotal = 199` is a mismatch no
pattern could ever see and the system can already compute today.

It also disposes of an objection that looks fatal and is not. **A reply may enumerate four items as
EXAMPLES rather than as the whole set, and the structure is identical either way** — so the
detector cannot tell a closed-set claim from an example list. It does not need to: the required
remedy is the same for both, and A1's own gate already names it — *say 「見到嘅 N 項入面」*. An
enumeration against incomplete evidence needs the hedge whichever it meant.

### ⛔ But the field is wrong, and it is the exact field A1 already corrected once

> **Owner ruling, on the record in `evidenceGate.js`: 「completeWithinScope=true means only: all
> rows matching the declared server query were returned without truncation. It does NOT mean: all
> records in the wider source were examined.」**

Triggering on `completeWithinScope !== true` therefore **passes** the case where it IS true but the
declared scope was narrow — which is precisely the defect behind 「14 purchase orders, complete
within a thirty-day window, support 『所有採購單都已收貨』」. Using that field as the condition
rebuilds a fence A1 already took down once.

A closed-set claim is about the SOURCE, so it needs source-level completeness:

```
closed-set claim is supportable  ⟺  sourceTotal is known  AND  enumerated === sourceTotal
```

And `sourceTotal` is, in the reader's own words, **`null` unless the server says so — and it never
has.** So the honest consequence is blunt:

> **A closed-set claim is currently NEVER supportable by any evidence this system can obtain.** The
> structural detector does not need to weigh it. It needs to say so.

That is a stronger conclusion than the instinct it came from, and it survives the correction.

### What neither detector covers alone

| | catches | misses |
|---|---|---|
| **lexical** (today) | summary universals — 46's `所有` | enumeration closure (33, 38); inverted on negated hedges |
| **structural** (proposed) | enumeration closure; immune to negation and to language | **summary assertions that enumerate nothing** — 「所有採購單都已收貨」 lists no items, so there is no count to compare |

**Neither is sufficient. The property needs a composition**, with the structural half PRIMARY —
because it cannot be talked past, and it works regardless of whether the reply is in Cantonese,
English or both — and the lexical half demoted to the summary-assertion case only, and not firing
at all until its negation blindness is repaired.

### The strongest version, and it reuses machinery that exists

A2 P2 already computes `answerClaims` / `verifyClaimBindings` — declared, structural, acted on by
nothing. If a reply DECLARES its coverage (`exhaustive` vs `examples`) as a field, the gate
compares a declaration against a descriptor: arithmetic, no prose, in the existing claim-binding
lane rather than a third mechanism. A model can mis-declare — but a mis-declaration is checkable
against the descriptor, and prose never was.

---

## WHAT THIS CHANGES ABOUT A1 SHADOW WIRING

**Shadow still runs.** The inversion is a finding about the DETECTOR; shadow measures the TRAFFIC —
how often claims are made, how often evidence is weak, how often either detector would fire. Those
are different questions and the second is still unanswered.

Three changes:

1. **The block rate now has a known explanation before the first number arrives.** Whatever it
   turns out to be, it is not evidence that claims are sound. Pre-registration Layer 4 is already
   partly resolved: *gate is blind → fix the detector before enforcement is discussed.*
2. **Layer 0 must record the structural fields too** — `keptItemCount`, `modelItemCount`,
   `matchingTotal`, `sourceTotal`, `completeWithinScope`, `completeness`, `truncated` — so a
   candidate structural detector can be replayed against captured turns **without running
   production again**. Recording only the lexical verdict would force a second live phase to ask
   the question we already know we need to ask.
3. **The lexical gate's verdicts are reported as a known-inverted baseline**, never as the
   measurement of the property.

The regex was not changed. No detector was built. This document is the measurement and the design
argument only.
