# DEFECT-001 — the fix, planned

<!-- record-status: SUPERSEDED 2026-08-05 -->

**DESIGN ONLY. No edit authorised, no clone built, `aroma-system` untouched.**
Target: `aroma-system/server/routes/aiIntegration.ts`, the `/api/v1/ai/order-planning` route
(`:219`–`:290`). Defect write-up: `DEFECT-001-order-planning-drops-short-items.md`.

---

# 1. The fix — LEFT JOIN, COALESCE, and a `basis` field

## The query

Drive from the ingredient master; treat the projection as an **enrichment**, never a filter.

```sql
FROM raw_ingredients ri
LEFT JOIN inventory_projected_state ips ON ips.ingredient_id = ri.id
LEFT JOIN ingredient_suppliers isup ON isup.ingredient_id = ri.id AND isup.is_primary = 1
LEFT JOIN suppliers s          ON s.id  = isup.supplier_id
LEFT JOIN supplier_products sp ON sp.id = isup.supplier_product_id
WHERE COALESCE(ips.projected_qty, ri.current_stock) < ri.par_level
  AND ri.is_active = 1
  AND ri.is_purchasable = 1
ORDER BY (ri.par_level - COALESCE(ips.projected_qty, ri.current_stock)) DESC
```

Per row:

| field | expression |
|---|---|
| `projected_qty` | `COALESCE(ips.projected_qty, ri.current_stock)` |
| `incoming_qty` | `ips.incoming_qty` — **stays NULL when there is no projection row** |
| `basis` | `CASE WHEN ips.ingredient_id IS NULL THEN 'current_stock' ELSE 'projected' END` |

`incoming_qty` must **not** be coalesced to `0`. Unknown and zero are different answers, and
merging them is the same defect one level down.

## What `basis` actually distinguishes — and it is NOT "which query ran"

It is **per row**, and it tells the caller whether the number can see inbound stock:

| `basis` | what the number means | what the caller does |
|---|---|---|
| `projected` | shortfall **after** everything already on order arrives | **a conclusion** — order it |
| `current_stock` | shortfall ignoring anything inbound, because no projection exists for this item | **a candidate** — check whether it is already on order first |

So a restock list must **show** the distinction rather than swallow it. That is the Owner's
own ruling — the list states its own coverage — arriving at the row level.

### A field whose two values agree today, and must still be emitted

Measured 2026-08-05: `incoming_qty` is **0 on all 43 rows** that have projections. So today
`projected` and `current_stock` produce identical numbers, and `basis` looks redundant.

**Emit it anyway.** The day purchase orders start feeding the projection is the day the two
diverge — and on that day nobody will re-derive which rows were which. A distinction recorded
before it matters is the only kind that is available when it does.

## And fix what `count` claims

`count: rows.length` is what made 43 read as the answer. Alongside it:

```json
"coverage": { "belowPar": 61, "returned": 61, "limit": 100 }
```

`LIMIT 100` is not binding today at 61 rows, but a response that cannot say whether it was
truncated is one bad month away from lying.

---

# 2. The fallback at `:256` — REMOVE it

> **Owner: 「a degraded path that is better than the primary one is not a fallback, it is the
> primary one wearing a disguise.」**

**Recommendation: remove, not repair.** Three reasons:

1. **Its job is gone.** The fallback existed to survive `inventory_projected_state` being
   absent. The new primary handles that natively — a LEFT JOIN with `COALESCE` returns every
   below-par ingredient whether the projection has 43 rows, 0 rows, or all of them. The case
   the fallback was written for no longer produces a different answer.
2. **The `catch` is untargeted.** `} catch {` swallows *everything* — a syntax error, a
   permission error, a timeout, a connection drop — and answers with plausible rows. That is
   the silent-drop class in its purest form: not a missing feature, a **wrong answer that
   looks right**.
3. **The one remaining case should be loud.** If `inventory_projected_state` does not exist as
   a table, that is a migration or deployment fault. It must surface, not be papered over by
   a query that happens to return something.

**If a fallback is wanted anyway**, the only acceptable shape is: catch, log the real reason,
and return **503 with a named reason** — never rows. A response that carries data must always
be able to say how the data was produced.

---

# 3. The regression-check gap — ITS OWN CHANGE, and this one goes first

**Not in this change.** Three independent reasons:

| | |
|---|---|
| **different artefact** | it is in `scripts/deploy.sh`, which is **not on `main`** — it lives on the unmerged branch `origin/fix/deploy-sh-branch-resolution`, and the authoritative copy is the one on the VPS. Fixing it means first deciding which copy is real (`DEFECT-002`/`004` territory) |
| **different risk class** | this change is one read-only SQL statement — no schema, no deploy semantics, reversible by reverting one file. That change alters what a deploy *does on failure* |
| **it would block this one** | verifying an auto-rollback means deliberately failing a deploy on **staging**, and staging is 18 commits behind (`DEFECT-003`). Bundling them means the fix for the thing costing stock today waits on the staging branch |

**Sequence: DEFECT-001 first, alone.** `DEFECT-004` is real and it is not urgent in the way an
under-ordered kitchen is.

---

# 4. How to verify without trusting it

## The criterion, corrected

The earlier form was 「`/ai/inventory` gap>0 count == `/ai/order-planning` count」. That is
**almost right and would eventually mislead**: `/ai/inventory` filters only `is_active`, while
`/ai/order-planning` also filters `is_purchasable`. Today all 199 rows are purchasable so the
two coincide — the moment one is not, the equality breaks for a legitimate reason and would
read as a regression.

> ### The criterion
> ```
> count of /ai/inventory rows where isPurchasable AND (parLevel - currentStock) > 0
>   ==  /ai/order-planning count
> ```
> **Today: 61 vs 43. Fixed: 61 vs 61.**

## A matching count is not enough

A count can match by coincidence — one row wrongly added while another is wrongly dropped. So
the check asserts three things:

1. **the counts match** (61 == 61);
2. **all eighteen named items are present** — Knorr Chicken Bouillon, Peeled Garlic, Green
   Onion, Salted Peanut, Red Onion, Nestea, Ginger, Sealing Bags, Coca-cola, Egg (S), Salted
   Peanuts, Baking Powder, Dishwashing Liquid, Cucumber, Garlic Powder, Mayonnaise, Root Beer,
   Sprite;
3. **`basis` is present on every row**, with roughly 18 reading `current_stock`.

## The instrument has already demonstrated a negative

The probe that would verify the fix is **the same script that found the defect**
(`scratchpad/probe2.js`, run 2026-08-05). It already returned the failing answer — 61 vs 43,
18 named, `incoming_qty > 0` on 0 of 43.

> **So this check has earned its zero.** It is not a verifier written after the fact whose
> only observed outcome is「pass」— it has been seen to fail, against the live system, on the
> defect it is meant to detect. That is the `probe_never_failed` rule from the worker-adapter
> design, arriving before the adapter exists.

Run it **before** applying anything so the failing baseline is recorded again on the day, then
after. Two runs, same script, one number.

---

# 5. Does this need the no-remote clone? — NO, and the reason is not "it is small"

## The answer

**No.** The deliverable is a patch to **one file, one route, one SQL statement plus a response
shape**, and it can be produced **without touching `aroma-system` at all** — written straight
into the scratchpad and handed over.

**The reason it is safe is not size.** It is that nothing is edited: a patch produced without a
working copy has exactly the property the clone was designed to provide — **nothing lands**.
The clone is the mechanism for work that *must* edit a tree. This work does not.

## ⚠ But the clone would not have helped anyway, and that is worth knowing

The clone's value here would have been **verification, not safety** — running the query. It
cannot deliver that:

> **Measured 2026-08-05: `aroma-system` on this machine has no `.env`, no `DATABASE_URL`, and
> no `docker-compose`. There is no local database.** The data lives on the VPS.

So the SQL cannot be executed here, clone or no clone. **The real blocker for verifying this
fix is not the clone — it is `DEFECT-003`.**

## The sequencing decision that follows, which is the Owner's

With no staging, there are two honest routes and no third:

| route | what it costs |
|---|---|
| **A. Fix `DEFECT-003` first**, bring `staging` to `main`, verify there, then promote | correct order; delays the fix for the thing under-ordering the kitchen today |
| **B. Apply to production with the probe run before and after** | the change is a **read-only** `SELECT` in one GET route — no schema, no write path, revert is one file — and the verifier has already demonstrated a failure. Fastest to value; verified on production rather than before it |

**Recommendation: B**, on the strength of the change being a read-only query in a read-only
route, with an instrument that has been seen to fail. **But it is a deploy, so it is the
Owner's per-deploy GO — and the ritual's save-point and tag apply as written.**
