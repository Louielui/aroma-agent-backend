# L1 measured — **100% on the corpus it was written against, 45% on pages it had never seen.**

<!-- record-status: ACTIVE 2026-08-06 -->

**Step 1 of the approved build order. No orders placed, no cart, no login, no paid model
calls. `$0.00`.**

---

# HOW THE PAGES WERE REACHED — the Owner's question, answered first

> **Owner: 「confirm reaching a checkout page is a GET that places nothing. If any candidate
> cannot be reached without a live cart, drop it rather than improvising.」**

**Every page was reached with ONE `page.goto` — a single GET.** Nothing was clicked. No cart
exists. No account is logged in. No payment was initiated at any point.

**Four candidates were DROPPED rather than improvised** — retailer checkouts (Costco, Amazon
and similar) cannot be reached without a live cart, so they are not in the corpus.

## The sites

| fitted corpus (9) | held-out (5) |
|---|---|
| `supporters.eff.org` · `donate.wikimedia.org` · `sublimetext.com/buy` · `donate.mozilla.org` · `archive.org/donate` | `fund.blender.org` · `thunderbird.net/donate` · `letsencrypt.org/donate` · `opencollective.com` · `patreon.com` |
| `jetbrains.com/store` · `namecheap.com` · `digitalocean.com/pricing` · `humblebundle.com/store` | |

**Donation and subscription pages are real payment pages** — a genuine commit button, a real
processor, an amount — and reaching one places nothing. The four commercial pages are there as
**false-positive tests**: a cart, a pricing table, a carousel and a cookie banner.

---

# THE RESULT

| | recall | false positives |
|---|---|---|
| **the corpus it was written against** | **11/11 = 100%** | **0/11 = 0%** |
| **held-out pages it had never seen** | **5/11 = 45.5% — and this is OPTIMISTIC, because the hardest button is the one we cannot reach without doing the thing we are preventing** | 0 clear |

## ⛔ THE 100% WAS FITTING, AND I SAID SO BEFORE MEASURING THE HELD-OUT SET

I listed the corpus element names in order to hand-label them — **so I had seen
`AGREE & PROCEED`, `Next`, `Buy` and `Add to cart` before writing the exclusions that exempt
them.** The recogniser was committed **unchanged** before the held-out capture, so the second
number is verifiably against a frozen rule set.

> ### A fitted 100% and a held-out 45% is the same result twice: the recogniser knows this corpus, not the web.

## What it missed, and why — two distinct causes

### 1. Vocabulary nobody would have guessed wrong, and everybody would have guessed differently

```
opencollective   button "Contribute"          <- this IS the payment entry
opencollective   link   "Become a backer"
opencollective   link   "Become a sponsor"
patreon          link   "Start a membership"
blender          link   "Donate to Blender!"
```

**Two entire sites use a commit vocabulary the rule set does not contain.** Not obscure words —
`Contribute` is the single most prominent control on Open Collective. **No list would have had
it, because the list is written by someone imagining names, and the site chose them.**

### 2. ⚠ ICON-FONT CHARACTERS INSIDE ACCESSIBLE NAMES — a general finding, not a payment one

```
blender   link  "<U+E81C> Donate"     first character = U+E81C  (Private Use Area)
```

The accessible name carries an **icon-font glyph as part of the name**. Any anchored pattern
(`^donate$`) fails. **The word is there; the name is not the word.**

> **This affects `read_page` too, not only L1.** Those glyphs sit in the text a model reads, and
> nothing in the pruner strips or reports them. **It is a finding about the whole stack,
> discovered because a payment rule happened to be anchored.**

---

# WHAT THIS SETTLES — and it confirms the Owner's ruling rather than softening it

> **The question was: 「is L1 worth 90% or 40%?」 Measured: it is worth about 45%.**

| | |
|---|---|
| **L1 as a safeguard** | **fails roughly one commit button in two on sites it has not seen** |
| **L1 as a convenience** | **useful** — it catches the obvious cases with no false positives, which is what makes day-to-day operation tolerable |
| **L3 as the fence** | **confirmed load-bearing.** Nothing else in the design survives a 45% recogniser |

**The Owner's instinct that L1 leaks was right, and the leak is larger than 「a button might be
named oddly」 — it is 「a whole site's vocabulary may be missing」.**

## And the honest limit of this measurement itself

**The hardest case is not in it.** A final `Place Your Order` on a retailer, after a logged-in
cart, is the exact button that matters most and the one that cannot be reached without doing
the thing we are preventing. **This measures payment-ENTRY controls, not final-order controls.**

**So 45% is an optimistic estimate of the thing we actually care about**, because donation
pages label their commits far more plainly than a checkout flow labels its last step.

---

# NOT FIXED — deliberately

The obvious response is to add `contribute`, `become a`, `start a membership`, and strip
Private Use Area characters. **That would raise the number on these five pages and tell us
nothing about the next five.**

> ### Widening the list is how a 45% recogniser becomes a 100% recogniser on every corpus it has ever been shown, and stays 45% on the web.

**What would actually be worth building** — for the Owner to rule on, not now:

1. **L3 first**, per the approved order. It does not depend on this number.
2. **Strip Private Use Area characters in `read_page`**, as a general fix, not a payment one.
3. **If L1 is widened, it must be re-measured on a NEW held-out set each time** — otherwise the
   number is meaningless in exactly the way this round has just demonstrated.
