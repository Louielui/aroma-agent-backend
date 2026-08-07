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

---
---

# ⛔ THE HEADLINE — Owner's instruction, 2026-08-06

> # 「空 profile 剷走嘅係自動填表，剷唔走你張卡喺 Costco 個資料庫入面。」

**Owner: 「Your correction is right and I would have shipped my version.」**

That sentence is the headline of this design and belongs above everything else in it. The
ruling arrived believing an empty profile made payment impossible. **It makes autofill
impossible.** Every retailer the Owner uses keeps the card on its own account record, so a
logged-in one-click purchase is unaffected by anything in the browser profile.

**L3 — request interception, deny non-GET by default — is the load-bearing layer.** L2 is real
and worth doing and is not the guarantee it was believed to be.

# BUILD ORDER — approved as proposed, not as ruled

1. **Measure L1 free, placing no orders**  ← this round
2. **The payment probe, proven to fail** on a throwaway profile with a fake card
3. **L3, before anything else is built**
4. **The real profile last**, and the Owner logs in once

# GOVERNMENT — approved, with the explicit list kept

An origin that appears in no sealed order is **unreachable at 0 ms**, and that is **complete
rather than partial**. The block stays an **explicit reviewed list of submission surfaces** —
**a `*.gc.ca` pattern would kill the CFIA recall check, which is the only errand that has ever
worked.**

---

# RESIDUAL RISKS — three Owner decisions, recorded as decisions

## 1. Unlimited reading — **ACCEPTED, not pending**

> **Owner: 「Reading is unlimited and I accept that knowingly. Record it as accepted, not as
> pending.」**

Her session can read everything his accounts can read: order history, addresses, card last-4,
supplier pricing, invoices, HR records within reach of the account. **No layer touches this and
none is planned.** The audit records reads faithfully **after the fact** — a record, not a
fence.

**This is a closed decision. It is not an open item, not a TODO, and not something a later
round should re-raise as though it were an oversight.**

## 2. The profile folder is a credential — **treated as one from day one**

> **Owner: 「Treat it as one from day one — ACL, out of the repo, out of offsite backup, and
> written down so nobody later reads it as a cache.」**

`C:\Aroma\browser-profile\` will hold **live session cookies for the Owner's accounts**.
Anything with file access to it has those accounts — **no password, no 2FA**.

| requirement | from day one, not after the first scare |
|---|---|
| **ACL** | restricted to the account that runs her; not world-readable |
| **repository** | **never** — `.gitignore`d before the directory exists |
| **offsite backup** | **excluded** — it must not reach Backblaze B2 or any copy that leaves the machine |
| **the record** | written down as a credential-equivalent artifact, **so nobody later reads it as a cache and deletes, copies or syncs it casually** |

**It is a new credential-equivalent artifact on this machine**, and 「she never sees passwords」
does not cover it.

## 3. ⚠ Prompt injection while wearing the Owner's identity — **the largest, and NOT solved this round**

> **Owner: 「the one I had not thought about and it is the largest. Do not solve it in this
> round, but state plainly in the record what changed.」**

### WHAT CHANGED, stated plainly

> ## Until now she read public pages **as nobody**. After this she reads them **as the Owner**.
>
> The same injected instruction that previously could achieve nothing can now be attempted
> **with his accounts, his order history, and his ability to act already loaded.**

What stands against it today is real but partial:

- page content is **data, never instruction** — the standing rule;
- the **sealed order is fixed before the run**, so an injected 「go here」 cannot add an origin;
- the **origin allowlist** measured refusing in 0 ms;
- **L3's deny-non-GET** would refuse an injected act that requires a write.

**What none of them stops:** an injected instruction to do something *within an already-allowed
origin, using an already-allowed method.*

> ### ⛔ ANY FUTURE DESIGN THAT WIDENS THE ALLOWLIST HAS TO ANSWER TO THIS.
>
> Widening the allowlist was previously a convenience question. **It is now a
> prompt-injection-surface question**, and this paragraph is where a future round has to come
> and argue.

---
---

# 8. WHERE HE SEES IT — **首頁, not a new surface**

> **Owner: 「This is 首頁 from the IA — 『what needs my decision』 is exactly what a stopped
> checkout is. Do not invent a new surface for it.」**

`PRODUCT-IA.md` §首頁: *the COO morning briefing — what needs him today, in the fewest words
that are true*, already carrying the waiting-invoices line with its five states, its
looked-at time, and its caveat. **A stopped checkout is another line of exactly that shape.**

## The three things it shows

### a. What she ran

```
今日  3 單差事
  ✅ 回收檢查(蘑菇/雞/芝士)     09:12   答到
  ⏸ Costco 落單 —— 紙巾 ×6      11:40   停低,等你
  ⛔ 供應商入口                  14:03   俾網站擋咗
```

Three outcomes, **never merged**: **答到 / 停低等你 / 擋咗**. The same discipline as the
invoice line's five states — 「stopped for you」 and 「blocked by the site」 are different facts
and must never collapse into 「didn't work」.

### b. What is waiting, with the stop report INLINE

**Not a link to a report. The report.** He decides from 首頁 or he does not decide.

```
⏸ 等你 —— Costco 落單,準備好,冇撳
   我做咗              6 件貨落車 · Winnipeg 門市取貨
   我冇撳              button "Place Your Order"
   金額                $284.61   ← 11:40 讀到,冇核實
   點解停              L1 認得出粒掣個名
   [ 開返嗰版 ]
```

The five required fields from §5, unchanged: **filled (names and shapes, never values) ·
not-pressed (role, name, ref) · amount marked READ-not-verified · which layer · where to go.**

### c. The link — **and this is the part that needs care**

---

# 9. THE LINK — a cart lives in the session that built it

> **Owner: 「a link opened in my daily Chrome will show an empty cart — we measured that on
> Costco.」**

Correct, and it is the same fact from a different direction: **the cart is server-side, tied to
the session cookie in HER profile.** His daily Chrome is a different session and sees a
different cart, or none.

## So the link cannot be an `<a href>`

**首頁 is served by her own backend on `127.0.0.1:8090`.** The button is a **POST to a local
endpoint**, which launches Chrome **against her profile directory** at that URL:

```
POST /api/v1/errand/:id/open      →  chrome --user-data-dir=C:\Aroma\browser-profile <url>
```

A local surface can start a local process. **A hosted page could not do this, and that is a
reason the briefing stays local rather than a limitation to route around.**

## ⚠ WHAT HAPPENS IF THE PROFILE IS BUSY — the case that needs an answer, not a hope

A Chrome user-data-dir is **single-instance**: it holds a `SingletonLock`. Three states, and
each needs a defined behaviour:

| state | what the button must do |
|---|---|
| **profile idle** | launch it headed at the URL. The normal case |
| **she is mid-errand in it** | ⛔ **refuse, and say so** — 「香香而家用緊個 profile。停佢先?」 with a stop control. **Never launch a second Chrome on the same dir and hope** |
| **stale lock** (a crashed run left the lock behind) | detect and report it as its own state — **never delete a lock file automatically**, because 「clear the lock and carry on」 is how two Chromes end up writing one profile |

> ### ⚠ UNVERIFIED, AND IT MUST BE MEASURED BEFORE IT IS BUILT.
>
> Whether a second `chrome --user-data-dir` on a live Playwright persistent context **attaches
> a tab** or **fails** is behaviour I have not measured. **I am not going to assert it.** It is
> a fifteen-minute probe with the throwaway profile from step 2 and it belongs in that step.

## ⛔ AND THE THING THIS SURFACES THAT NOBODY HAS SAID YET

**When he finishes the payment in her profile, he is typing his card into her profile.**

> ### That is the most likely way L2 gets silently undone — not by us, by him, on the first purchase.

Chrome will offer to save the card. If it saves, **the profile now holds a payment method**,
and 「cannot autofill」 quietly stops being true.

Two requirements follow, and neither is optional:

1. **Card saving must be OFF in that profile by construction** — the preference set when the
   profile is created, not a habit of declining a prompt at 11pm.
2. **The payment probe runs before every session and refuses to start if it finds one** — which
   already exists in §2. **It would catch this**, and the report must say *why* it refused in
   words that point at the purchase he made, not at a database table.

**If the merchant holds the card server-side, none of this arises** — he clicks and pays. **The
hazard is exactly the sites where L2 was doing something.**

---

# 10. DOES A STOPPED ERRAND EXPIRE? — **yes, and the answer is about the AMOUNT, not the link**

> **Owner: 「A cart from three days ago may be priced differently or partly out of stock.」**

**What goes stale is not the page — it is the number she read.** The page is live and correct
whenever he opens it; the `$284.61` on the card is a reading from a moment that has passed.

| age | 首頁 shows |
|---|---|
| **< 2 h** | the amount plainly. `11:40 讀到` |
| **2–24 h** | the amount **struck through**, with 「呢個價我 X 個鐘之前讀,可能唔同咗」 |
| **> 24 h** | **no amount at all** — 「太耐,個價同存貨都要重新睇。建議我重新行一次,唔好接住做。」 |

## Should it refuse to link past some point? — **No, and this is a deliberate ruling**

**The link stays available at every age.** Opening a page is a `GET`; it commits nothing, and
he may well want to look.

> ### What expires is the CLAIM, not the ACCESS.
>
> Refusing the link would be the system deciding he may not look at his own cart. **Removing
> the amount is refusing to keep asserting something we can no longer support** — which is
> HR-5, 「absent stays absent」, applied to a number that has aged out of being true.

**And past 24 h the card recommends re-running rather than resuming**, because 「partly out of
stock」 is not visible from a stale reading and only a fresh errand would find it.

---

# 11. WHAT IT SHOWS WHEN NOTHING IS WAITING

> **Owner: 「Same ruling as the Drive line: never blank, and it says when it last looked.」**

```
✅ 冇嘢等你決定。
   啱啱睇過 · 14:52
   今日行過 2 單:回收檢查(答到)· 供應商入口(俾網站擋咗)
```

**Three requirements, taken directly from the invoice line that already works:**

1. **Never blank.** A blank space is indistinguishable from a broken feature. **Silence is only
   permitted when the feature is off**, and then it says so.
2. **It names when it last looked.** 「冇嘢等你」 is a claim with a timestamp or it is not a
   claim — the same reason the Drive line says 「幾點睇過」.
3. **A failed check is NOT 「nothing waiting」.** If the errand store cannot be read, the line
   says **「我睇唔到差事紀錄」**, never 「冇嘢等你」. **The two look identical to a tired reader
   and mean opposite things**, which is the whole shape of `count: 43`.

---

# 12. BUILD ORDER — unchanged, this goes LAST

**This surface is not built ahead of the L1 measurement, and not ahead of the three layers.**

1. ~~Measure L1~~ ← **done: 100% fitted, 45% held-out**
2. The payment probe, proven to fail — **and the profile-lock probe from §9 joins this step**
3. L3
4. The real profile
5. **首頁's stopped-errand line, last** — it displays what the layers produce, so it has nothing
   true to display until they exist.
