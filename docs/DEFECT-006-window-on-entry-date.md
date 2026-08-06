# DEFECT-006 — invoices and POs are windowed by ENTRY date and cited by DOCUMENT date

<!-- record-status: ACTIVE 2026-08-05 -->

**Repo: `aroma-system` (production). Recorded, NOT fixed.**
**Found 2026-08-05 while designing endpoint disclosure.**
**Severity: an answer that is internally inconsistent and looks correct.**

> **Owner:** 「An endpoint filtering on `createdAt` while returning `invoiceDate`, with 香香
> preferentially quoting the document date, produces an answer that is internally
> inconsistent and looks correct. **I would have trusted it.**」

---

## One line

**`/ai/invoices` and `/ai/purchase-orders` answer 「entered in the last 30 days」 while every
consumer reads 「from the last 30 days」 — and 香香 then cites the document date, so the
selection and the citation use different dates by design on both sides.**

## Measured

`server/routes/aiIntegration.ts`:

```ts
// /ai/invoices
.where(sql`${localInvoices.createdAt} >= ${thirtyDaysAgo.toISOString()}`)
.orderBy(desc(localInvoices.createdAt)).limit(100)
// …but the row carries invoiceDate, subtotal, tax, total, supplierId

// /ai/purchase-orders
.where(sql`${purchaseOrders.createdAt} >= ${thirtyDaysAgo.toISOString()}`)
.orderBy(desc(purchaseOrders.createdAt)).limit(100)
// …but the row carries orderDate
```

**Neither the window nor the cap appears anywhere in the response.**

## Why this is worse than `DEFECT-001`, which was at least self-consistent

`aromaSystemRead.js` (香香) deliberately prefers the **business** date when citing a row, with
the reasoning written into the file:

> 「ORDER IS MEANING here too. The BUSINESS date wins over the row's insert timestamp: an
> invoice dated the 28th that was scanned into the system on the 3rd is an invoice from the
> 28th, and citing the 3rd would date the Owner's own record to when we happened to read it.」

**That reasoning is correct. It is also what completes the trap.** An invoice dated in March,
entered yesterday, appears in an answer about the last 30 days, is labelled **March**, and
nothing anywhere explains why it is present.

Each half is defensible on its own:

| | choice | defensible? |
|---|---|---|
| aroma-system | window on entry date | yes — 「what arrived recently」 is a real question |
| 香香 | cite the document date | yes — and the file argues it well |
| **together** | **select by one date, label by another** | **no** |

**Neither side can see the other's choice**, which is exactly what the `answers` disclosure
design exists to fix.

## Measured spread — and why the measurement CANNOT answer the question

Read-only, 2026-08-05, from the API:

| | rows | `createdAt − documentDate` |
|---|---|---|
| `/ai/invoices` | **1** | 3 days |
| `/ai/purchase-orders` | **13** | **0 days on all 13** (100% same-day) |

> ### ⚠ THE SAMPLE CANNOT ANSWER THIS, BY CONSTRUCTION — HR-12.
> **Both endpoints filter on `createdAt >= 30 days ago`, which is the very variable being
> measured.** Only documents *entered* recently can appear. A backfill entered 60 days ago is
> invisible here no matter what its document date says.
>
> **This is the same shape as the `43 returned rows` error. It is named here rather than
> discovered later.**

Also informative in its own right: **1 invoice entered in 30 days**, against roughly 471 in
the system. The invoice pipeline is close to idle, so「current operations look prompt」rests
on a single row.

### The query that WOULD answer it — read-only, whole table, VPS

Table names inferred from the Drizzle identifiers (`localInvoices`, `purchaseOrders`) and
**not verified against the live schema** — adjust if they differ (HR-11).

```sql
SELECT COUNT(*) AS n,
       SUM(invoice_date IS NULL)                              AS no_doc_date,
       MIN(DATEDIFF(created_at, invoice_date))                AS min_days,
       ROUND(AVG(DATEDIFF(created_at, invoice_date)), 1)      AS mean_days,
       MAX(DATEDIFF(created_at, invoice_date))                AS max_days,
       SUM(DATEDIFF(created_at, invoice_date) < 0)            AS negative,
       SUM(DATEDIFF(created_at, invoice_date) = 0)            AS same_day,
       SUM(DATEDIFF(created_at, invoice_date) BETWEEN 1 AND 7)   AS d1_7,
       SUM(DATEDIFF(created_at, invoice_date) BETWEEN 8 AND 30)  AS d8_30,
       SUM(DATEDIFF(created_at, invoice_date) > 30)              AS over_30
FROM local_invoices;
```

…and the same against `purchase_orders` with `order_date`.

**How to read it:** `over_30` is the number the product decision turns on. Those are documents
a **document-date** window of 30 days would exclude and an **entry-date** window includes.
`negative > 0` would mean documents dated after they were entered — a separate data problem.

## The product decision this forces — the Owner's, not a code fix

「What arrived recently」 and 「what is dated recently」 are **both legitimate questions**.

- **Mostly same-day** → the misconfiguration is **latent**; disclosure alone is enough.
- **Routinely weeks** → 「最近 30 日嘅發票」 has been wrong every time anyone asked, and the
  window should key off the document date.

**What is not legitimate either way is not saying which.** The disclosure
(`DESIGN-ENDPOINTS-STATE-THEIR-QUESTION.md`) is required regardless of how the window
question is decided.

## Not fixed

Production, different repo, no authorisation. Nothing was edited.
