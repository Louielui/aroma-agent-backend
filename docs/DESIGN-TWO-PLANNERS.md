# TWO PLANNERS, NAMED — and a correction to what I told you

> **Owner: 「Last round you concluded the planner should be DETERMINISTIC… I approved on that
> basis. But step 4 tests principle transfer… A graph walk does not do that.」**

**You are right, and my previous answer was too broad.** I said 「the planner is not a model
call」 and 「$0」. That is true of ONE planner and I generalised it to 「the planner」, which is
what your approval rested on. Correcting that here, before anything is built.

---

## 1. THE MEASUREMENT THAT SETTLES IT

A deterministic walk can only move along a reference. From the shapes captured 2026-08-08:

| endpoint | outbound references |
|---|---|
| `inventory` | **NONE — sink** |
| `suppliers` | **NONE — sink** |
| `dailyCounts` | `items[].ingredientId` → inventory |
| `orderPlanning` | `ingredient_id` → inventory, `supplier_id` → suppliers |
| `purchaseOrders` | `supplierId` → suppliers |
| `invoices` | `supplierId` → suppliers **(DEAD — null in every sampled row)** |

**The graph is DIRECTED, and the two most-queried entities are sinks.** Where real questions
actually land:

```
inventory      moves=0  DEAD END   睇下倉存
inventory      moves=0  DEAD END   存貨夠唔夠
suppliers      moves=0  DEAD END   邊個供應商最貴
dailyCounts    moves=1             上次盤點同系統存量對唔對得上
orderPlanning  moves=2             今日要訂咩貨
```

> **A walk starting at `inventory` has nowhere to go.** Not 「few options」 — zero. And which node
> it starts at is decided by the order of the INTENTS table, not by the question.

So the deterministic planner is narrower than I described. It is not 「a graph over six nodes」;
it is four nodes with outbound edges, three of them pointing at the same two sinks.

---

## 2. THE TWO PLANNERS

Different operations, not two strengths of one thing.

### PLANNER A — REFERENCE RESOLVER (deterministic)

**Answers:** *what else is implied by what I already have?*
In: rows I hold. Out: the endpoint that resolves an unresolved id. Cost: $0. Terminates when the
graph is exhausted.
**Cannot choose where to start. Cannot move against the arrows. Cannot decide that a question
needs a node nothing points to.**

### PLANNER B — GOAL DECOMPOSER (a model call)

**Answers:** *what facts would answer THIS question?*
In: the question, plus the six endpoints and what they hold. Out: a starting SET.
**This is the one that does transfer**, because it is the only one that holds the question at all.

> A resolves references. B chooses which facts matter. They compose — B picks the starting set, A
> expands it mechanically — but **neither substitutes for the other.**

---

## 3. WHAT STEP 4 CAN AND CANNOT MEASURE WITH A ALONE

### Measurable

| criterion | why |
|---|---|
| max 3 rounds | depth is countable |
| max 4 reads | reads are countable |
| read-only, no writes, no dispatch | structural, and independent of the planner entirely |

### Measurable but DEGENERATE

| criterion | why it does not mean what it looks like |
|---|---|
| 「each step records why that source was needed」 | With A the reason is ALWAYS 「a row carried reference X」. True, and never 「because the question needed it」. The field would be populated on every step and carry no information about judgement — **a green column measuring the mechanism instead of the thing it names**, which is the shape HR-53 keeps finding. |

### NOT measurable with A

| criterion | why not |
|---|---|
| 「stop as soon as it can answer」 | A stops when the graph is exhausted. That coincides with 「can answer」 only by accident. **Your own observation, and it is exactly right.** |
| 「if round 3 is still short, say what is missing」 | A can say *the graph ran out*. It cannot say *what the question needed and I could not get*, because it never held the question. |
| **principle transfer** | **Not at all.** A has no representation of what is being asked. On a novel question it does exactly what it does on a familiar one: follow references from wherever the intent table dropped it. Nothing in it could be right or wrong about a question it has not seen. |

### A harder limit than any of those

For the three dead-end questions in §1, **A cannot demonstrate even the measurable criteria**,
because it never takes a second step. Testing the bounds on 「睇下倉存」 measures nothing: one
read, zero moves, stop.

> **Step 4 with A alone tests that the fence holds. It cannot test that anything thinks.**

---

## 4. WHAT B COSTS — the $0 figure corrected

**B is one model call per ENQUIRY, not one per round.** That distinction preserves most of what I
claimed, and I should have stated it that way the first time.

| | model calls |
|---|---:|
| Direct (today, and after this) | 1 |
| Enquiry, A only | 1 |
| **Enquiry, A + B** | **2** |

**Not linear in rounds.** The loop still contains no model: B runs once, up front, names a
bounded set out of six, and A does every subsequent step. HR-55 is unaffected — B cannot ask for
another round; it produces one list and stops.

### Two ways to pay for B, and neither is $0

1. **An extra field on the call that already happens.** The model already returns a reply and an
   answerPlan; add 「which endpoints would answer this」. Costs **input tokens on every turn** —
   the six endpoint descriptions must be in the prompt — including Direct turns that never
   escalate. No new request.
2. **A second call, only when the evidence gate says the first read was not enough.** Costs **one
   full call on escalated turns only**, nothing on the rest.

**(2) matches the escalation design better** and confines the cost to turns that already failed
cheaply. Which is cheaper in practice depends on how often escalation fires — **which is exactly
what the counter shipped in step 1 will tell us.**

**I am not giving you a dollar figure.** I do not have current per-token pricing in front of me,
and inventing one is how 「$0.62」 became a reason to be careful about the wrong thing. What is
precise: **one additional call on escalated turns, small prompt, bounded output**, and
`recordLLMUsage` already meters every call — so the real number is measurable the day it runs
rather than estimated now.

---

## 5. WHAT THIS CHANGES

- **The two planners are named separately from here on.** 「The planner」 is not a term I will use
  again.
- **A is worth building for the known questions.** Stocktake-vs-inventory is a real two-step case
  and A handles it, because `dailyCounts` has an outbound edge.
- **B is a separate decision with its own GO.** It is the one that costs money and the one that
  makes transfer testable. It must not be smuggled in as 「finishing the planner」.
- **Step 4 on A alone must be described as what it is:** a test of the bounds and the reporting
  discipline, not of reasoning. Calling it a transfer test would be a green assertion that lost
  its meaning.

## 6. THE ONE-LINE VERSION

> A graph walk cannot fail an unfamiliar question — it does not know a question is being asked.
> Testing transfer needs the thing that chooses what to look for, and that thing is a model call.
> It is one call, not one per round, and it is a separate approval from the one you gave.
