# `read_page` — V2 acceptance run, 2026-08-06. **BAR MET (16/16).**

<!-- record-status: ACTIVE 2026-08-06 -->

| | measured | bar |
|---|---|---|
| **targetsIdentified** | **100%** (8/8) | 90% |
| **absentTargetRefusals** | **100%** (8/8) | 100% |

Cap `$4.50`, spent `$2.52`.

| class | | |
|---|---|---|
| `present` | 5/5 | ordinary targets on real pages |
| **`role-ambiguity`** | **3/3** | **two GENUINELY distinct elements sharing a name** |
| **`truncated`** | **4/4** | **on the page, but CUT from the output** |
| `ABSENT` | 4/4 | not on the page at all |

## Why this run means something the V1 run did not

**V1 asked ONE truncation question** against a defect reproducing about 1 in 14 — so its 100%
was a real number and not evidence. **V2 asks FOUR, on four different real pages**, and every
one was correctly refused.

**And the corpus is real.** Four pages captured **HEADED against the live network**
(`DEFECT-009`): Wikipedia ×2, MDN, and the **live Costco search** — 3565 raw AX nodes against
the 890 of the old locally-rendered copy, which is the JS-loaded content that was previously
missing entirely.

## The role-ambiguity class — the measured weakness, now tested

The name-echo prune (HR-16) removes duplicates **we manufacture**. It must not remove
duplicates **the page really has**. The live Costco page carries `link "Grocery"` AND
`button "Grocery"` — same name, both real, both actionable. Three such questions, **3/3
correct**, each naming the role.

---

# ⚠ WHAT THIS RUN STILL DOES NOT ESTABLISH

**Stated here, above any conclusion drawn from the 100%.**

1. **It is ONE run.** Sixteen independent trials with zero failures is real evidence, but the
   two failure modes V1 caught are now *structurally impossible* rather than *not observed* —
   so what this measures is a different question from the one V1 answered.
2. **`role-ambiguity` is n=3.** Thin. A class introduced because a single flip was observed
   should not be declared handled on three trials.
3. **Half the set is correctly answered `ABSENT`** — 4 truncated + 4 absent. A model biased
   toward refusing scores 8/16, and it scores **0/8 on targets**, so the bar cannot be gamed
   by refusing everything. But the two halves are not independent evidence of the same thing.
4. **⛔ THE HARDEST REAL CASE IS NOT TESTED AND CANNOT BE, TODAY.** The live Costco page has
   **21 buttons all named `Add to Cart`**. The flat serialization gives a model *nothing* to
   tell them apart — no containing product, no position, no grouping.

   > ### That is not a benchmark gap. It is a `read_page` limitation, and it is the Costco judgement problem in miniature: four actions against six classes of judgement a selector cannot make.
   >
   > No question was written for it because **there is no correct answer to grade against.**
   > Fixing it means emitting structure (which product row a button belongs to), which is a
   > design round of its own — not a question to add to this corpus.

---

# STATUS AGAINST THE OWNER'S CONDITIONS FOR `click`

| condition | |
|---|---|
| refs unguessable | **DONE** — opaque hash refs |
| corpus has more than one truncation question | **DONE** — four, on four real pages |
| the bar met on that corpus | **DONE** — 16/16 |

**All three are met.** The `Add to Cart` limitation above is not one of the stated conditions
and is recorded as a known limitation rather than treated as a blocker — **but it is the thing
that will actually be hit first in real use**, and it belongs in the ruling.
