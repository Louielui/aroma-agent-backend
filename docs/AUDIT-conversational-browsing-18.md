# THE 18-REQUIREMENT AUDIT — WHAT EXISTS, BEFORE ANY WIRING

**Audited 2026-08-11 against `docs/DESIGN-CONVERSATIONAL-BROWSING.md` (R1.1 … R6.2).**
Done before wiring, at the Owner's instruction, because a ledger audited afterwards stops
meaning anything.

## ⛔ THE AUDIT'S FIRST FINDING WAS A REGRESSION IT HAD JUST CAUSED

The A1 rewrite deleted `e0b1PublicRead.test.js`, which carried **five assertions that the
credential path is unreachable** (R3.1), and replaced none of them. **Nothing went red.** A
deleted test removes a guarantee in perfect silence — the property does not fail, it simply
stops being checked.

Restored at `893cba0`, and now asserted at the signature too.

> **This is the argument for auditing before wiring, in one instance: the rewrite that made the
> code better also removed a safety proof, and only a per-requirement pass could see it.**

## THE LEDGER

| | requirement | state |
|---|---|---|
| **R1.1** | entrance fires only on the two cases; no model decides | **PARTIAL** — deterministic detection + near-miss corpus tested; no assertion that the module *cannot* take an LLM client |
| **R1.2** | produces an OFFER, never an action | **PARTIAL** — offer shape tested; no assertion that `browseOffer` contains no launch path |
| **R1.3** | order derived server-side, never from a request body | **PARTIAL** — `buildBrowseOrder` refuses caller keys (tested); the request-body half needs a route that does not exist |
| **R1.4** | case-3 fall-throughs are COUNTED | **NOTHING** |
| **R2.1** | errand is not a chat turn; turn returns immediately | **NOTHING** |
| **R2.2** | live status in the existing waiting bar | **NOTHING** |
| **R2.3** | a STOP control, reachable for the whole run | **NOTHING** |
| **R2.4** | status from the errand's own `note()` callback | **NOTHING** |
| **R3.1** | session constructor takes no profile | **ENFORCED** — deleted by the rewrite, restored by this audit |
| **R3.2** | selection never inferred from the destination | **NOTHING** |
| **R4.1** | no-write, no-credential order needs no approval | **NOTHING** — no approval flow exists |
| **R4.2** | an order naming a write or a profile produces a card | **NOTHING** |
| **R4.3** | government blocklist before allowlist, order AND every navigation | **ENFORCED (pre-existing)** — `browser/wiringSmoke.test.js`, strong form |
| **R5.1** | an origin enters the registry only by explicit Owner answer | **PARTIAL** — frozen table, and the `超市` fix removed a generic alias; no test that it cannot grow at runtime |
| **R5.2** | one order per errand, sealed, never widened | **PARTIAL** — sealed at construction and re-checked at session open; no mid-errand widening test |
| **R5.3** | page content can never construct or widen an order | **PARTIAL** — true by construction (the order is built from siteKey + the Owner's words); **not asserted** |
| **R6.1** | the report is STRUCTURED, not prose | **PARTIAL** — `{readState, gate, mayAssertClaim, text}`; not the doc's field set |
| **R6.2** | this section is reviewed when the registry grows | **PROCESS** — not code |

## THE NUMBER

```
ENFORCED      2   (one pre-existing; one deleted and restored by this audit)
PARTIAL       7
NOTHING       8
PROCESS       1
              ──
             18
```

**Before this work the doc recorded 16 of 19 entries as `NOTHING YET`. After it: 8 are still
nothing, 7 are partial, 2 are enforced.** The rewrite moved real ground — and it moved
**none of R2.x**, which is the entire live-errand surface: no acknowledgement turn, no status,
no STOP control.

⛔ **R2.3 is the one to notice.** There is no way to stop a browsing run once it starts,
because there is no run. It becomes a requirement the moment execution is wired, and it is not
a small one.

## WHAT A WRONG EXTRACTION WOULD LOOK LIKE — AND WHETHER ANYTHING WOULD SHOW IT

> **Owner: 「A wrong answer wearing every mark of a right one, and the provenance work we just
> finished makes it MORE convincing, not less.」**

**He is right, and the honest answer is: nothing would make it visible.**

An extractor that reads the wrong DOM node produces an observation that is *structurally
perfect*: a real product string, a real price string, the true origin, a true timestamp, from a
page we genuinely loaded. Every fence passes, because **every fence checks provenance and none
checks correspondence.** The order was honoured. The origin was allowed. The timestamp is real.
The only false thing is that the price belongs to a different product — and no field in the
descriptor is about that.

Three partial mitigations, and none is detection:

1. **The product page instead of the search row.** One item per page removes the
   which-row-is-this class of error, though not a mis-selected node within the page.
2. **Cross-field plausibility.** A price with no product name, or two prices on one row, is
   detectable as *malformed*. A confidently wrong pairing is not.
3. **Show the page.** Report the exact `pageUrl` read, and expect him to look.

> **So the honest version of this feature is: 「我讀咗呢一版，見到呢一行，你自己睇一眼」 — with
> the URL. That is a different product from the one he asked for**, and it should be named as
> such rather than discovered after the first wrong price.

## THE BENCHMARK NOBODY NAMED

**Ringing the store: about two to five minutes, and definitive.** Find the number, wait,
ask a person who is standing near the shelf. The answer covers today's shelf price, promotions,
member pricing and whether it is actually in stock — **all four of which this feature cannot
establish at any level of effort.**

Against that:

| | ring the store | this feature, fully built |
|---|---|---|
| latency | 2–5 min, human | ~1–2 min, unattended |
| authority | the shelf | the website |
| in stock? | yes | no |
| promotions / member price | yes | unreliably |
| wrong-answer visibility | you'd hear the doubt | none |
| scales to 20 items | no | yes |

**The one axis where it genuinely wins is BREADTH, not accuracy.** Twenty items across three
sites, unattended, is not a phone call. One item, right now, definitively — the phone wins, and
it is not close.

⛔ **This should have been named in week one.** It was not, and two weeks of work were spent
without the alternative ever being written down as the thing to beat.

---

# ⛔ STOPPED — 2026-08-11. COSTED, NOT ABANDONED.

> **Owner: 「Worth building if I would use it to decide whether to drive, not worth it if I need
> the number to be right. For peanut butter, I need the number to be right, and ringing the
> store is thirty seconds.」**

**This line is stopped by decision, on evidence, with the work costed.** It is recorded here so
that nobody restarting it in three months mistakes a costing for an abandonment.

## THE BENCHMARK, WHICH SHOULD HAVE BEEN NAMED IN WEEK ONE

**Ringing the store is thirty seconds and definitive.**

It establishes today's shelf price, promotions, member pricing and whether the item is actually
in stock. **This feature cannot establish any of those four at any level of effort** — its
ceiling is the website's price for a store, which is not the till price.

| | ring the store | this, fully built |
|---|---|---|
| latency | ~30s, human | ~1–2 min, unattended |
| authority | the shelf | the website |
| in stock? | yes | no |
| promotions / member price | yes | unreliably |
| a wrong answer is visible | you would hear the doubt | **no** |
| twenty items, three sites | no | **yes** |

**It wins on BREADTH and on nothing else.** One item, now, correctly: the phone wins and it is
not close.

⛔ **Neither of us said this out loud for a fortnight**, and a fortnight of work proceeded on the
unexamined assumption that a browser was the answer. The benchmark was cheap to name and was
never named. That is the most transferable lesson in this file.

## WHAT WAS BUILT AND IS KEPT

The reach and evidence layers are complete, tested and **unwired**: deterministic detection, the
sealed order, the profile-less session, the A1 descriptor, and a renderer whose price sentence
carries its own provenance. `browseResult.js` and its second vocabulary are gone. **None of it
is wasted if the decision is ever revisited, and none of it runs today.**

## WHAT WAS NOT BUILT, AND WHY — SO THE COST IS ON RECORD

- **The observation extractor.** Page → `{product, price}`. Site-specific, and the failure mode
  is the worst in this project: **a wrong DOM node yields a structurally perfect observation** —
  real product string, real price, true origin, true timestamp, from a page genuinely loaded.
  **Every fence passes, because every fence checks PROVENANCE and none checks CORRESPONDENCE.**
  Nothing would make it visible short of the Owner opening the page himself.
- **Store selection.** Necessary and not sufficient. A price claim survives A1's gate only from
  a PRODUCT PAGE (a complete read of one item), not a search row (a truncated sample) — so the
  real work is store selection *plus* product-page navigation, plus a store preference held
  server-side (never a browser profile, which would restore the credential reachability the
  design removed), against a 12-action budget that barely fits.
- **R2.x in full** — no acknowledgement turn, no status line, and **no STOP control**, which
  becomes a hard requirement the moment anything executes.

