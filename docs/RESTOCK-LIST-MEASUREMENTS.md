# Restock list — what the data actually supports

**Measured 2026-08-05 by read-only GET against live production. NOTHING BUILT.**
Recorded before any design, because measurements evaporate and a design built on a guess
about them would look correct.

Companion: `DEFECT-001-order-planning-drops-short-items.md` — the defect found while doing
this, which is an operational problem in `aroma-system` regardless of whether a list is ever
built.

---

## OWNER RULINGS — these bind the design whenever it is built

> ### 1. The list must state its own coverage.
> **If 85 items have no par level, the list says so rather than presenting 114 as the
> inventory.**

> ### 2. as-of comes from `daily-counts`, not from `inventory`.
> **If the counts are stale, the list says when they were taken rather than implying "now".**

And the two shape decisions, agreed the same day:

- **Not a chat answer.** 「I should not have to compose a sentence and then gamble on a
  classifier we have measured as non-deterministic.」 (M-5.)
- **Not a briefing.** One surface, one thing, the list itself.

---

## 1. The sample cap does not bite. Whole-table ranking already works

| | measured |
|---|---|
| `/ai/inventory` SQL | **no LIMIT** — every active row |
| returned | 199 rows, `count: 199` — the header and the payload agree |
| adapter behaviour | sorts **all** rows by `parLevel - currentStock` desc, **then** slices |
| display cap | `MAX_ITEMS = 25` in `aromaSystemRead.js:142` |

The 「4 rows」 was an old defect — an arbitrary first four presented as 「4 項存貨」 — and it
is already fixed. **Ranking the whole table by gap needs nothing built.** The cap applies to
what is shown, never to what is ranked.

## 2. Row shape — what is actually on an inventory row

```
id · name · unit · currentStock · parLevel · isPurchasable · lifecycleStatus
     category · subCategory
```

No location. **No timestamp of any kind** — declared in `SCOPE_OF.inventory` as
`hasAsOf: false`, which is why ruling 2 exists.

## 3. Why 缺口 alone is the wrong signal — six measured reasons

| # | finding | number |
|---|---|---|
| 1 | **`unit` is already on the row** — the reason 45 ≠ 45. Below-par unit spread: `cs` 29, `bag` 8, `bottle` 8, `ea` 8, `pal` 3, `box` 2, `pack` 2, `kg` 1 | 8 distinct units |
| 2 | **ratio alone collapses** — gap/par puts 12+ items in a dead tie at `1.00` (everything at zero stock) | 12 tied |
| 3 | **`category` is unusable; `subCategory` is** | category empty on **178 of 199**; subCategory empty on **0 of 199**, 24 distinct values |
| 4 | **par level covers barely half the master** | `parLevel = 0` on **85 of 199**; of those, **82 also have zero stock** — invisible to any par-based list. Usable: **114 of 199 (57%)** |
| 5 | **order-planning carries the ordering fields, but they are thin** | supplier on **41/43**, `pack_size` on **25/43**, **`latest_price` on 4/43** — the list cannot say what it will cost |
| 6 | **order-planning drops 18 of the 61** | see `DEFECT-001` |

### Below-par subCategory spread (the 61)

`Other` 11 · `Dry Goods` 9 · `Beverages` 8 · `Produce` 8 · `Packaging` 5 ·
`Sauces & Condiments` 3 · `Cleaning` 2 · `Detergent` 2 · `Canned & Broth` 2 ·
`Meat & Seafood` 2 · then 9 singletons.

Workable for grouping. **Imperfect** — the largest single bucket is `Other`.

## 4. The as-of dimension exists — on `daily-counts`, and it is already a morning habit

`/ai/daily-counts` carries `submittedAt`, `locationCode`, `locationName`, `itemCount`,
`dueDate`, `items`. Live at time of measurement:

```
2026-08-05T11:42:56Z  Dry Store 9   8 items
2026-08-05T11:42:34Z  Dry Store 6  17 items
2026-08-05T11:41:23Z  Dry Store 7   8 items
2026-08-05T11:40:59Z  Dry Store 5   4 items
2026-08-05T11:40:30Z  Dry Store 4   7 items
2026-08-05T11:40:08Z  Dry Store 3   7 items
2026-08-05T11:39:31Z  Dry Store 2  10 items
2026-08-05T11:38:59Z  DS-1         21 items
```

Eight submissions inside four minutes, **≈06:38–06:42 Winnipeg** (UTC−5 in August; derived
from the stamps, not read off a clock).

**The counts are already being entered in the morning, before anything would be read.** That
is what makes ruling 2 achievable rather than aspirational: an honest 「as of」 exists, it is
just not on the endpoint that carries the quantities.

## 5. Top of the list as it stands today, ranked by raw gap

Shown so a later version can be compared against something rather than described.

```
  65  ea      par=75   have=10   Napa Cabbage
  39  cs      par=40   have=1    New Orleans Roast Marinade
  37  cs      par=40   have=3    Dark Soy Sauce
  20  cs      par=20   have=0    Jars for Red Chili Oil
  20  cs      par=40   have=20   Swiss Sauce
  18  ea      par=48   have=30   Peanut Butter
  14  pal     par=20   have=6    Canola Oil
  12  bottle  par=24   have=12   Knorr Chicken Bouillon   ← missing from order-planning
  11  box     par=30   have=19   2lb portioning bag
  10  cs      par=15   have=5    Chicken Thigh (Halal)
   9  cs      par=10   have=1    Chili Flakes
   9  cs      par=10   have=1    Chili Powder
```

---

## What was NOT measured, and is therefore not claimed

- Whether `inventory_projected_state` is stale as well as incomplete — only its **coverage**
  was measured (43 of 61), not the freshness of the rows it does hold.
- Whether the 85 items with `parLevel = 0` are deliberate (not stock-controlled) or simply
  unfilled. That is an Owner data question, not a code question.
- Anything about cost. `latest_price` on 4 of 43 is too thin to conclude from.
