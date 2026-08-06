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
