# WHO MAINTAINS THE MAP?

> **Owner, before the contracts: 「If the Business Map and the Capability Registry are
> hand-written documents, they are lists someone must remember to update. This project's record
> on that is explicit: five fences added in one week, list updated zero times. And a stale map is
> worse than no map.」**

Design only, no code. Answered against the code at `ee58ae0`.

**The short answer, stated first because it is the uncomfortable one:**

> **The SHAPE can be derived. The MEANING cannot, and the meaning is most of it.** Roughly
> five-sixths of what a Business Map holds is irreducibly hand-written — and it already exists,
> already hand-written, already unenforced, in `context/adapters/aromaSystemRead.js`.

So the map does not need to be built. It needs to be **made loud**, and that is a smaller and
much better-defined job than building it.

---

## 1. THE REGISTRY IS NOT HYPOTHETICAL — IT IS ALREADY THERE

`aromaSystemRead.js` already carries six hand-written tables, all keyed by the same six endpoints:

| table | what it holds | derivable? |
|---|---|---|
| `PATHS` | the six endpoints | **yes** — and already pinned by a test |
| `ALLOWED_QUERY` | accepted inputs | **partly** — declared, but flat: it does not say which endpoint takes which |
| `ENTITY_OF` | what kind of thing a row is | no — a naming decision |
| `SCOPE_OF` | what the data does NOT contain | **no, and never** — see §3 |
| `METRICS_OF` | what a number MEANS | no |
| `RANKING_OF` | which signal makes a row worth showing | no — a judgement |
| `DERIVATIONS_OF` | computed fields (缺口 = par − live) | no |
| `FIELD_LABELS_OF` | aliases she actually writes | no |

**This is the registry.** The proposal was not to create one; it was to give it a name and a
consumer. That changes the risk profile entirely — the staleness he is worried about is not a
future hazard, it is a present one that nothing is currently checking.

---

## 2. WHAT CAN BE DERIVED — AND FROM WHERE

The important distinction is not code-versus-hand. It is **three** sources, and the second is the
one that gets forgotten:

### (a) Derivable from the source, statically — free, exact

- **the endpoint list** — `PATHS`, frozen. `aromaSystemRead.test.js` already asserts the exact
  six values and that the object is frozen. **A seventh endpoint fails that test today.** This is
  the one piece that is already loud, and it is the model for everything else.
- **the HTTP method** — one constant, no parameter anywhere (§5 of the enquiry design).
- **the accepted query parameters** — `ALLOWED_QUERY`, frozen. Flat, so per-endpoint inputs are
  *not* derivable without a change.

### (b) Derivable from a CAPTURED LIVE RESPONSE — cheap, and currently not done

**There is no response schema anywhere in this repo.** The adapter does not know what fields come
back. It *guesses*, from hand-written name lists — `ID_FIELDS`, `TITLE_FIELDS`, `DATE_FIELDS` —
and the file records what that cost:

> a missing spelling produced 「(untitled) (no date)」 and the turn 「reasonably reported that it
> could not read anything」

But one GET per endpoint yields the real field names, their types, and which are reliably
non-empty. **The field-level half of the registry is derivable — just not from the source. From
the system itself.**

And the file already states the principle for why that matters, in its own words:

> 「a name is either a field this API returns or it is not — **and a list can be checked against a
> captured response, which a transformation cannot**」

That sentence is the whole mechanism of §4. It was written about `ID_FIELDS` and it generalises
to every table here.

### (c) Not derivable from anything — must be declared

Everything in §3.

---

## 3. WHAT GENUINELY CANNOT BE DERIVED, AND HOW MUCH

Honestly: **most of it.** Four kinds, and each is irreducible for a different reason.

**1. What a number MEANS.** `currentStock: 「記錄存量,無地點、無時間戳」`. No introspection of any
response yields that sentence. It is knowledge about the business.

**2. What the data does NOT contain — and this one is not derivable even in principle.**
`SCOPE_OF.inventory: 「每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅」`. A captured response can
show you which fields ARE present. It can never tell you that the absence is *structural* rather
than *this batch happening not to have any*. **Absence is not observable from a sample.** This is
the same reason a read that returned zero rows cannot distinguish 「nothing matched」 from
「nothing exists」 — the distinction this project has already been bitten by.

**3. Which signal makes a row worth showing.** `RANKING_OF.inventory: parLevel − currentStock`.
A judgement about what the Owner cares about.

**4. ⛔ THE JOIN TARGETS — the new thing, and the most dangerous to get wrong.**

`ID_FIELDS` already contains `supplierId`, `supplier_id`, `ingredientId`. It is tempting to say
「`supplierId` obviously points at `suppliers`」 — and that is **a naming heuristic, which is
exactly the shape removed twice today** (`訂貨` vs `訂什麼貨`, `沒有權限` vs the interposed form).
A field called `supplierId` on an order-planning row might be the supplier of record, the
last-invoiced supplier, or the preferred one. **The name does not carry the answer.**

So the join map is hand-written. It is also the smallest of the tables — at most a handful of
edges over six nodes — and unlike the others it is **verifiable**, which §4 uses.

### How much, as a fraction

Of the eight tables above: **one is derivable statically, one partly, and six are meaning.** Add
the join map and it is seven hand-written tables to one derived. **The map is a declared
document with a derived spine, not the other way round.** That is not a reason to abandon it, but
it is the whole reason §4 has to exist before any of it is consumed.

---

## 4. WHAT MAKES A MISSING ENTRY LOUD

> 「A map that omits a relationship must fail visibly, not answer confidently with less.」

The file already contains **both** patterns, inconsistently, which is the clearest possible
evidence that the rule is not currently a rule:

```js
RANKING_OF   = { inventory: {...}, suppliers: null, invoices: null, purchaseOrders: null, ... }
                                   ^^^^^^^^^^^^^^^ absence DECLARED — all six keys present

DERIVATIONS_OF = { inventory: {...}, orderPlanning: {...} }
                   ^^^^^^^^^^^^^^^^^^^^ four endpoints simply missing — indistinguishable
                                        from 「nothing to declare」
```

### The mechanism: total functions over a derived key set

**Every meaning table must be keyed by `Object.keys(PATHS)` and must have an entry for every
key.** 「Nothing here」 is written as an explicit value — `null`, `NONE` — and never as absence.
Then one test per table:

```
assert.deepEqual(Object.keys(TABLE).sort(), Object.keys(PATHS).sort())
```

Adding a seventh endpoint then fails **seven tests at once, each naming the table it is missing
from**. The author does not need to remember the list; the list fails at them. This is the same
device as `sourceFlagLabels()` deriving from `ALL_SOURCES` — which exists in this repo precisely
because a fifth source once had no row and no name.

### For the join map specifically — declaration is not enough

A join is the one hand-written thing that can be **checked against reality**, so it must be:

- a declared edge names a source field, a target endpoint, and a target field;
- **VERIFIED** by two captured GETs: does the source endpoint actually return that field, and do
  its values actually resolve in the target;
- an edge that has never been verified is marked **UNVERIFIED**, and an enquiry that would need
  to traverse it **stops and says so** rather than skipping it.

### ⛔ AND THE PART THAT MATTERS MOST — SHE MAY NEVER SAY 「查齊了」

His worry is precise: 「她會報告『我查齊了』而漏咗一個冇人記得加嘅關係」.

**The fix is not a better map. It is that the sentence is never available.**

> **「查齊了」 is a claim about the MAP's completeness, which nobody can verify.
> 「我讀咗訂貨建議同供應商」 is a claim about the RECORD, which is provable.**

An enquiry must report **what it read**, never **that it read everything**. That is the same
distinction as this morning's ruling one level up — 「我冇去睇」 is provable, 「我冇權限」 is a
claim about configuration — and it is enforceable the same way: the closing line is built from
the recorded rounds, not written by the model.

That single constraint makes a stale map **degrade into an incomplete answer that names its own
scope**, instead of a confident one with an invisible gap. A missing edge then costs a
relationship the Owner can see was not consulted, which is recoverable, rather than a wrong
conclusion that reads as thorough.

---

## 5. WHAT THIS CHANGES ABOUT THE ORDER OF WORK

The previous design proposed measurement first (count intent matches, log `n`). That still
stands, but this pushes something in front of the map itself:

1. **Make the EXISTING tables total and pinned.** Six tables, one test each, no new concepts, no
   behaviour change. This is a present defect, not preparation — `DERIVATIONS_OF` is missing four
   endpoints right now and nothing says so.
2. **Capture the six response shapes** and check `ID_FIELDS`/`TITLE_FIELDS`/`DATE_FIELDS` against
   them. This is the 「a list can be checked against a captured response」 sentence, executed. It
   also produces the field inventory the join map needs.
3. *Then* the join map, small, declared, verified, with UNVERIFIED edges stopping an enquiry.
4. The enquiry itself, last, and only able to say what it read.

**Steps 1 and 2 are worth doing whether or not the enquiry tier is ever built.** They fix a
staleness problem that exists today, and if the answer to the tier question turns out to be 「not
worth it」, they are not wasted.

---

## 6. THE HONEST SUMMARY

- **Can the registry be derived?** The spine yes, the field names yes *from a captured response*,
  the meaning no. One table of eight is derived today.
- **How much must be hand-written?** Seven of eight, including the new join map. **Most of it.**
- **What makes it loud?** Total functions over `Object.keys(PATHS)` with declared absence, one
  equality test per table, plus verification-by-capture for joins — and, above all, an enquiry
  that reports what it read and is structurally unable to claim it read everything.
- **Is it worth building?** The map's staleness is already a live problem with no detector. §5
  steps 1–2 pay for themselves regardless. Whether step 3–4 follow is a separate GO, and it
  should be taken after the measurement in the previous design has produced real numbers.

---

# STEP 2 RESULT — THE SIX RESPONSE SHAPES, CAPTURED 2026-08-08

Six read-only GETs against production. **Field names and types only — no values were recorded**;
the data is the Owner's business data and the exercise is about names.

## What the adapter assumes vs what is there

| endpoint | id | title | date | verdict |
|---|---|---|---|---|
| `inventory` | `id` | `name` | — | **no date field exists** |
| `suppliers` | `id` | `name` | — | **no date field exists** |
| `dailyCounts` | `id` | `locationName` | `submittedAt` | ok |
| `orderPlanning` | `ingredient_id`, `supplier_id` | `ingredient_name`, `supplier_name` | — | **no date field exists** |
| `purchaseOrders` | `id`, `supplierId` | `poNumber`, `supplierName` | `orderDate`, `createdAt` | ok |
| `invoices` | `id`, `supplierId`(null) | `invoiceNumber`(null) → `rawVendorName` | `invoiceDate`, `createdAt` | ok |

**The three 「(no date)」 endpoints are not a defect.** `SCOPE_OF` already declares
`hasAsOf: false` for exactly those three. The name lists and the scope table agree — which is the
first time anything has actually checked that they do.

`invoices.invoiceNumber` arrives **null**, and `TITLE_FIELDS` falls through to `rawVendorName`
exactly as its comment says it was designed to. Working as intended, now observed rather than
assumed.

## FOUR FINDINGS WORTH ACTING ON

### 1. ⛔ `orderPlanning` is snake_case; every other endpoint is camelCase

`supplier_id`, `live_qty`, `par_level`, `suggested_order_qty` — against `supplierId`,
`currentStock`, `parLevel` everywhere else. `ALLOWED_QUERY` lists **`supplierId`** only. So the
one parameter that would filter order planning by supplier is spelled the other way from the
field that endpoint returns. Not yet a failure — nothing filters by it today — but it is a
loaded gun for the join map.

### 2. ⛔ `limit` appears not to be honoured

`?limit=3` returned **199 inventory rows**, 36 suppliers, 50 daily counts, 44 order-planning
rows, 14 purchase orders. The adapter caps at `MAX_ITEMS = 25` **client-side**, so every read
pulls the whole table across the network and throws most of it away. Correctness is unaffected;
cost and latency are not.

### 3. ⛔ `invoices` returned ONE row

`CLAUDE.md` records ~471 invoices. The endpoint returned a single row. Either the endpoint filters
to something narrow, or the AI-facing invoice view is near-empty. **This is a question, not a
diagnosis** — I have not looked at the server side, and doing so is a separate task.

### 4. ⛔ THE JOIN EVIDENCE — and one edge is already dead

| edge | populated? |
|---|---|
| `orderPlanning.supplier_id` → `suppliers.id` | **yes**, 3/3 non-empty |
| `purchaseOrders.supplierId` → `suppliers.id` | **yes**, 3/3 non-empty |
| `invoices.supplierId` → `suppliers.id` | **NO — null in every sampled row** |

> The invoice→supplier join is exactly the edge that 「supplierId obviously points at
> suppliers」 would have declared, and it would have returned nothing while looking like it
> worked. This is the Owner's ruling arriving before the code: **an unverified edge stops the
> query and says so; it is never guessed and never silently skipped.**

And a second, cheaper finding: `orderPlanning` already carries `supplier_name` **inline**. The
join to `suppliers` is therefore not needed to name a supplier — only for lead days and order
method. One less traversal for the commonest question.

## WHAT THIS CHANGES

- The join map has **three candidate edges, two verified live and one verified DEAD** — before a
  line of it was written.
- 「a list can be checked against a captured response」 is now done, once. It should be a test
  that runs against a stored capture, so the next drift is loud.
