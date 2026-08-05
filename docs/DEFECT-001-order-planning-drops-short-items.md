# DEFECT-001 — `/api/v1/ai/order-planning` silently omits short items

**Repo: `aroma-system` (production). NOT this repo. NOT fixed here — reported only.**
**Found: 2026-08-05, by read-only measurement against live production.**
**Severity: operational. It can cost stock, and it does so today, independent of any new build.**

---

## One line

**18 of the 61 items currently below par do not appear in the endpoint you would order from,
and the response reports `count: 43` as though 43 were the answer.**

---

## Symptom, measured

Four read-only GETs against `https://system.aromabistro741.com`, 2026-08-05:

| endpoint | rows | filters applied |
|---|---|---|
| `/api/v1/ai/inventory` | 199 returned, `count: 199` | `is_active = 1` |
| — of those, below par | **61** | all 199 are `isPurchasable`, all `lifecycleStatus: active` |
| `/api/v1/ai/order-planning` | **43**, `count: 43` | `is_active = 1 AND is_purchasable = 1` |

The filters are the same. The shortfall test is the same. **The two endpoints disagree by 18
rows, and nothing in either response says so.**

## The 18 missing items

Every one is genuinely below par according to `/ai/inventory` on the same request cycle.

| item | short by | unit | par | on hand |
|---|---|---|---|---|
| Knorr Chicken Bouillon | 12 | bottle | 24 | 12 |
| Peeled Garlic | 6 | pack | 12 | 6 |
| Green Onion | 4 | bag | 8 | 4 |
| Salted Peanut | 4 | pack | 6 | 2 |
| Red Onion | 3 | bag | 3 | 0 |
| Nestea Iced Tea | 3 | cs | 3 | 0 |
| Ginger | 2 | kg | 2 | 0 |
| Sealing Bags | 2 | cs | 2 | 0 |
| Coca-cola | 2 | cs | 5 | 3 |
| Egg (S) | 2 | cs | 8 | 6 |
| Salted Peanuts | 2 | bag | 4 | 2 |
| Baking Powder | 1 | box | 1 | 0 |
| Dishwashing Liquid | 1 | ea | 1 | 0 |
| Cucumber | 1 | cs | 2 | 1 |
| Garlic Powder | 1 | bottle | 2 | 1 |
| Mayonnaise | 1 | pal | 2 | 1 |
| Root Beer | 1 | cs | 2 | 1 |
| Sprite | 1 | cs | 3 | 2 |

Six of them are at **zero on hand**.

---

## Cause

`server/routes/aiIntegration.ts:243-244` — the primary query starts from the projection table
and **INNER JOINs** the ingredient master:

```sql
FROM inventory_projected_state ips
JOIN raw_ingredients ri ON ri.id = ips.ingredient_id
```

An ingredient with no row in `inventory_projected_state` is not "shown with a zero" — it is
**dropped from the result set entirely**. It cannot be short, because it cannot be present.

`:289` then reports `count: rows.length`, which is the number of rows that survived the join,
not the number of items below par.

## Ruled out: "they were already ordered"

That was the first hypothesis and **it is false, measured, not assumed**:

> **`incoming_qty > 0` on 0 of the 43 returned rows.**

No row is being suppressed because stock is inbound. Cross-checked the other direction too:
**0** returned rows are *not* below par by `current_stock`, so the projection is not
disagreeing with the master on the 43 it does cover. The 18 are absent, not adjusted.

---

## Second defect, in the same route: the fallback is silent — and more correct

`:256` catches any failure of the primary query and falls back to a query reading
`raw_ingredients` directly (`:276`), with `NULL AS incoming_qty`.

Two problems:

1. **Nothing in the response says which query ran.** The JSON shape is identical. A consumer
   cannot tell whether `projected_qty` accounts for inbound stock or is simply a copy of
   `current_stock`.
2. **The fallback would have returned all 61.** It reads `raw_ingredients` directly with the
   same filters and no projection join. So the degraded path is *more complete* than the
   primary path — and if it ever silently engages, the item count jumps by 18 with no
   explanation available to anyone reading the output.

---

## Suggested direction — NOT APPLIED

Recorded as a starting point, not a patch. This is production and a different repo.

- Drive the query from `raw_ingredients` and **LEFT JOIN** `inventory_projected_state`,
  with `COALESCE(ips.projected_qty, ri.current_stock)` — so an ingredient missing from the
  projection is still evaluated, using the master's own stock number.
- Emit which path produced the rows (e.g. a `basis: "projected" | "current_stock"` field), so
  the silent fallback stops being silent.
- Consider whether `LIMIT 100` should be accompanied by a total, for the same reason
  `count` is currently misleading.

## How to verify a fix

Compare, in one request cycle:

```
count of /ai/inventory rows where parLevel - currentStock > 0
  ==  count of /ai/order-planning rows
```

Today that is `61` vs `43`. After a fix it should match, or the difference should be
explained by a field in the response rather than by reading the SQL.

---

## Why this is filed here rather than fixed

The defect is in `aroma-system` production, which is governed by its own deploy ritual
(save-point, tagged rollback, per-deploy Owner GO). **Nothing was changed.** All measurement
was read-only `GET` against the AI read endpoints, which are structurally read-only on this
side: one constant `method: 'GET'`, a frozen path list, and no write route reachable from
the adapter.
