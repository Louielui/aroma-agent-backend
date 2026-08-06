# The six verbs as ONE thing — live run. **S1 FAILED, and S1 was wrong.**

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「every failure this week appeared at a seam rather than inside a unit.」** It did
> again. The seam is between `read_page` and every verb that follows it.

---

# THE REPORT, as it printed — judge it without the turns

```
 1. navigate                              ARRIVED    https://en.wikipedia.org/wiki/Costco
 2. read_page                             READ       154 of 5533 shown, truncated and stated
 3. click                                 CLICKED    button "Search"
 4. read_page                             READ       35 shown
 5. click(ref from before)                REFUSED    link "Jump to content" — ELEMENT_GONE
 6. click(ref to a removed node)          REFUSED    ELEMENT_GONE
 7. navigate                              ARRIVED    a second article
 8. click(ref from before the navigation) REFUSED    ELEMENT_GONE
 9. type                                  TYPED      searchbox "Search Wikipedia" — 12 chars, shape text
10. wait_for                              HAPPENED   network idle, 868ms
11. click(origin not in the order)        BLOCKED    ORIGIN_NOT_IN_ORDER in 0ms
```

| | |
|---|---|
| **S1** a ref from before an action still resolves after it | **FAIL** |
| S2 a ref to a removed node refuses with `ELEMENT_GONE` | PASS |
| S3 a ref from before a navigation never acts on a different element | PASS |
| S4 the report names every step, target and outcome | PASS |
| S5 no typed value anywhere | PASS |
| S6 no coordinates anywhere | PASS |
| S7 it stops with a named reason | PASS |
| **S8 a knowable stop is fast, not a timeout** | **PASS — 0ms** |

---

# ⛔ WHY S1 FAILED — measured, and the criterion is the thing that was wrong

`link "Jump to content"`, before and after clicking Search on the same page, no navigation:

| | |
|---|---|
| `backendDOMNodeId` **before** | **8001** |
| `backendDOMNodeId` **after** | **20437** |
| anchors in the DOM with that text, after | **1 — it is still there** |
| the original id | **「Node with given id does not belong to the document」** |

**Wikipedia's skin re-renders the header when search opens.** The link is still on the page,
still says the same thing, still does the same job — **and it is a different DOM node.**

> ## `backendDOMNodeId` is stable for a NODE. A node is not stable for a PAGE.
>
> I wrote S1 as 「a ref taken before an action still resolves after it — this is the whole
> premise of `read_page`」. **That premise is false about the real web**, and no amount of care
> on our side can make it true: React, Vue and Wikipedia's Vector all replace element objects
> on re-render as a matter of course.

**This is HR-18 again, one level up.** I asserted a property — this time about the *web*
rather than about our own output — and froze an acceptance criterion on it. The measurement
that disproves it was two `getFullAXTree` calls, and it was available all week.

## What the code did, which is the half that matters

**It refused.** Loudly, by name, without clicking anything.

> The new node sits in the same place, has the same role and the same accessible name. A ref
> scheme that resolved 「by position」 or 「by name」 would have clicked it and reported success —
> and would have been right that time, on that page. **Ours refused, because the identity it
> was given no longer exists.**

That is the opaque-ref decision and the tag-then-locate decision both paying out, on a real
page, in the one situation they were built for.

---

# THE COMPOSITION RULE THIS FORCES — and it is not a code change

> ## A ref is valid for the read that produced it. Not for the session.
>
> **`read_page` must be re-run after any action that could change the DOM** — which is every
> `click` and every `type`. An errand is `read → act → read → act`, never `read → act → act`.

**This is a constraint on how the verbs compose, and it is the natural mistake**: the obvious
way to write an errand is to read once and then act several times, and it will work on a
static page and fail on every framework-rendered one.

## ⛔ AND THE FIX I AM NOT BUILDING

The tempting repair is: when a ref is stale, re-find the element by role + accessible name.

> **No.** That is 「the element that looks like the one you meant」 — the guess this project
> removed from `read_page` twice, returning through the back door of a convenience. It would
> have made S1 pass on this page and would click the wrong thing on a page where two nodes
> share a name, which is the `REF 250` failure with a new costume.
>
> **The refusal is correct. The caller re-reads.**

---

# STATUS OF THE ACCEPTANCE

**NOT MET as frozen, and the frozen text is not being edited to make it pass.** S1 encodes a
false premise; it needs replacing in a future frozen version, with the honest criterion:

> **S1′ — a stale ref is REFUSED by name, never silently re-bound to whatever now occupies its
> place; and the composition rule `read → act → read → act` is documented and tested.**

Seven of eight criteria passed, including every safety property: nothing was clicked that
should not have been, no secret and no coordinate reached the report, and **the stop that was
knowable without waiting arrived in 0ms** rather than as a timeout.

---

# A NOTE THE OWNER ASKED FOR

> **「the password refusal is the decision I would have made and would not have thought to ask
> for. Note that too — it arrived from you, not from a ruling.」**

Recorded as stated. `type` refuses `input[type=password]` and credential-shaped accessible
names outright — not redaction, refusal — and the audit record is built without the typed
value from the start rather than stripped on the way out. **No ruling asked for it.** It came
out of the baseline measurement, where the only honest way to describe the difference between
`click` and `type` was 「`click` moves a mouse; `type` puts content into a page」 — and the rest
followed from taking that sentence seriously.
