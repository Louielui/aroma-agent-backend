# L3 built and measured — **it costs nothing to read, and it refused 51 writes.**

<!-- record-status: ACTIVE 2026-08-06 -->

**Step 2 of the approved order. No orders placed, no login, no paid model calls. `$0.00`.**

---

# WHAT IT IS

**Deny non-`GET` by default.** Every `POST`, `PUT`, `PATCH`, `DELETE` — and every method
nobody thought of — is aborted **unless the sealed order named it by origin, path prefix AND
method together**. No wildcard. An absent `allowedWrites` blocks every write.

> **A site chooses what it calls its buttons. It does not choose whether a purchase is a
> write.**

**17 tests, written failing first.**

---

# THE COST TO READING — measured, six real sites, fence ON vs OFF

| site | fence OFF | fence ON | writes refused | verdict |
|---|---|---|---|---|
| recall register | 213 | **213** | 2 | **no cost** |
| Wikipedia | 3000 | **3000** | 0 | **no cost** |
| Open Collective | 551 | 539 | 3 | no cost (−2%) |
| Patreon | 173 | **173** | 6 | **no cost** |
| Humble Store | 472 | **472** | 18 | **no cost** |
| DigitalOcean | 837 | **837** | 22 | **no cost** |

**51 writes refused in total. Not one page lost readable content.**

## And the end-to-end check, which matters more than node counts

**ERRAND-003 re-run with the fence installed** — the one errand that has ever produced an
answer:

```
「mushrooms」相關嘅回收 —— 4 條   ← identical to the run without the fence
L3:拒絕咗 3 個寫入請求,批准咗 0 個
    POST https://www.google-analytics.com/g/collect
    POST https://www.google.com/g/collect
    POST https://canada.sc.omtrdc.net/b/ss/canadalivemain/...
```

**The three refusals were analytics beacons.** Refusing them is a bonus, not a cost.

> ## The fence that L1's 45% made necessary turns out to be free.

---

# ⚠ WHAT THIS MEASUREMENT DOES NOT COVER

**None of the six sites uses a `POST` to search.** A site whose search or filtering runs over
GraphQL — which is a `POST` — **would break under this fence**, and the errand would stop with
a page that never loaded its results.

**That is not a defect; it is the fence working.** But it means:

1. **The right response is an `allowedWrites` entry in the sealed order** naming that origin,
   that path and `POST` — deliberate, per-errand, and reviewable.
2. **It is a real operational cost that has not been paid yet**, because no site in this
   sample needed it. **The first supplier portal may.**

## And the limits the fence states about itself, in its own file

> **A `GET` that commits is not caught.** An unsubscribe link, a delete-by-URL, an old-style
> confirm link — this fence passes every one.
>
> **It does not read bodies.** It is a method-and-destination fence, not a content filter, and
> claiming otherwise would be the third leaky layer pretending to be a complete one.

**Query strings are stripped from the record** — a query can carry a token or a card number,
and the same rule applies as `type` never recording what was typed.

---

# STATUS OF THE THREE LAYERS

| | what it is | measured |
|---|---|---|
| **L1** button recognition | **convenience** | 100% fitted, **45% held-out**, and optimistic |
| **L2** empty profile | removes **autofill only** | not built — the merchant still holds the card |
| **L3** request fence | **the guardrail** | **built. Free to read. 51 writes refused across six sites** |

**Next: PUA stripping in `read_page` — a general fix, reported separately — then the payment
probe, proven to fail.**
