# THE FINDING OF THE ROUND — a design round built on a property I asserted about our own output without reading it

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「Record the premise error as the headline of this round, above the seam bug.」**

---

# What I wrote

> 「The live Costco page has **21 buttons all named `Add to Cart`**. The flat serialization
> gives a model **nothing** to tell them apart — **no containing product, no position, no
> grouping**.」

Recorded as a `read_page` limitation. The Owner blocked `click` on it. A design round followed:
containment measured, containers resolved, per-group truncation built first, a corpus frozen,
an A/B run. All of it downstream of that sentence.

# What the output actually contained

```
[#r8314f3ba] link "Bounty Plus Paper Towel, 12 x 91 Sheets"
[#rd412c753] button "Add to Cart"
[#r68ad4dab] link "Scotties Premium Facial Tissue, 21-pack"
```

**The product link sits immediately above its own button.** `read_page` emits in document
order and always has.

> ## 「我對住一個按文件次序輸出嘅嘢，寫咗『冇位置』。」
>
> **I wrote 「no position」 about an output that is emitted in document order.**

# The measurement

| | V2 — already passing | V3 — the 21-button questions |
|---|---|---|
| **FLAT** | **87.5%** | **100%** |
| **GROUPED** | 56.3% | 100% |

**Flat already answers them.** And not by picking the first: the frozen key deliberately
included Kirkland, the *first* product, so that always-pick-first would score 1/3. Flat
answered Bounty and Scott too.

---

# ⚠ WHAT NEARLY HID IT — and this is the part worth carrying forward

**Grouping DID solve the stated problem. 4/4.**

> ### If the seam had been clean from the start, we would have shipped a fix that worked, for a problem that did not exist, at 31 points of cost — and the 100% would have read as proof.

The contaminated seam made FLAT score 75% on V3 instead of 100%. **That gap is the only reason
anyone looked.** A correct measurement of a correct fix would have closed the case.

**Owner: 「That is the most expensive shape yet: not a wrong answer, a right answer to a
question nobody checked.」**

| shape | what it costs |
|---|---|
| a wrong answer | one round, and the tests usually catch it |
| a wrong rate (HR-14) | selects a fix for a mechanism that was never operating |
| a seam that moves two things (HR-17) | makes the numbers unreadable |
| **a right answer to an unchecked question** | **the entire round, and it ends in a green result that nobody has any reason to doubt** |

## Why the existing rules would not have caught it

- **HR-12** guards a *measurement* whose filter matches the claim. There was no measurement —
  the premise was asserted.
- **HR-15** guards a *grader* nobody checked. The grader was fine.
- **HR-17** guards a *seam*. The seam was the accident that exposed this, not its cause.
- **Every A/B in this round compared two treatments.** None asked whether the baseline already
  solved the problem — because the premise said it could not.

> ### The gap is that we validate FIXES exhaustively and PREMISES not at all.

# THE MECHANISM

> ## Before building for a limitation of our own output, PRINT THE OUTPUT AND READ IT.

Not re-derive it, not reason about what the code should produce — read the actual bytes a model
would receive. **The disproof of this premise was four lines of text and cost nothing.** It was
available before the design document, before the corpus round, before `$13` of trials.

And the second half, which is what makes it a mechanism rather than advice:

> ## Every problem statement gets a BASELINE MEASUREMENT before it gets a design.
>
> The V3 questions could have been written and run against flat output on day one. They would
> have scored 100% and the round would never have started. **A question with no gradeable
> answer is a reason to measure the baseline, not a reason to assume it fails.**

---

# STATUS

- **Grouping is OFF by default.** It costs 31 measured points and buys nothing measured.
- **The code stays.** Container resolution, per-group counts and ambiguity reporting are
  correct and tested. What is unproven is whether they **earn their budget** — a different
  claim from whether they work.
- **Proximity is being measured at n=10** before 「grouping is unnecessary」 is treated as
  settled. n=3 is a prompt to measure, not a finding, and this round has been burned twice by
  exactly that.
- **`click` is not built.**
