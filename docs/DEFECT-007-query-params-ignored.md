# DEFECT-007 — every query parameter the adapter sends is ignored server-side

<!-- record-status: ACTIVE 2026-08-06 -->

**Repo: `aroma-system` (production). Recorded, NOT fixed.**
**Found 2026-08-06, INCIDENTALLY, while answering a question about `totalCount`.**

---

## One line

**None of the six `GET` handlers in `server/routes/aiIntegration.ts` reads `req.query` at
all**, so every value 香香's adapter forwards through `ALLOWED_QUERY` — `limit`, `q`, `from`,
`to`, `status`, `supplierId` — is silently discarded by the server.

## Why this is bigger than the note already on file

`aromaSystemRead.js` carries this comment:

> *「The API ignores `limit`, so the whole table arrives and something must choose.」*

**That note is true and it is one sixth of the truth.** It named one parameter, and the
adapter has been sending six. `limit` was noticed because its effect was visible — 199 rows
arriving when 25 were asked for. The other five fail invisibly: a `q` that filters nothing
still returns rows, so nothing looks wrong.

| parameter | sent by the adapter | read by the server |
|---|---|---|
| `limit` | yes | **no** — already noted |
| `q` | yes | **no** |
| `from` / `to` | yes | **no** |
| `status` | yes | **no** |
| `supplierId` | yes | **no** |

## What it costs today

Nothing visibly, which is the problem. The adapter's `ALLOWED_QUERY` list reads as a
capability — a caller may reasonably build a narrower query believing it will be applied, and
receive a wider answer that looks like a correct one. **The parameters are a promise the
server never agreed to.**

## Suggested direction — NOT APPLIED

Either honour them or stop sending them. **Sending a parameter that is ignored is the worse
of the two**, because it makes the client's intent invisible in the result.

If they are honoured, note that `limit` interacts with `DEFECT-001`'s neighbourhood: a
server-side `limit` must be reported alongside a total, or it recreates the `count: 43`
problem at the caller's request rather than the server's default.

## How to verify

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://system.aromabistro741.com/api/v1/ai/inventory?limit=5" | head -c 200
```

Today that returns 199 rows.

---

# CONFIRMED FROM THE SERVER SIDE — 2026-08-08

> **Owner: 「record it beside the earlier note that said 「the API ignores limit」. That note said
> one parameter; the probe now shows the cost is every read pulling the whole table across the
> network.」**

Read-only inspection of `aroma-system/server/routes/aiIntegration.ts`. **Nothing was changed.**

**No endpoint reads `req.query` at all.** Not `limit`, not `q`, not `from`/`to`, not `status`,
not `supplierId`. `ALLOWED_QUERY` in the reader declares six parameters and the server accepts
none of them.

| endpoint | server-side window | server-side cap | rows returned for `?limit=3` |
|---|---|---:|---:|
| `/inventory` | none | **none** | **199** |
| `/suppliers` | none | **none** | 36 |
| `/daily-counts` | last 7 days (`submittedAt`) | 50 | **50 — at the cap** |
| `/order-planning` | none | **100** (raw SQL `LIMIT 100` ×2) | 44 |
| `/purchase-orders` | last 30 days (`createdAt`) | 100 | 14 |
| `/invoices` | last 30 days (`createdAt`) | 100 | **1** — see DEFECT-009 |

## The cost, measured rather than inferred

Two endpoints have **no cap at all** and return the entire table on every call. The reader then
discards all but `MAX_ITEMS = 25`, client-side. So a question about stock transfers 199 rows to
keep 25, on every turn that reads inventory.

Correctness is unaffected. What it costs is bandwidth, latency, and a table scan per turn — and
it grows with the business, silently, because nothing reports it.

## And one that is not merely wasteful

`/daily-counts` returned **exactly 50 rows against a hardcoded `.limit(50)`**. A result that
lands exactly on its cap is indistinguishable from one that was truncated, and nothing in the
response says which. The reader's `totalCount` becomes 50 and `completeness` becomes
`'complete'`. **If there were 60 submissions in those 7 days, she would report 50 and call it
all of them.**

That is the same shape as DEFECT-009 below it, one endpoint over.


> **CORRECTION, 2026-08-08 (Owner review).** The table above first recorded `/order-planning`
> as uncapped. It is **LIMIT 100**, written in RAW SQL inside a template literal — twice — so an
> audit that grepped for drizzle’s `.limit(` missed it. Searching for one spelling of a thing,
> the same defect as HR-56. Re-audited with both spellings; the corrected table is in
> `DEFECT-009` and in `SERVER_LIMITS`.
