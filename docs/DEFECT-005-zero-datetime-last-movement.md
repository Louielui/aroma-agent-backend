# DEFECT-005 — 77 of 199 rows carry a zero datetime

<!-- record-status: ACTIVE 2026-08-05 -->

**Repo: `aroma-system` (production). Recorded, NOT fixed.**
**Found 2026-08-05, incidentally — it was the source of the 77 warnings that appeared on every
query touching `inventory_projected_state`.**

---

## Measured

```
All 77 warnings: 'Incorrect datetime value: 0000-00-00 00:00:00 for last_movement_at'
```

`inventory_live_state.last_movement_at` holds `0000-00-00 00:00:00` on **77 of 199** rows —
39% of the active ingredient set.

Column types alongside it, captured at the same time:

```
inventory_live_state.live_qty     decimal(36,4)
inventory_live_state.legacy_qty   decimal(10,3)
inventory_live_state.drift        decimal(37,4)
inventory_live_state.movement_count
inventory_live_state.last_movement_at   ← the zero dates
```

## Why it is worth recording rather than ignoring

1. **It is noise that hides signal.** Every query against the view emits 77 warnings. A real
   warning arriving among them would be invisible — and warnings were the thing that made the
   `DEFECT-001` investigation look like it had a data problem when it did not.
2. **`0000-00-00` is not a date.** Under MySQL's default `sql_mode` (`NO_ZERO_DATE`) it is
   rejected on write, so these rows predate the current mode or were written around it. Any
   code doing date arithmetic on the column gets an error or a nonsense answer, not a null.
3. **It is a coverage question, not just hygiene.** 77 ingredients with no last-movement
   timestamp plausibly means 77 ingredients with **no ledger movements at all** — which would
   be worth knowing on its own, given `live_qty` is derived from that ledger.

## Not investigated

Whether the 77 rows with a zero date are the same 77 with `movement_count = 0` has **not**
been checked. If they are, the column is simply unset for never-moved items and the fix is
`NULL`, not a date. If they are not, something wrote a zero date over a real one.

One read-only query settles it:

```sql
SELECT COUNT(*)                                                        AS total,
       SUM(last_movement_at = '0000-00-00 00:00:00')                   AS zero_date,
       SUM(movement_count = 0)                                         AS no_movements,
       SUM(last_movement_at = '0000-00-00 00:00:00' AND movement_count = 0) AS both
FROM inventory_live_state;
```

**Not urgent.** Nothing depends on this column today that has been observed to break. It is
recorded so the 77 warnings are never again mistaken for evidence about something else.

## Related

`DEFECT-001` — disproven; the warnings encountered during that investigation were entirely
this, and nothing to do with the arithmetic being examined.
