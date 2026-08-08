# DEFECT-009 — 「1 invoice」 is a 30-day window reported as the complete set

> **Owner: 「one row against 471 is not a performance question, it is either a filter I do not
> know about or data that is not reaching the API. If I have been reading 「1 invoice」 as the real
> count anywhere, that is a wrong number I have been acting on.」**

**It is a filter he did not know about.** Diagnosed read-only from the aroma-system source on
2026-08-08. **Nothing was changed, in either repo.** Same discipline as DEFECT-001: production,
different repo, diagnosis only.

## THE ANSWER

`aroma-system/server/routes/aiIntegration.ts`, `GET /api/v1/ai/invoices`:

```ts
const thirtyDaysAgo = new Date()
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
...
.where(sql`${localInvoices.createdAt} >= ${thirtyDaysAgo.toISOString()}`)
.orderBy(desc(localInvoices.createdAt))
.limit(100)
```

**「1 invoice」 means 「one invoice ROW WAS INSERTED in the last 30 days」.** It does not mean one
invoice exists. `CLAUDE.md` records ~471.

Note also WHICH date it filters on: `createdAt`, the row's insert timestamp — not `invoiceDate`,
the business date. An invoice dated last week but scanned in two months ago is outside the
window; one dated last year but scanned yesterday is inside it. The reader beside it already
knows this distinction and states it in `DATE_FIELDS`:

> 「The BUSINESS date wins over the row's insert timestamp: an invoice dated the 28th that was
> scanned into the system on the 3rd is an invoice from the 28th」

The server filters on the one the reader calls wrong.

## THE FULL CHAIN — every step does what it says

The word 「count」 changes meaning between steps 2 and 3.

| # | where | what happens |
|---|---|---|
| 1 | `aiIntegration.ts` | filters to 30 days on `createdAt`, caps at 100 |
| 2 | same | returns `{ success, count: data.length, data }` — `count` is the FILTERED count |
| 3 | `aromaSystemRead.js:385` | `totalCount = body.count`, under a comment reading **「THE REAL TOTAL, from the API's own header」** |
| 4 | `aromaSystemRead.js:304` | `completeness: isSample ? 'sample' : 'complete'`, `isSample = totalCount > kept.length` → **1 > 1 is false → 'complete'** |
| 5 | `readContext.js` SCOPE | 「how much of each source exists… take the number from these lines」 |
| 6 | her reply | 「1 張發票」, presented as the whole set |

**Step 3 is an M-8 structural claim in a comment, and it is false.** The API's header carries the
count of a filtered page; the comment asserts a property the value does not have. It was written
to fix a real defect (「4 of 199 became 4 項存貨」) and it fixed that one. It is wrong about this one.

**Step 4 is what makes it dangerous rather than merely wrong.** The window shrank the total to
match the page, so the sample test cannot fire:

> **The single most aggressively filtered endpoint is the only one presented as complete.**
> Inventory returns 199, keeps 25, correctly flagged `sample`. Invoices returns 1 of ~471,
> flagged `complete`. A cap larger than the filtered set turns the truncation warning off —
> the louder the filter, the quieter the warning.

## SAME SHAPE ELSEWHERE

- `/purchase-orders` — same 30-day `createdAt` window, cap 100, returned 14, flagged complete by
  the same arithmetic. 14 purchase orders CREATED in 30 days.
- `/daily-counts` — 7-day window on `submittedAt` (the business date, correctly), cap 50, and it
  returned **exactly 50**. Landing on the cap is indistinguishable from being truncated by it.
- `/inventory`, `/suppliers`, `/order-planning` — no window, no cap. Their totals are real.

## WHAT IS NOT KNOWN

- Whether the 30-day window is deliberate (a recency policy) or incidental. No comment either way.
- Whether ~471 is current — that figure is from `CLAUDE.md`, not measured today.
- **Nothing was queried against the invoice table directly.** The evidence is the route source
  and the six-shape probe, nothing else.

## NOT FIXED — and a fix is a choice between three, not one change

1. **Report the true total beside the page** — `{ count, totalAvailable }`. Step 4's sample test
   starts working again and she says 「1 of 471 shown」.
2. **Honour `?limit`/`?from`/`?to`** (DEFECT-007) so the window is the caller's, not a constant.
3. **Filter on `invoiceDate` rather than `createdAt`** — a behaviour change affecting any other
   caller.

**(1) is the one that stops a wrong number being acted on**, and the only one that changes no
existing caller's results.

## THE ONE-LINE VERSION

> He asked whether 「1 invoice」 was a filter or missing data. It is a filter — and the reason it
> arrived as a fact rather than as a sample is that the filter was tight enough to make the
> truncation check pass.
