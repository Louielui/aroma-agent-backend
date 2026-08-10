# B — THE GOAL DECOMPOSER: DESIGN

**Owner GO, 2026-08-10: design only.** Detector work parked, recorded where it stands.

> **Owner: 「Two weeks of correct work has produced nothing I can use. I would rather have the
> reasoning layer working over imperfect evidence than perfect evidence with nothing reasoning
> over it. I am overruling myself on the sequencing, not on the risk.」**

---

## 0. ⛔ B IS NOT A SECOND REASONING LOOP

`src/intake/reasoningLoop.js` **already exists and is already wired** — `intakeService.js:1172`.
It runs Reason → Read → Observe → Reason → Final, bounded at `MAX_REASONING_STEPS = 3`, picking
from a closed capability vocabulary, failing closed on anything unrecognised.

This is the third time the same trap has been available in three phases: don't build a second
browser engine, don't build a second evidence vocabulary, **don't build a second loop.**

### So what is actually missing

The existing loop is **greedy and myopic**. At each step it chooses one next read. It has no point
at which it can say 「this question needs three facts, and one of them does not exist in this
system」. It discovers unavailability by wandering into it, or never.

**B runs ONCE, before the loop, and produces a REQUIREMENT — not an action.** The loop keeps
owning execution and its own bounds. B owns the statement of what the question needs.

That is the whole difference, and it is why B is worth building.

---

## 1. WHAT B RECEIVES AND RETURNS

### Receives

| | |
|---|---|
| the Owner's question | verbatim string |
| the **operation catalogue** | generated from the frozen `readOperations` / `aromaSystemRead` tables — per operation: label, the fields it carries (`METRICS_OF`), `rowShape` (hasLocation / hasAsOf / note), `queryScope` (field + **window**), server limit |
| **not the data** | B never sees a row. It plans; it does not read. |

### Returns — structured output, schema-forced

```jsonc
{
  "question_restated": "…",          // what B understood; the Owner can catch a misread here
  "facts": [                          // ⛔ BOUNDED: max 4, matching the max-4-reads bound
    {
      "id": "shortfall",
      "need": "which items are below par and by how much",
      "operation": "aroma_system.replenishment",   // enum member, or null
      "fields": ["live_qty", "par_level", "suggested_order_qty"],
      "status": "AVAILABLE" | "PARTIAL" | "UNAVAILABLE",
      "unavailable_reason": null
    }
  ],
  "joins": [                          // the part no view provides
    { "from": "aroma_system.daily_counts", "to": "aroma_system.inventory",
      "on": "ingredientId", "status": "UNVERIFIED" }
  ],
  "sufficient": false,
  "missing": ["倉存數字冇時間戳，無法同某一次盤點對齊"]
}
```

`A` then expands from this: each `AVAILABLE` fact is one read the existing loop performs, within
its existing bounds. **Nothing in B executes anything.**

---

## 2. WHAT STOPS IT ASKING FOR FACTS THAT DO NOT EXIST

Three layers, and **only the first involves the model's judgement at all**.

### (a) The operation enum is closed — kills invented operations

B picks from the same frozen table the loop already uses, handed over as a **schema enum**. It
cannot name `aroma_system.costing`, because the enum has no such member. There is no costing
operation, so a costing fact structurally cannot be mapped to one.

**The rule that makes this bite:** a fact whose `operation` is `null` ⇒ `status: UNAVAILABLE` ⇒ it
joins `missing` ⇒ `sufficient: false`. **B does not decide unavailability. The absence of an enum
member decides it**, deterministically, server-side.

### (b) The FIELD list must be closed too — this is the gap the enum leaves

B could legitimately name `aroma_system.replenishment` and then ask it for `supplier_name`, which
may not be on that row. So the catalogue carries the per-operation field list, and **the server
validates every returned field name against it**, downgrading unknown fields to `UNAVAILABLE`
after the call. Deterministic and post-hoc — never the model's honesty.

### (c) ⛔ NO NEAREST-NEIGHBOUR SUBSTITUTION

**A fact is satisfied by the operation that carries the field, or it is UNAVAILABLE.** B may not
answer a costing need from `invoices` because invoices are nearby and have money on them. That is
「a plausible answer against the wrong table」 — the `supplierId` finding in HR-56, which produced
an answer rather than a failure and is the more dangerous kind.

### (d) Joins are DECLARED and UNVERIFIED until a captured response says otherwise

House rule already on the books: *a field name is evidence a relationship MIGHT exist; every
declared edge is VERIFIED against a captured response before anything traverses it.*

`daily_counts` and `inventory` both carry `ingredientId`. **That is not evidence the join holds.**
B declares the edge; the server marks it `UNVERIFIED`; an unverified edge cannot make a fact
`AVAILABLE`.

### (e) And a deterministic hazard the model is not asked about: SCOPE

`queryScope.window` is on the catalogue. `daily_counts` is windowed to **last 7 days**. So
「上次盤點」 is unreadable if the last count was eight days ago — and that is computable from the
table, not from the sentence. The server attaches scope hazards to the plan; B is never asked to
notice them.

---

## 3. WHAT IT COSTS PER QUERY

**Measured on the first real run. Not estimated here** — Owner instruction, and the right one.

What the design does to keep it small, so the measurement has something to measure:

- **one call**, before the loop, never inside it
- the prompt is the question plus a catalogue **generated from frozen tables**, not prose — six
  operations, their fields and shapes. It grows only when an operation is added.
- **B never receives data rows**, which is what would actually make a prompt expensive
- output bounded to 4 facts by schema

Instrumented on the first run: input tokens, output tokens, provider, model, wall time, and the
cost, recorded next to the plan it produced.

---

## 4. THE TWO ACCEPTANCE CASES, AND WHAT I EXPECT THEM TO DO

### Case 1 — Costco: shortfall × supplier × incoming

| fact | operation | expectation |
|---|---|---|
| shortfall | `aroma_system.replenishment` — `live_qty`, `par_level`, `suggested_order_qty` | **AVAILABLE** |
| incoming | `aroma_system.replenishment` — `incoming_qty` | **verify on first run.** A real reply already referenced `incoming_qty`, so it is very likely on the row, but 「a real reply mentioned it」 is not an audit |
| supplier | edge to `aroma_system.suppliers` | **UNVERIFIED.** `supplierId` exists as a field name and was measured **empty** on invoices on 2026-08-08. Whether it resolves on replenishment is unmeasured |

**Likely first-run result: shortfall and incoming answered, supplier linkage declared unverified.**
That is a genuinely useful answer and it is probably reachable in the first build round.

### Case 2 — 「上次盤點同存量對唔對得上」

| | |
|---|---|
| join | `daily_counts` × `inventory` on `ingredientId` — **UNVERIFIED** |
| scope | `daily_counts` windowed to last 7 days; 「上次」 may fall outside it |
| ⛔ the real blocker | `inventory.rowShape.hasAsOf === false` — 「每項有一個存量數字，但冇分地點、亦冇記錄係幾時嘅」 |

**A timestamped count cannot be reconciled against an untimestamped stock number.** You cannot say
they agree or disagree, because you do not know when the stock number is from. That is derived
from `rowShape`, deterministically.

> **Expected result: `sufficient: false`, missing = 「倉存數字冇時間戳，無法同某一次盤點對齊」.
> THAT IS A PASS.** It is the system finally saying why the question cannot be answered, instead of
> producing a comparison that looks like an answer. If it is read as another failure, the whole
> point of B is lost.

---

## 5. BOUNDS

Unchanged and inherited, not re-implemented: read-only; max 3 rounds; max 4 reads; stop when
sufficient; say what is missing when it is not. The loop already enforces the first three. B
expresses the fourth at plan time instead of discovering it at step three.
