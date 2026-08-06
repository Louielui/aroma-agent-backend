# Grouping — built, and it **FAILS the acceptance condition**. 2026-08-06.

<!-- record-status: ACTIVE 2026-08-06 -->

> **The condition, as the Owner set it: 「zero cost on already-passing questions, plus the
> question that has no answer today.」**
>
> ## It buys the second and does NOT buy the first.

FLAT vs GROUPED, interleaved, same session. Cap `$7.00`, spent `$6.19`.

| | V2 — already passing | V3 — no answer today |
|---|---|---|
| **FLAT** | **81.3%** (13/16) | 75% (3/4) |
| **GROUPED** | **56.3%** (9/16) | **100%** (4/4) |

**Grouping solves the 21-button problem — and costs four questions that were passing.**

---

# WHY IT REGRESSED — measured locally, not guessed

The four lost questions were `Jump to content`, `Main menu`, `Clear All Filters`, `Search`.
**None is a duplicate**, so none is affected by grouping's logic. Checking whether they were
misread or simply gone:

| target | in FLAT output | in GROUPED output |
|---|---|---|
| `Jump to content` | **yes** | **NO** |
| `Main menu` | **yes** | **NO** |
| `Clear All Filters` | **yes** | **NO** |
| `Search` | **yes** | **NO** |

**The model was right every time. It answered `ABSENT` about things that were absent.**

## The cause is the budget, exactly as the design predicted

| page | flat shows | grouped shows |
|---|---|---|
| `real-wikipedia-costco` | **150 nodes** | 96 nodes **+ 82 group lines** |
| `real-costco-search` | **116 nodes** | 80 nodes **+ 77 group lines** |
| `real-wikipedia-portal` | **147 nodes** | 105 nodes **+ 93 group lines** |

> ### Group headers take roughly half the node budget, so unique targets get pushed out.
>
> This is the `+228%` warning arriving in the form the design named — **the truncation problem
> back in a new shape** — and it arrived even though context is only spent on duplicates.

## THE FIX I AM NOT APPLYING UNMEASURED

**Serve loose/unique nodes BEFORE groups.** Today `budgetGroups` emits every group first and
spends what remains on loose nodes. A unique target costs **one line** and is exactly what a
model needs; a group costs a header plus members. Reversing the order would preserve flat
coverage and spend only the remainder on disambiguation.

**That is a one-line ordering change with a clear rationale, which is precisely the shape of
「應該會有幫助」 that lost an A/B earlier today.** It gets built and A/B'd, not assumed.

---

# ⚠ AND MY OWN A/B WAS CONTAMINATED — the FLAT arm was not flat

**Stated because three of the numbers above are affected and nobody else would find it.**

The seam is `opts.group === false`. But ambiguity is defined as **「a duplicate with no
resolved container」** — so turning grouping off makes *every duplicate* unresolvable, and the
FLAT arm therefore carried the warning text 「⚠ indistinguishable from N others — do NOT choose
between them」 on **32 nodes**.

| | |
|---|---|
| flat-arm nodes flagged ambiguous | **32** |
| flat-arm text contains the do-not-choose warning | **yes** |

**So the FLAT arm was not 「grouping off」. It was 「grouping off AND actively told not to
choose」** — which is why FLAT failed the three role-ambiguity questions it had passed 3/3 in
the V2 run hours earlier.

> ### The seam does not isolate the thing I claimed it isolates.
>
> HR-17 says build the measurement tool. It does not say the tool is automatically right. **A
> seam that flips two behaviours measures neither**, and this one was built by me, in the same
> session I wrote the rule about seams.

**What survives the contamination:** the four GROUPED failures are all **unique-name** targets,
untouched by ambiguity flagging, and independently confirmed above as *cut from the output*.
**The regression is real. The FLAT baseline is understated.**

---

# STATUS

| | |
|---|---|
| 21-button problem | **solved** — 4/4, and it had no gradeable answer before today |
| group-internal truncation | **built first, as ordered, and it fires on a real page**: `group "In 2022, Costco opened a Costco Home Showroom in" — 1 of 2 shown` |
| genuine same-container siblings | **reported, never resolved by picking** — flagged `ambiguous`, both kept, warning in the text |
| **acceptance condition** | **NOT MET** |
| `click` | **not built** |

## Two corrections to things I told the Owner

1. **「the page with a truncated group is not in the corpus」 — wrong.** It already was:
   `real-wikipedia-costco` produces one. I captured two more pages (`real-long-list`,
   `real-table-heavy`) looking for a case that was already there; neither adds it.
2. **The first version emitted a bare header** — `group "Panorama…" — 0 of 1 shown` — because
   the fit probe said one member would fit and the loop then took none. **The unit tests
   passed; synthetic groups never hit it.** Found by reading real output, fixed, and now
   asserted as an invariant across an 8×6 sweep of budgets rather than as a scenario.

---
---

# THE SEAM IS FIXED, AND THE ORDERING FIX IS MEASURED DEAD — 2026-08-06

## 1. `FLAT` now means flat

The seam moved two behaviours. Fixed in two places, because the first fix was incomplete:

| | before | after |
|---|---|---|
| resolution skipped when grouping off | every duplicate 「unresolvable」, **32 nodes told 「do NOT choose」** | resolution ALWAYS runs; the seam only decides whether group *lines* are emitted |
| flagging keyed by **name**, resolution by **node** | **153** flagged flat vs **134** grouped | flagged by node — identical in both arms |

**Proven, not intended:** for three real pages, both arms at an unbounded budget must show the
**same nodes, the same ambiguous flags, and the same warning text**, differing only in group
lines. Those tests exist now and would have failed on the day. See HR-17's worked example.

## 2. ⛔ 「Serve loose nodes first」 does not work — and it cost nothing to find out

The proposed fix was A/B-ready. **Checked locally first, for free, and it is dead:**

| page | FLAT | GROUPED | **LOOSE-FIRST** |
|---|---|---|---|
| `real-wikipedia-costco` | 154 nodes | 96 nodes + 82 groups | 151 nodes **+ 0 groups** |
| `real-costco-search` | 182 nodes | 80 nodes + 77 groups | 175 nodes **+ 0 groups** |
| `real-wikipedia-portal` | 159 nodes | 105 nodes + 93 groups | 152 nodes **+ 0 groups** |

It restores **all four** lost targets — and emits **zero groups on every page**, so
`Add to Cart` shown drops to **0** and the 21-button fix is gone entirely. **It is flat output
with extra steps.**

> ### Neither extreme works. Groups-first loses unique targets; loose-first loses every group.

**No paid A/B was run**, because a local measurement answered it. That is the cheapest possible
outcome and worth naming: **an A/B is for questions the code cannot answer about itself.**

## 3. SO THE REAL QUESTION IS ALLOCATION, AND IT IS THE OWNER'S

The fix is not an ordering. **It is a policy for splitting one budget between two goods that
compete directly:**

| | buys | costs |
|---|---|---|
| **coverage** — loose, unique nodes | one line each; most questions need exactly this | nothing else fits |
| **disambiguation** — groups | the only way to reach one of 21 identical buttons | a header plus members, ~half the budget in practice |

Candidates, none built:
1. **A fixed split** (e.g. 60% coverage / 40% groups), tuned by A/B.
2. **Bigger budget for structured output** — the budget was chosen for a flat list, and it has
   never been re-derived since the output stopped being one.
3. **Group only where the page is dense in duplicates** — Costco's 21 buttons matter; the
   Wikipedia portal's 93 groups of citation links almost certainly do not.

**I am not picking one.** Two 「應該會有幫助」 changes have now been measured this round: one lost
its A/B, one died locally. **A third guess is not what this needs** — and (2) in particular is
a change to what the model is asked to read, which is the Owner's call and not a tuning knob.

---
---

# ⛔ THE CLEAN A/B INVERTS THE PREMISE OF THIS ENTIRE ROUND

Re-run with the fixed seam. Cap `$7.00`, spent `$6.25`.

| | V2 — already passing | V3 — the 21-button questions |
|---|---|---|
| **FLAT** | **87.5%** (14/16) | **100%** (4/4) |
| **GROUPED** | **56.3%** (9/16) | **100%** (4/4) |

## Two things changed once `FLAT` meant flat

**1. The regression is WORSE than reported: 31 points, not 25.** The contaminated baseline was
81.3%; the real one is 87.5%. **I under-reported the damage**, because the arm I compared
against had been handicapped by my own seam.

**2. And this is the finding: FLAT scores 100% on V3 too.**

> ## Flat output already answers the 21-button questions. Grouping buys NOTHING there and costs 31 points.

### Why — and it was visible in the output the whole time

```
[#r8314f3ba] link "Bounty Plus Paper Towel, 12 x 91 Sheets"
[#rd412c753] button "Add to Cart"
[#r68ad4dab] link "Scotties Premium Facial Tissue, 21-pack"
```

**The flat list preserves document order, so the product link sits immediately above its own
Add to Cart button.** Proximity already carries the association, and the model reads it.

**This is not the model guessing 「the first one」** — the frozen key deliberately included
Kirkland, the *first* product, precisely so that always-pick-first would score 1/3 rather than
0/3. Flat answered Bounty and Scott correctly too, neither of which is first.

## What I got wrong, plainly

**The premise was 「the flat serialization gives a model NOTHING to tell them apart — no
containing product, no position, no grouping」.** That was stated as a limitation and acted on.

> ### It was wrong. The flat serialization gives a model POSITION, and position was enough.
>
> I had written 「no position」 about an output that is emitted in document order.

## ⚠ What this does NOT establish

**V3 is n=3 real container questions** (the fourth is an ABSENT control). **A 4/4 at n=3 is
exactly the thin evidence this round has twice been burned by** — the 1-in-4 that was really
1-in-14, and the single clean run that the A/B then contradicted.

**It is enough to stop grouping being the default. It is not enough to conclude that
containers are never needed** — proximity will fail wherever the DOM order does not put the
label beside the control, and no corpus page tests that yet.

## RECOMMENDATION — and the ruling is the Owner's

1. **Grouping OFF by default.** It costs 31 measured points and buys nothing measured.
2. **Repeat V3 flat-only, ~10 runs per question** (~$4.50) before concluding proximity is
   reliable. n=3 is not a finding, it is a prompt to measure.
3. **Keep the code.** The container resolution, the per-group counts and the ambiguity
   reporting are all correct and tested; what is unproven is that they are *worth their
   budget*. The allocation question is now much weaker — you do not need to split a budget
   for a benefit you have not shown exists.
