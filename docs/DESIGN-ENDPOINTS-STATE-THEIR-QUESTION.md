# Make every endpoint state the question it answers

<!-- record-status: ACTIVE 2026-08-05 -->

**DESIGN ONLY. No edit authorised. `aroma-system` is production and was not touched.**
2026-08-05, directly out of `DEFECT-001` being disproven.

> **Owner:** 「That naming gap is what cost us two days, and it is live in 香香 today — she
> reads both and cannot tell me whether a number counts stock already on order. The restock
> list cannot be honest until this is.」

---

# 1. What each response should declare

## The shape — additive, top-level, beside `count`

```jsonc
{
  "success": true,
  "count": 43,
  "answers": {
    "id": "below_par_after_inbound",          // stable, machine-comparable
    "question": "Which active, purchasable ingredients are still below par once stock already on open purchase orders arrives?",
    "includes": ["stock on open purchase orders"],
    "excludes": [],
    "window": null,                            // or { field, days, note }
    "limit": 100,
    "truncated": false                         // rows.length === limit
  },
  "data": [ /* unchanged */ ]
}
```

And its opposite number:

```jsonc
// GET /api/v1/ai/inventory
"answers": {
  "id": "master_stock_and_par",
  "question": "What stock and par level is recorded for each active ingredient?",
  "includes": [],
  "excludes": ["stock on open purchase orders"],
  "window": null, "limit": null, "truncated": false
}
```

## Why each part exists

| part | why it is not a comment |
|---|---|
| **`id`** | a **stable token**, so a consumer can compare two responses *without parsing prose*. This is the whole difference between a field and documentation. |
| **`question`** | the human sentence, for anything that renders to a person. |
| **`includes` / `excludes`** | the **checkable claims**. 「stock on open purchase orders」 is the single line that would have ended the two-day chase in ten minutes. |
| **`window`** | names the date field and the span. Four endpoints have one and none says so. |
| **`limit` / `truncated`** | `truncated` is computed (`rows.length === limit`), not a note. Today a cap and a count are indistinguishable — see `/daily-counts` below, where the cap was read as a fact **in this project's own measurement**. |

## Wording rule

> **State the EXCLUSION, not only the inclusion.**

「below par」 is not wrong. 「below par, ignoring stock already on order」 is *complete*. **The
exclusion is the part nobody thinks to ask about**, and it is exactly what was missing.

## ⚠ THE PART WITHOUT WHICH THIS IS DECORATION

> **The `id` must change whenever the predicate changes — and a test must enforce it.**

A disclosure that can silently go out of date is worse than none: it reads as a guarantee
while being false. That is `basis` all over again, and it is HR-12's lesson.

**Concretely:** one test per endpoint pinning `answers.id` to the actual `WHERE` semantics —
e.g. for `below_par_after_inbound`, seed one ingredient below par with a covering open PO and
assert it is **absent**. Change the query without changing the id and that test fails. The
test is the mechanism; the field alone is a promise.

---

# 2. Is renaming worth the breakage? — NO, and the premise needs one correction

> **Owner: 「『inventory』 answering 『below par ignoring inbound』 is less defensible.」**

**`/ai/inventory` does not answer that question — it never computes below-par at all.** It
returns the master: `id, name, unit, currentStock, parLevel, isPurchasable, lifecycleStatus,
category, subCategory`, filtered to `is_active`, no limit, and `count: 199` is honest.

**The 61 was a derivation performed by the consumer — by me, in JavaScript.** The endpoint
was never asked the question it appeared to answer wrongly.

So the naming problem is **one level below the route**:

> ### It is not the endpoint that is misnamed. It is `currentStock` — a stock number with no statement of what it counts.

| | verdict |
|---|---|
| `/ai/order-planning` | name is **correct**; accounting for inbound is what order planning is for |
| `/ai/inventory` | name is **correct**; it returns inventory records |
| `currentStock`, `live_qty`, `projected_qty` | **these** are what need the disclosure |

**Verdict: disclosure, not renaming.** And the test that settles it — a rename **would not
have prevented this chase**, because the two names were never the thing that misled anyone.
Renaming would break every consumer to fix a problem the routes do not have.

---

# 3. What 香香's read layer does with it

## It does not fit `SCOPE_OF`, and should not be stuffed into `note`

`SCOPE_OF[endpoint] = { hasLocation, hasAsOf, note }` describes **what dimensions the data
has**. `answers` describes **what question the row set answers**. Different axis. And `note`
is free prose — the same weakness as a code comment, one layer over.

**Proposal: a new declared table beside the others in `aromaSystemRead.js`:**

```js
const QUESTION_OF = Object.freeze({
  inventory:     { id: 'master_stock_and_par',    text: '…', excludes: ['已落單未到貨'] },
  orderPlanning: { id: 'below_par_after_inbound', text: '…', includes: ['已落單未到貨'] },
  // …
})
```

**Sequencing matters:** the API change is production and will not land first. So 香香 carries
her **own** declaration now, and prefers the server's `answers` block when it starts arriving.
**When both exist and disagree, that disagreement is itself worth surfacing** — it means one
side changed and the other did not.

## The capability this actually unlocks

> ## She can notice that she is holding two numbers answering different questions, and say so unprompted.

Today she cannot. Nothing tells her, which is precisely why 61 vs 43 looked like a defect.

### What she would say differently on a restock question

**Today** — one number presented as the answer, or both presented with the reconciliation left
to the Owner:

> 「Order Planning 有 43 項要補。」

**After** — the same read, with the difference named:

> 「Order Planning 話要補 **43 項** —— 已計埋落咗單、未到貨嗰啲。
> Stock 話有 **61 項**低於安全存量 —— 呢個數**唔計**在途。
> 差嗰 **18 項**已經落咗單。**兩個數都啱,答緊唔同問題。**」

That paragraph is the entire two-day investigation, delivered in three lines at read time.

### A second gain, and a live inaccuracy it fixes

`/ai/daily-counts` returns `count: 50` — **which is the `LIMIT`, not a total.** 香香's
`describe()` copies `body.count` into `totalCount`, so **she would tell the Owner 「共 50 份盤
點」 today, and that is false.** With `truncated`, she says instead:

> 「至少 50 份 —— 呢個係上限,實際數目未知。」

Which is the fourth read state (「讀到 N 項,但…」) applied to caps rather than to periods.

---

# 4. What else answers a question it does not name — ALL SIX DO

Read end to end, 2026-08-05. **Two are worse than the one that cost two days.**

| endpoint | undisclosed narrowing | severity |
|---|---|---|
| `/inventory` | `is_active=1`; **`currentStock` excludes inbound** | the pair that started this |
| `/order-planning` | `LIMIT 100`; **`projected_qty` includes inbound** | the other half |
| **`/daily-counts`** | **7-day window + `LIMIT 50`, neither disclosed** | ⚠ **and it was already misread — see below** |
| **`/purchase-orders`** | **30-day window on `createdAt`, `LIMIT 100`** | ⚠ **window on the wrong date field** |
| **`/invoices`** | **30-day window on `createdAt`, `LIMIT 100`** | ⚠ **same** |
| `/suppliers` | `status='active'`, no limit | mild — the name implies it |

## ⚠ 4a. `/daily-counts` was already misread, in this project's own measurement

The 2026-08-05 measurement recorded **「count: 50」** as a fact about how many stock-takes
exist. It is the `LIMIT`. The set was **silently truncated**, and the number was reported as
though it counted something.

**Same class as `count: 43`, found in my own work, one day later.** The eight submissions
quoted from it were real; the 50 was never a count of anything.

## ⚠ 4b. `/invoices` and `/purchase-orders` window on the ENTRY date, not the business date

```ts
.where(sql`${localInvoices.createdAt} >= ${thirtyDaysAgo}`)   // ← when it was ENTERED
```

The rows carry `invoiceDate` / `orderDate` — the dates a human means. So these endpoints
answer **「invoices entered in the last 30 days」** while every consumer reads
**「invoices from the last 30 days」**.

**And 香香 makes the mismatch invisible.** Her `DATE_FIELDS` deliberately prefers the business
date for citation — `invoiceDate` before `createdAt`, with a comment explaining why. So she
**cites an invoice date while the row set was chosen by an entry date.** An invoice dated in
March, scanned in yesterday, appears in an answer about the last 30 days, correctly labelled
March, with nothing anywhere saying why it is there.

**This is worse than `DEFECT-001`**, which was at least internally consistent. Here the
selection and the citation use different dates *by design on both sides*.

Whether the window should move to the business date is a **product decision** — 「what arrived
recently」 and 「what is dated recently」 are both legitimate questions. **What is not
legitimate is not saying which.**

## Recommended order

1. `/inventory` + `/order-planning` — the pair the restock list depends on
2. `/invoices` + `/purchase-orders` — the wrong-date-field windows, and the product decision they force
3. `/daily-counts` — the undisclosed cap
4. `/suppliers` — trivial, do it while passing

**None of it is authorised. Nothing was edited.**
