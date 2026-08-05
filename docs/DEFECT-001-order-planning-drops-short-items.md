# DEFECT-001 — `/api/v1/ai/order-planning` silently omits short items

> # ⛔ DISPROVEN — 2026-08-05. THERE IS NO DEFECT HERE.
>
> ## `/api/v1/ai/order-planning` was correct throughout. The kitchen is not short 18 items.
>
> **The 18 have open purchase orders covering the shortfall.** Measured:
> `has_incoming 18 | no_incoming 43 | excluded_and_incoming 18`, and `61 − 18 = 43`.
>
> `projected_qty = live_qty + incoming_qty`, `live_qty` equals `current_stock` on all 61 rows,
> and the 18 clear par **only because of stock already on order**. That is the endpoint doing
> exactly what it says it does.
>
> **Everything below this banner is superseded** — the cause, the patch, the `basis` field,
> the severity, and the intermediate re-derivation near the end of the file, which was built
> on the same bad measurement. **Read the closing section, 「THREE CAUSES, THREE REMOVED BY
> MEASUREMENT」, before planning anything from this file.**
>
> **DISPROVEN, not deferred.** Nothing was deployed. `aroma-system` was never edited.

**Repo: `aroma-system` (production). NOT this repo. NOT fixed here — reported only.**
**Found: 2026-08-05, by read-only measurement against live production.**
**~~Severity: operational. It can cost stock, and it does so today.~~ — severity WITHDRAWN
pending the re-derivation; see the banner above.**

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

---
---

# FURTHER DEFECTS IN THE SAME CLASS

**Owner instruction, 2026-08-05:** 「Add both to DEFECT-001's file as separate entries — same
class, same repo, same 'record, do not fix'.」

Same repo (`aroma-system`, production), same treatment: **recorded, not fixed.** Same class
too — in every one of them a step reads as performed because the machinery for it exists.

DEFECT-002 and DEFECT-003 were written up in full before this instruction and keep their own
files; they are summarised here so the register is complete in one place. **DEFECT-004 is
new and is written in full below.**

---

## DEFECT-004 — the deploy reloads BEFORE it tests, so a bad build stays live

**This is true today, with or without automation.** It is not a property of a future
automated path.

`scripts/deploy.sh`, in order:

```bash
pm2 reload ecosystem.config.cjs --only "$PM2_PROC"    # ← the new build goes LIVE here
sleep 2
"$CHECK_SCRIPT" "$REGRESSION_ENV"                      # ← it is tested here
REGRESSION_STATUS=$?
...
if [ $REGRESSION_STATUS -ne 0 ]; then
  echo "❌ REGRESSION FAILED — deploy completed but tests failed"
  echo "To rollback, run:"                             # ← it PRINTS the command
  echo "  CONFIRM=YES $0 $ENV rollback"
  exit 1
fi
```

**The regression check is a post-mortem, not a gate.** On failure the script tells the truth —
「deploy completed but tests failed」 — and then does nothing about it. The failing build is
serving customers, and it keeps serving them until a human reads that line and types the
rollback command themselves.

### Why it matters

- **Today:** it is survivable only because the Owner is watching the terminal when he
  deploys. The safety depends on a human being present, not on the script.
- **If the run is unattended for any reason** — a long build, a distraction, a deploy started
  and walked away from — the window is unbounded.
- **It becomes the primary risk the moment anything is automated** (see
  `AROMA-SYSTEM-WORKING-MODEL.md` Part 3), because then nobody is watching by design.

There is a second, quieter problem in the same block:

```bash
if [ ! -f "$CHECK_SCRIPT" ]; then
  echo "WARNING: Regression script not found at $CHECK_SCRIPT — skipping"
  exit 0
fi
```

**A missing regression script exits 0 — a successful deploy.** The deploy that ran no tests
at all reports the same status as the deploy that passed them. The warning scrolls past; the
exit code does not carry it. That is the same shape as `count: 43` in DEFECT-001: a result
that reads as an answer while omitting what it did not do.

### Suggested direction — NOT APPLIED

- On regression failure, **invoke the rollback path** rather than printing it, then exit
  non-zero. Printing a command is a suggestion; the script already contains the mechanism.
- Make a missing regression script a **failure**, not a skip — or at minimum a distinct
  non-zero exit so "not tested" and "tested and passed" are different outcomes.
- Longer term the ordering itself is the defect: verification after `pm2 reload` can only
  ever detect, never prevent.

### How to verify a fix

Deliberately deploy a ref that fails regression, to **staging**. Today the site stays broken
and the script exits 1. After a fix it should return to the prior version by itself.

---

## DEFECT-002 — rollback points exist only on the VPS *(full write-up: `DEFECT-002-rollback-points-invisible.md`)*

`deploy.sh` creates `safety/pre-deploy-<env>-<ts>` with a bare `git tag` and never pushes it.
Local and GitHub tags **both stop at 2026-07-04**; today is 2026-08-05. The Owner cannot see
his own rollback points from where he works, and the rollback point shares a single point of
failure with the thing it protects against.

## DEFECT-003 — `staging` is a frozen snapshot *(full write-up: `DEFECT-003-staging-branch-stale.md`)*

`origin/staging` is **18 commits behind `main` and 0 ahead**, pointing at the July baseline.
Deploying staging today would move the site backwards, and 「approved on staging」 has no
artefact behind it.

---

## ⚠ THE MEASUREMENT THAT FOUND THIS DEFECT HAD A BLIND SPOT OF THE SAME SHAPE

**Owner instruction, 2026-08-05: record this. 「The measurement that found the defect had a
blind spot of the same shape as the defect.」**

The original query filters `WHERE ips.projected_qty < ri.par_level`. In SQL, **`NULL < x`
evaluates to NULL, not TRUE** — so any projection row carrying a NULL `projected_qty` was
**already excluded from the 43** before anything was counted.

**Which means the probe could not have seen them either.** Every number in this write-up was
taken through that same endpoint.

### What that does to the finding above

The 18 missing items were attributed, in full, to **「no row in `inventory_projected_state`」**.
That attribution is now known to be **unverified**. The 18 may contain a **fourth class**:

| class | what it is |
|---|---|
| no projection row | the cause originally claimed for all 18 |
| **projection row with a NULL number** | **never distinguishable from outside — the endpoint filters it out before anyone can count it** |

The defect and the instrument that measured it fail the same way: **a row that cannot satisfy
a predicate disappears rather than being reported.** One dropped rows through an INNER JOIN,
the other through NULL comparison semantics — the same class in two spellings, and the second
was mine.

### And it strengthens the case for `basis`

After the fix, the split is visible for the first time: `projection_incomplete` names exactly
the class that could never be counted. **The field is not only for trusting the number — it
is the only way the fourth class will ever be seen.**

### Not resolved by reasoning

Whether the class is populated **today** is unmeasured. `inventory_projected_state` is a
**VIEW** (`purchaseOrders.ts:789`) whose definition exists only in the live database — no
`CREATE VIEW` exists anywhere in the repo, and it is not in the Drizzle schema. A view carries
no `NOT NULL` of its own, so nullability is whatever its SELECT produces.

Circumstantial only, and marked as such: **four separate consumers** defensively write
`parseFloat(row.projected_qty ?? "0")` — `inventoryProjected.ts:531`, `purchaseOrders.ts:811`
and `:2215`, `replenishmentSuggestions.ts:108`. That is a belief held by four authors, not a
measurement.

To be settled by `SHOW CREATE VIEW inventory_projected_state` and a `COUNT(*) … IS NULL`,
read-only, on the VPS, before the fix is applied.

---
---

# RE-DERIVATION — the cause is not a JOIN. It is two different stock numbers.

**Owner measurement on the VPS, 2026-08-05, read-only:**

```
total_rows 199 | null_projected 0 | null_live 0 | null_incoming 0

VIEW inventory_projected_state:
  projected_qty       = ls.live_qty + coalesce(inc.incoming_qty, 0)
  incoming_qty        = coalesce(inc.incoming_qty, 0)
  suggested_order_qty = greatest(0, par_level - (live_qty + coalesce(incoming_qty,0)))
  FROM inventory_live_state ls
  LEFT JOIN inventory_incoming_state inc ON inc.ingredient_id = ls.ingredient_id
```

## Step 1 — the INNER JOIN is exonerated

199 view rows against 199 active ingredients. Nothing to drop. **The original diagnosis was
wrong**, and every conclusion resting on it goes with it.

## Step 2 — so the 18 were excluded by the WHERE, not by the JOIN

Old clause: `WHERE ips.projected_qty < ri.par_level`. Measured, `incoming_qty` is 0 on every
row, so `projected_qty = live_qty`. The 18 therefore satisfy:

```
raw_ingredients.current_stock  <  par_level      ← /ai/inventory says SHORT
inventory_live_state.live_qty  >=  par_level      ← /ai/order-planning says FINE
```

## Step 3 — the actual defect

> ## `current_stock` and `live_qty` are two different numbers for the same thing, and they disagree for 18 items.

`raw_ingredients.current_stock` is a **column on the master**. `inventory_live_state.live_qty`
is **`SUM(ledger movements)`**. One is a stored figure; the other is derived from the movement
ledger. Nothing reconciles them, and **no response says which one it used.**

Six of the 18 are at `current_stock = 0` — Red Onion, Nestea, Ginger, Sealing Bags, Baking
Powder, Dishwashing Liquid — while the ledger believes there is at least a par level of each.

## Step 4 — WHICH ONE IS RIGHT IS UNKNOWN, and that decides everything

| if authoritative | then |
|---|---|
| **the ledger** (`live_qty`) | `/ai/order-planning` was **right all along**. The kitchen is **not** short those 18. The wrong number is the 61, and `/ai/inventory` is the defective endpoint. |
| **the master** (`current_stock`) | the ledger has drifted, order planning under-orders, and the original severity was right — **for a completely different reason**. |

**This is a data question, not a code question**, and it is the Owner's to answer.

## What survives from the original report

- The two endpoints **do** disagree about 18 items — that measurement stands.
- **Neither response says which stock source it used** — the silent-drop class, still true,
  and now the more important half.
- The `:256` fallback is still an untargeted `catch` returning plausible rows. Independent of
  all this, still worth removing.

## What `basis` is worth now — its premise is gone

| value | status |
|---|---|
| `projected` | every row |
| `projection_incomplete` | **structurally unreachable** — the view coalesces, so `projected_qty` cannot be NULL. Not「zero today」: impossible. |
| `no_projection` | unreachable if the view is 1:1 with active ingredients, which 199 = 199 suggests but does not prove |

**A branch that can never be taken is a positive control that could not have failed.** Shipping
it would install something that reads as a safeguard and can never fire. `basis` as designed
should not ship.

**What the field should have distinguished, now that the real defect is known, is which STOCK
SOURCE a row's number came from** — `master` or `ledger`. That is a genuine, reachable, and
currently invisible distinction. But it belongs to a fix that has not been designed, because
the question it depends on — which source is authoritative — is unanswered.

## The one query that settles the remaining ambiguity

Read-only. Returns the 61 with both numbers side by side, and shows whether any of them is
genuinely missing a view row:

```sql
SELECT ri.name, ri.unit, ri.par_level, ri.current_stock,
       ips.live_qty, ips.incoming_qty, ips.projected_qty,
       (ips.ingredient_id IS NULL) AS missing_from_view
FROM raw_ingredients ri
LEFT JOIN inventory_projected_state ips ON ips.ingredient_id = ri.id
WHERE ri.is_active = 1 AND ri.is_purchasable = 1
  AND ri.current_stock < ri.par_level
ORDER BY (ri.par_level - ri.current_stock) DESC;
```

`missing_from_view = 1` anywhere would revive part of the original diagnosis. All zeros
confirms the re-derivation above, and the `live_qty` column shows the size of the
disagreement item by item.

---
---

# THREE CAUSES, THREE REMOVED BY MEASUREMENT

**Read this before planning a fix from anything above. 2026-08-05.**

Every section above proposed a cause. Each was plausible, each was written up with confidence,
and **each was wrong**. All three died the same way: the Owner went to the machine instead of
letting me reason from the file.

| # | proposed cause | how it died |
|---|---|---|
| 1 | **INNER JOIN** drops ingredients absent from `inventory_projected_state` | the view has **199 rows** against 199 active ingredients. Nothing was ever dropped. |
| 2 | **NULL comparison** — `projected_qty` NULL, so `NULL < par_level` silently excludes | the view **coalesces**; `null_projected = 0`. Structurally impossible. |
| 3 | **String coercion** — `decimal`-as-`varchar`, so `<` compares lexically | both columns are `decimal(10,3)`; `as_written 61 = forced_numeric 61`. |

**And the actual answer was never a defect at all:** `has_incoming 18`, and `61 − 18 = 43`.
The 18 have open POs covering the shortfall.

## ⚠ THE ERROR THAT MADE ALL THREE POSSIBLE

The very first write-up contained this, under a heading claiming it was settled:

> **「Ruled out: 'they were already ordered' — it is false, measured, not assumed:
> `incoming_qty > 0` on 0 of the 43 returned rows.」**

**That was the right question, asked of a set that could not answer it.** The 43 are the rows
that passed `WHERE projected_qty < par_level` — that is, precisely the rows whose incoming
stock did *not* cover the shortfall. **Every row that would have said 「yes, already ordered」
had been removed by the filter before the check ran.**

> ## The check was run on a sample the check itself had already filtered.

The correct answer — 18 — was sitting in the rows that had been excluded, which is the only
place it could ever have been. And because that first check appeared to rule out the true
cause, three false ones had to be invented to explain what was left.

**The label made it worse than the mistake.** 「measured, not assumed」 is exactly the phrase
this project uses to mark a claim as trustworthy. It was attached to a check that was
structurally incapable of finding what it looked for. See **HR-12**.

## What actually remains — all three are real, none is this defect

1. **Two endpoints answer different questions and neither says which.**
   `/ai/inventory` → 「below par **now**」. `/ai/order-planning` → 「below par **after
   everything on order arrives**」. Both correct; the difference is undisclosed, and that is
   what made 61 vs 43 read as a defect for two days. **A naming and disclosure problem, not a
   data problem.** The honest fix is that each response states which question it answers —
   which is the one idea from the discarded patch worth keeping.
2. **The `:256` `catch`** — untargeted, swallows syntax/permission/timeout/disconnect alike
   and answers with plausible rows. Unchanged by any of this and still worth removing.
3. **`DEFECT-005`** — 77 of 199 rows carry `0000-00-00 00:00:00` in
   `inventory_live_state.last_movement_at`. Data hygiene, unrelated to the arithmetic, and the
   source of every one of the 77 warnings.

## The pattern worth carrying forward

Three causes, three refutations, **one afternoon, zero production changes**. The cost of being
wrong three times was a patch that never shipped. The cost of being wrong once with a deploy
would have been a restaurant ordering 18 items it already had on the way.

**Nothing here was caught by review. All of it was caught by measurement**, and every
measurement was one read-only query away the whole time.
