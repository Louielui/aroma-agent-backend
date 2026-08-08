# REPORT A — EVIDENCE TRUTH CONTRACT

> **Owner: 「P0 is truth, not capability… fix the CONTRACT, not one invoice number.」**

**REPORT ONLY. No code written, nothing merged, restarted or deployed.**

First, the correction he issued, recorded because it changes how the counter is read:

> **The intent-breadth counter measures what survives the current router, not what he asks.**
> The Costco question IS multi-step — shortfall × supplier × incoming × purchasing unit / pack
> size — and scored `n=1` because routing stopped at step one. My line 「if n=2 never appears the
> enquiry tier has no customer」 was wrong: absence in that counter is evidence about the ROUTER,
> not about demand. It runs in parallel as evidence and is **never** the gate for whether
> reasoning capability is required.

---

## 1. THE EXACT AMBIGUITY, PER ENDPOINT

One number, `count`, travels from the server to the prompt and is rendered as an existence claim:

```js
// aromaSystemRead.js:385   — comment reads 「THE REAL TOTAL, from the API's own header」
const totalCount = Number.isFinite(body && body.count) ? body.count : rows.length
// readContext.js:111
const total = Number.isFinite(e.totalCount) ? `${e.totalCount} records exist` : 'total unknown'
```

Measured against the six endpoints:

| endpoint | server window | server cap | what `count` ACTUALLY means | rendered as | true? |
|---|---|---:|---|---|---|
| `inventory` | none | none | every row | 「199 records exist」 | **TRUE** |
| `suppliers` | none | none | every row | 「36 records exist」 | **TRUE** |
| `orderPlanning` | none | none | every row | 「44 records exist」 | **TRUE** |
| `dailyCounts` | 7d on `submittedAt` | 50 | rows in 7 days, **capped, and it returned exactly 50** | 「50 records exist」 | **UNKNOWABLE** |
| `purchaseOrders` | 30d on `createdAt` | 100 | rows *created* in 30 days | 「14 records exist」 | **FALSE** |
| `invoices` | 30d on `createdAt` | 100 | rows *created* in 30 days | 「1 records exist」 | **FALSE** (~471) |

> **Three of six render a true statement. Three render a false or unverifiable one. Nothing in
> the data distinguishes them** — the reader cannot tell which kind of number it is holding, and
> neither can the model.

Two further ambiguities in the same line:

- **`completeness`** is derived as `totalCount > shownCount ? 'sample' : 'complete'`. Because a
  window can shrink the total to match the page, **the most filtered endpoint is the only one
  labelled `complete`.** The tighter the filter, the quieter the warning.
- **`retrievedAt`** is when *we read*, and is the only time value present. There is no statement
  anywhere of how current the underlying data is.

---

## 2. THE PROPOSED CONTRACT — RECONCILED, NOT COMPETING

His field list, mapped onto what exists. **The reconciliation matters more than the fields**:
there is already a scope concept, an unknown convention and a completeness flag, and a second
truth contract beside them would be the fifth list nobody updates.

| proposed field | reconciles with | change |
|---|---|---|
| `source` | `evidence.source` | none |
| `returnedRows` | *(new)* — rows the SERVER returned | add; distinct from `shownCount` |
| `shownCount` | exists | **keep** — rows kept after the client `MAX_ITEMS=25` cap. Not the same number as `returnedRows` and both are needed |
| `matchingTotal` | **`body.count` already IS this** | rename only |
| `sourceTotal` | *(new)* | add, `null` today |
| `scope` | ⚠ **NAME COLLISION** — see below | add as `queryScope` |
| `filtersApplied` | `ALLOWED_QUERY` is what we MAY send, not what was applied | add |
| `limit` | *(new)* | add |
| `truncated` | *(new)* | add, tri-state |
| `completeWithinScope` | replaces the misuse of `completeness` | add; `completeness` retained for the client cap |
| `dataAsOf` | `retrievedAt` is a different fact | add, `null` today |

### ⛔ THE ONE COLLISION THAT MUST BE SETTLED FIRST

`SCOPE_OF` already exists and means **the shape of a row** — `hasLocation`, `hasAsOf`, a note
saying 「每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅」. His `scope` means **which rows were
selected** — a field and a window.

> **These are two different facts and one word.** Left as-is, 「scope」 in a log or a prompt would
> mean row-shape in one place and query-window in another.

**Proposal: `rowShape` (existing `SCOPE_OF`, renamed) and `queryScope` (new).** Renaming the
existing one is the safer half of the pair, because it is internal; `queryScope` is the new
concept and should carry the unambiguous name.

### The proposed descriptor

```
source, endpoint, entityType
returnedRows        int    — what the server sent
shownCount          int    — what survived the client cap
matchingTotal       int|null   — rows matching the declared query   (= today's body.count)
sourceTotal         int|null   — records in the wider source        (null today, everywhere)
queryScope          { field, window, declaredBy } | null
filtersApplied      [ ... ] | null
limit               int|null
truncated           true|false|null
completeWithinScope true|false|null
completeness        'sample'|'complete'|'unknown'  — the CLIENT cap only, unchanged meaning
dataAsOf            iso|null
retrievedAt         iso
trust, provenance
```

### Three rules he set, and where each bites

1. **No ambiguous field unless machine-defined.** `sourceTotal` is defined as 「rows the endpoint
   would return with no window and no limit」 — not 「all invoices in the business」, which no
   endpoint can answer.
2. **Never `false` where the state is unknown.** The sharpest case is `dailyCounts`:
   `returnedRows === limit === 50`. **A result sitting exactly on its cap is indistinguishable
   from one truncated by it**, so `truncated` MUST be `null`, and therefore `completeWithinScope`
   must be `null` too. A `false` there would be a fabrication.
3. **Never omit, never infer, never default.** Every field is always present. `null` means
   unknown and is rendered as such — and this is **already the house convention**:
   `readContext.js:585` carries `totalCount: null, // unknown is unknown` and
   `completeness: 'unknown'` for the non-aroma sources. The aroma adapter simply never uses it.

---

## 3. WHICH FIELDS ARE KNOWN TODAY — WITHOUT ANY SERVER CHANGE

| field | today | note |
|---|---|---|
| `returnedRows` | **YES** | `rows.length` |
| `shownCount` | **YES** | exists |
| `matchingTotal` | **YES** | `body.count` is exactly this. **Nothing needs to change server-side to populate it correctly — only to stop calling it the source total.** |
| `sourceTotal` | **NO** | `null` for all six. Requires a server change |
| `queryScope` | **PARTLY — and dangerously** | see below |
| `filtersApplied` | **PARTLY** | same |
| `limit` | **PARTLY** | same |
| `truncated` | **DERIVABLE** | `returnedRows === limit` → `null` (unknowable); `< limit` → `false`; no known limit → `null` |
| `completeWithinScope` | **DERIVABLE** from `truncated` | `null` whenever `truncated` is `null` |
| `dataAsOf` | **NO** | no generation timestamp is returned. `null` |
| `retrievedAt` | **YES** | exists |

### ⛔ The trap inside 「partly」

The windows and limits are known **only because I read the server source on 2026-08-08**. Putting
them in the reader as constants makes the reader assert a property of a system it does not
control — the exact shape of M-8, and it would be silently wrong the day the server changes.

**Therefore `queryScope` carries `declaredBy: 'server' | 'reader'`.** A reader-declared scope is
an assumption on record, not a fact, and it should be verifiable by a test that re-reads the
server route. **`declaredBy: 'server'` is the target state; `'reader'` is a debt marker.**

---

## 4. WHAT REQUIRES AROMA SYSTEM SERVER CHANGES

In priority order, smallest first:

1. **`sourceTotal` in the envelope.** One extra `COUNT(*)` per endpoint, additive:
   `{ success, count, sourceTotal, data }`. **This alone stops the wrong number being acted on**,
   because it lets `completeWithinScope` and the rendered line separate 「1 matched」 from
   「1 exists」.
2. **Declare the window and the limit in the response** — `{ queryScope: {field, window}, limit }`.
   Moves `declaredBy` from `'reader'` to `'server'` and retires the debt in §3.
3. **`dataAsOf`** — a generation timestamp.
4. **Honour `?limit`/`?from`/`?to`** (DEFECT-007). Then the window is the caller's and
   `queryScope` becomes a fact about the request rather than a server constant.
5. *(separate decision, DEFECT-009)* whether `invoices` should filter on `invoiceDate` rather
   than `createdAt` at all.

**Items 1–3 are additive and break no existing caller. Items 4–5 change results and need their
own assessment.**

---

## 5. MIGRATION COMPATIBILITY

**Server side (1–3): purely additive.** New keys in the envelope; every existing consumer ignores
them.

**Reader side: one breaking rename, deliberately.**

> **`totalCount` must be REMOVED, not aliased.** Keeping it as a synonym for either
> `matchingTotal` or `sourceTotal` preserves the ambiguity under a new name, which is the whole
> defect. A compile-time break is the cheapest way to force every consumer to say which one it
> meant.

Two consumers, both must be revisited by hand:

- **`readContext.js:111`** — 「N records exist」. Becomes a statement about the declared scope, and
  **must not emit an existence claim at all while `sourceTotal` is null**.
- **`evidenceGate.js:93`** — `completeness === 'sample'` gates universal claims. Under the new
  contract the correct gate is **`completeWithinScope !== true`**, which is strictly stronger: it
  also fires when truncation is unknown. Today's `'complete'` on invoices means the gate is not
  firing on the endpoint that most needs it.

**No behaviour is safe to change silently here**: both consumers govern what she is allowed to
assert.

---

## 6. TESTS THAT PROVE SEMANTICS, NOT SHAPE

Shape tests (「the field exists」, 「it is a number」) would pass on the current defect. Each of
these fails today and states a meaning:

1. **A filtered endpoint may not produce an existence claim.** Given `count:1`, a declared 30-day
   window and `sourceTotal:null`, the rendered scope line must not contain 「exist」 in any form.
   *(Fails today: renders 「1 records exist」.)*
2. **On-the-cap is unknown, not complete.** `returnedRows === limit` ⇒ `truncated === null` and
   `completeWithinScope === null`. Asserted with `strictEqual(…, null)`, never `ok(!x)` — which
   would pass on `false` and is the assertion-shape defect this project already has a fence for.
3. **`matchingTotal` and `sourceTotal` are never conflated.** Given a response with
   `count:1, sourceTotal:471`, the two fields differ and neither is silently substituted.
4. **Unknown survives the whole pipeline.** A `null` at the adapter is still `null` in the
   evidence descriptor and is rendered as unknown in the prompt — no layer defaults it.
5. **The universal-claim gate fires on unknown completeness.** `completeWithinScope: null` +
   a universal claim ⇒ refused, the same as `sample`. *(Fails today.)*
6. **`declaredBy: 'reader'` is verifiable.** A test reads the aroma-system route source and
   asserts the window the reader declares matches the window the server applies. **Seen-to-fail
   by changing the declared window and watching it go red.**
7. **Each of the six endpoints has an explicit expectation** — three assert `matchingTotal ===
   sourceTotal` semantics are legitimately equal when there is no window; three assert they are
   distinct concepts and that the rendered line says so.

Test 6 is the one that keeps this honest over time: it is the mechanism that stops a
reader-declared scope from becoming a stale assertion — the failure mode M-8 exists to name.

---

## 7. WHAT THIS REPORT DOES NOT COVER

- **No code was written.** No adapter change, no server change, nothing deployed.
- **`sourceTotal` for `invoices` was never measured.** ~471 is from `CLAUDE.md`. Nothing here
  queried the invoice table.
- **Whether the 30-day windows are deliberate** is still unknown; the routes carry no comment.
- **Gmail, Calendar, Drive and GitHub** were not audited. This contract is specified for
  `aroma_system` and the other four already use the `totalCount: null / 'unknown'` convention —
  whether they use it *correctly* was not checked.
