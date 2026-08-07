# Logged-in browsing with a two-layer stop — DESIGN ONLY

<!-- record-status: ACTIVE 2026-08-06 -->

**Owner decision, 2026-08-06:** *She may use my logged-in accounts. She stops before payment
and before any government submission, and I complete those steps myself.*

**Nothing built. No profile created. No credentials touched.**

---

# 0. THE RULING'S OWN REASONING, KEPT AT THE TOP

> **Owner: 「today's Costco errand proved layer 1 leaks. You expected the run to die at
> submission because there is no submit verb — instead `read_page` surfaced `button "Search"`
> and `click` pressed it. A payment button is indistinguishable from a search button in an
> accessibility tree. Both are `button`. Recognition depends on the site's naming, which the
> site controls.」**

That is the whole design constraint, and it is **evidence, not caution** — it happened
yesterday, on a real page, to this codebase.

---

# ⛔ 1. THE FIRST THING THE OWNER MUST KNOW: LAYER 2 DOES NOT DELIVER 「CANNOT PAY」

**Stated before the design, because the design is worth less than this correction.**

The ruling says: *the profile carries no payment method, so 「cannot pay」 becomes a property of
the environment rather than a rule she follows.*

**That is true only for cards the BROWSER stores.** It is not true for cards the SITE stores.

| where the card lives | does an empty profile stop payment? |
|---|---|
| Chrome autofill / Google Pay in the profile | **YES** — removing it is structural |
| **the merchant's own account record** — Costco, Amazon, Sysco, almost every retailer the Owner uses | **NO.** A logged-in account with a card on file pays with one click, and the browser profile is irrelevant |

> ## An empty profile removes AUTOFILL. It does not remove the Owner's card from Costco's database.
>
> If she is logged into his Costco account and presses a button named something we did not
> recognise, **the order is placed** — layer 2 never engages, because no browser-stored payment
> was involved.

**So the two layers as stated are: one leaky recognition layer, and one layer that does not
cover the dominant case.** That is a weaker position than the ruling assumes, and it must be
fixed in the design rather than discovered in production.

## What actually restores a hard stop — a THIRD layer, at a different seam

**Request interception.** `playwright-core` can intercept every network request the page makes
and abort it. A checkout is not only a button: it is a **request** — a `POST` to an order
endpoint, or a navigation to a payment origin.

| | keys on | fails when |
|---|---|---|
| **L1 — button recognition** | the accessible name | the site names the button something ordinary |
| **L2 — empty profile** | browser-stored payment | the card is stored server-side |
| **L3 — request interception** | the URL and method of the outbound request | the endpoint is named ordinarily and same-origin |

**Three leaky layers with INDEPENDENT failure modes is a materially different object from one
leaky layer.** L1 fails on naming; L3 fails on routing; a site would have to defeat both, in
different vocabularies, on the same action.

**And L3 has one property the others do not:** it can be made **deny-by-default for non-GET**.
Every `POST`, `PUT`, `PATCH` and `DELETE` the page attempts is **aborted unless the sealed
order named it**. Reading is `GET`. Almost everything irreversible is not.

> ### That is the closest thing to a real hard stop available, and it is a fence made of absence — the same shape as `buildAllowedTools()` and `headless`.

**It is also the single most valuable thing in this document, and it is not what was asked
for.** The ruling asked for two layers; the honest design needs three, because the second one
does not do what it was believed to do.

---

# 2. THE PROFILE

## Where it lives

A **dedicated Chrome user-data directory**, created empty, used only by her:

```
C:\Aroma\browser-profile\        (proposed; not created)
```

**It is NOT the Owner's everyday Chrome profile.** Using his would inherit every saved card,
every autofill entry, and every other logged-in account in one step — the opposite of the
ruling. `playwright-core` opens it with `launchPersistentContext(userDataDir)`, which is a
different call from the one the six verbs use today and is part of what would be built.

## ⛔ How he logs in — once, himself, and she never sees it

1. The profile is launched **headed and empty**, with her automation **not running**.
2. **The Owner types his own credentials into the visible window.** Nothing of ours is in the
   loop; there is no field to intercept because no process of ours is driving.
3. Sessions persist to the profile directory. She inherits **cookies, never passwords**.

**And the existing fence still stands underneath:** `type` refuses `input[type=password]` and
credential-shaped names **structurally** — measured yesterday on his own login form. Even a
future errand written carelessly could not type a password.

## ⚠ Chrome's own sign-in must stay OFF

Signing **Chrome itself** into a Google account is different from signing into a website with
Google. The former **syncs Google Pay cards and autofill into the profile**, silently undoing
layer 2. The profile must have browser-level sync disabled and no browser-level Google account
— and that is part of what the probe below has to verify, not something to remember.

## The payment probe — and it must be SEEN TO FAIL

Chrome stores payment data in the profile's `Web Data` SQLite database. The probe reads it
directly and asserts empty:

| table | what it holds |
|---|---|
| `credit_cards` | locally saved cards |
| `masked_credit_cards`, `server_card_metadata` | Google Pay / server cards synced in |
| `payments_customer_data` | the linked payments account |
| `local_stored_cvc` | stored CVCs |

Plus: browser sync state off, and no autofill profile carrying a card.

> ## ⛔ THE PROBE IS THE FENCE, SO A PROBE THAT HAS NEVER FAILED IS NOT EVIDENCE.
>
> **Before it is trusted, it must be demonstrated failing.** On a **throwaway profile that is
> never the Owner's**, a dummy card is added by hand, the probe is run, and it must **report
> the card**. Then the throwaway profile is destroyed.
>
> A probe that has only ever returned 「clean」 is indistinguishable from a probe that returns
> 「clean」 unconditionally — which is `basis` with two unreachable values, `count: 43`, and the
> `stable: true` that made `REFUSAL.UNSTABLE` unreachable. **Three instances in this codebase
> already.**

**When it runs:** before every session that uses the profile, and the session **refuses to
start** if it does not come back clean. Not a warning. Not a log line.

---

# 3. LAYER 1 — RECOGNITION, AND WHAT IT CANNOT CATCH

## What it keys on

Not one signal — four, because any one alone is trivially defeated:

1. **The accessible name** of the target: `pay`, `place order`, `buy now`, `complete purchase`,
   `submit payment`, `confirm order`, `checkout`, `付款`, `下單`, `結帳`, `commander`…
2. **The page's URL path**: `/checkout`, `/payment`, `/placeorder`, `/order/confirm`.
3. **The page's own content**: does the read contain a card field, a CVV field, an order total,
   a 「by placing this order you agree」 phrase?
4. **The request the click is about to cause** — which is L3, and is the only one the site
   does not choose the wording of.

## ⛔ WHAT IT CANNOT CATCH — this is not a caveat, it is the reason L3 exists

> **Owner: 「Do not present a name list as coverage — today proved that shape.」**

- **A final purchase button named `Continue`.** Yesterday's proof: `button "Search"` was
  pressed by a run that expected to be stopped. Nothing distinguished it.
- **Icon-only buttons** with a bare or useless accessible name.
- **Localised or idiosyncratic naming** — a supplier portal saying `Envoyer`, `Bestellen`,
  `確定`, or a house term like `Release to Warehouse`.
- **Two-step flows where the irreversible act was the PREVIOUS page** — the button that
  committed the order was the one before the one saying 「Confirm」.
- **Deliberate renaming**, which any site may do at any time without telling anyone.

## And the honest statement about its rate

**We do not know it, and we cannot know it in advance.** Anything else would be exactly the
premise-without-measurement that cost this project two rounds this week.

> ### It should be MEASURED before it is relied on: a frozen corpus of real checkout pages, captured HEADED, read but never submitted, scored on 「would L1 have stopped this?」
>
> That is buildable without spending a cent or placing an order — reaching a checkout page is a
> `GET`. **Until that measurement exists, L1's coverage is unknown and should be described that
> way in every report.**

---

# 4. GOVERNMENT SUBMISSIONS — a different problem, and it has a better answer

**The Owner is right that there is no 「no payment method」 equivalent for a CRA form.** An
empty profile does nothing; a filing is not a transaction.

**But there is something better, and it already exists and is already proven.**

> ## Government origins are NEVER in a sealed order — and a hard denylist overrides any order that names one.

The sealed order is an **allowlist**, and `navigate` and `click` both refuse an origin the
order did not name. Measured yesterday: **`ORIGIN_NOT_IN_ORDER` in 0 ms.** If `canada.ca`,
`cra-arc.gc.ca`, `gov.mb.ca` and the rest are never named, **she cannot reach them at all** —
not the form, not the page, not the login.

**That is complete, not partial**, and it is a stronger guarantee than anything available for
payment, because a government filing has no equivalent of 「the card is stored on the
merchant's server」.

## ⚠ And this is the one place a DENYLIST earns its keep

This project's rule is *allowlist, never denylist* — an allowlist requires someone to have
intended the good case. **The denylist here is not a replacement for it; it is an override on
top of it**, and it defends against a different threat:

| | protects against |
|---|---|
| the allowlist | an origin **nobody named** |
| the government denylist | an origin **someone named by mistake** — a future order author, including a future me, adding `canada.ca` to an allowlist for a good reason |

**It must be un-overridable by an order.** Not a default that an order can turn off — a check
that runs after the allowlist and refuses regardless.

**What it costs:** she cannot read public government pages either — CFIA recalls, Health
Canada, provincial food safety. **ERRAND-003, the one errand that worked, would be blocked.**

> ### So the denylist must be scoped to SUBMISSION SURFACES, not to government as a whole:
> authenticated portals (`cra-arc.gc.ca`, My Business Account, provincial filing systems),
> **not** public information sites. And that boundary must be written as an explicit list of
> what is blocked, reviewed by the Owner, rather than a pattern like `*.gc.ca` that quietly
> takes the recall register with it.

---

# 5. WHAT THE REPORT SAYS WHEN IT STOPS

**This is the moment the Owner acts on, so it is written for a phone screen, not a log
viewer.** He must be able to finish the job from the report alone.

```
⏸ 停咗 —— 準備好落單,冇撳。

  邊度    Costco.ca › 購物車 › 結帳
  用邊個  louie@aromabistro741.com（你嘅帳戶）
  金額    $284.61（讀到,未確認）

  我做咗                    我冇撳
  ─────────────────────    ──────────────────────────
  加入 6 件貨(見下)         button "Place Your Order"
  配送:Winnipeg 門市取貨     ← 呢個就係你要撳嘅
  填咗數量,冇改價錢

  你要做:去嗰版,核對金額,撳 "Place Your Order"。
  我停低嘅原因:呢粒掣叫 "Place Your Order" —— 認得出係最後一步。
```

**Five things it must always carry:**

1. **What she filled** — field names and shapes, **never values** (the record is built without
   them from the start, not stripped afterwards).
2. **What she did not press** — the exact element: role, accessible name, and ref.
3. **Where to go** to finish it — URL and account.
4. **The amount, marked as READ, not verified** — she read a number off a page; she did not
   confirm it is the number that will be charged.
5. **Which layer stopped her, by name** — L1-recognition, L3-request, or a plain refusal. He
   needs to know whether the system recognised the step or merely blocked a request, because
   those two mean different things about how close it came.

---

# 6. ⛔ WHAT THIS DOES NOT PROTECT AGAINST

**Explicit, because the Owner asked for the residual rather than the reassurance.**

## 6.1 Reading is unrestricted, and reading is most of the risk

**Her session can read everything his accounts can read.** Order history, addresses, saved card
last-4, supplier pricing, invoices, HR records if the account reaches them, private messages.

> **No layer here touches reading.** L1 and L3 are about *acts*; L2 is about *payment*. A
> logged-in browser is a full-privilege reader from the first second, and the audit records
> that **faithfully, after the fact**. **An audit is a record, not a fence.**

## 6.2 The irreversible things that are NEITHER payment NOR filing

The two layers were designed around two named dangers. **These are covered by neither:**

- **cancelling or modifying an existing order** — no payment, fully irreversible;
- **changing a delivery address or account setting** on his account;
- **sending a message** to a supplier from his identity;
- **accepting terms** or a new agreement;
- **deleting** anything.

**A denylist of button names does not reach these, and there is no 「no payment method」 for
them.** L3's deny-non-GET-by-default is the only thing that touches this class at all — which
is another argument for it being the load-bearing layer rather than the third one.

## 6.3 The profile directory IS a credential

Once he logs in, `C:\Aroma\browser-profile\` holds **live session cookies for his accounts**.
Anything with file access to that directory has his accounts, without a password, without 2FA.

> **We would be creating a new credential-equivalent artifact on this machine, and it is not
> covered by 「she never sees passwords」.** It needs the same seriousness as a key file:
> restricted ACL, never in a repo, never in a backup that leaves the machine, and named in the
> record so nobody later treats it as a cache.

## 6.4 A page can try to instruct her while she is wearing his identity

She reads page content as input. A page can contain text addressed to an automated reader.
**Combined with a logged-in session, that is the highest-consequence version of this risk that
has existed in this project** — previously she read public pages as nobody.

The existing mitigation is real but partial: instructions in page content are **data**, the
sealed order is fixed before the run, and the origin allowlist means an injected 「go here and
do this」 cannot leave the named origins. **It does not stop an injected instruction to act
*within* an allowed origin.**

## 6.5 Layer 1's coverage is unmeasured

Stated again because it belongs in the residual list: **we do not know what fraction of real
checkout buttons L1 recognises.** Until the corpus in §3 exists, every report that says 「I
stopped before the last step」 is describing what happened, **not evidence that it always
would.**

---

# 7. WHAT I RECOMMEND — and where it differs from the ruling

| | the ruling | this design |
|---|---|---|
| L1 soft stop | ✅ as described | ✅ agreed, with its coverage described as unknown until measured |
| L2 empty profile | 「cannot pay」 becomes structural | ⚠ **it does not** — it removes autofill only. Real, worth doing, **not the guarantee it was believed to be** |
| **L3 request interception** | not in the ruling | ⛔ **needed**, and it is the load-bearing layer: deny non-GET by default |
| government | 「same two layers?」 | **neither** — an un-overridable origin denylist, scoped to submission surfaces, reviewed by the Owner as an explicit list |

**Sequence I would propose, if approved:**

1. Measure L1 on a frozen corpus of real checkout pages — **costs nothing, places no order**,
   and tells us whether L1 is worth 90% or 40%.
2. Build the payment probe **and demonstrate it failing** on a throwaway profile.
3. Build L3 first, not last.
4. Only then create the real profile and have the Owner log in once.

**Nothing above is built. No profile exists. No credential has been touched.**
