# DESIGN — DIRECT QUERY + BOUNDED ENQUIRY

> **Owner ruling, 2026-08-08: 「一句話一個來源」 stays as the fast path. It stops being the
> ceiling.」**

Design only. No code. Every number below is measured against the code as it stands at `7272bd2`.

---

## 0. CORRECTING THE FRAMING FIRST — YOU ARE RIGHT, AND THERE IS A THIRD THING

> 「you reported that the enquiry runner's rounds were planned by you, not by her. If that is
> still true, the missing piece is a planner, not a connection. Say which.」

**Still true, and the planner is the real gap.** But the honest answer is three things, not one:

| piece | state | evidence |
|---|---|---|
| the **runner** | built, bounded, tested | `agent/enquiryRunner.js`, 144 lines |
| the **planner** | **does not exist** | `next` is a *parameter*. Every test passes `next: plan([…])` — a hand-written array of goals |
| the **connection** | does not exist | `runEnquiry` has **zero** production callers. So does `claudeCodeWorker`, its intended dispatcher |

So: `next: (lastResult) => {done, goal}` is an injected function, and the only implementations
that have ever existed are scripted lists in tests. **The rounds were planned by me, in advance,
in the test fixture.** Connecting the runner without a planner would produce a loop that asks the
same question three times and bills for it.

### The third thing, which changes the shape

**The existing runner dispatches to Claude Code — a code agent, not the read layer.** It was
built for investigating this repo. 「今天 Costco 訂什麼」 is not a code investigation; it is
several reads of your own business data.

> The runner is the right SHAPE and the wrong WORKER. What follows reuses the shape — rounds,
> caps, 「stopping is not finishing」 — and replaces the worker with the six read endpoints that
> already exist. That change is what makes almost everything below cheap.

---

## 1. WHAT DECIDES DIRECT VERSUS ENQUIRY

> 「my instinct: the number of sources an intent names. But 「今天 Costco 訂什麼」 names one
> intent and needs three sources, so my instinct may be wrong. Measure rather than assume.」

### Your instinct is wrong, and the measurement says exactly how

Every intent in the table names **exactly one** source:

```
distinct source-counts across all ten intents: [1]
```

**The signal is a constant.** It cannot discriminate anything, ever. Not weak — zero information.

### But the corrected version of it is right, and it is free

The granularity is wrong, not the idea. Six different intents all name `aroma_system`, and they
name **six different methods**:

```
invoice→listInvoices  purchase_order→listPurchaseOrders  daily_count→listDailyCounts
supplier→listSuppliers  order_planning→listOrderPlanning  inventory→listInventory
```

**The unit is the METHOD, not the source.** And here is the part worth knowing:

> `intentFor()` already computes which intents match — and returns the FIRST, discarding the
> rest. The signal you want is being calculated and thrown away on every turn.

Counting all matches instead of the first, measured on real question shapes:

| n | intents matched | question |
|---:|---|---|
| 1 | order_planning | 今日要訂貨嗎 |
| 1 | inventory | 睇下倉存 |
| **3** | supplier, order_planning, inventory | 邊啲存貨低過安全線，要向邊個供應商補貨 |
| **2** | supplier, order_planning | 上個月邊間供應商加價最多，有冇影響我哋要訂嘅貨 |
| **2** | invoice, purchase_order | 呢張發票同採購單對唔對得上 |
| **3** | daily_count, order_planning, inventory | 今日盤點之後，倉存同訂貨建議有冇變 |

Free, deterministic, no model, no new vocabulary.

### ⛔ AND IT IS NOT SUFFICIENT — YOUR OWN EXAMPLE IS THE PROOF

```
n=0  今天 Costco 訂什麼
n=1  今天要向costco訂什麼貨                      → order_planning only
n=1  Costco 嗰邊而家要訂啲乜，同上次比貴咗幾多      → order_planning only
```

Your example needs order planning **and** the supplier record for Costco **and** arguably price
history. It matches one intent, or none. So:

> **n ≥ 2 is a reliable trigger for Enquiry. n = 1 does NOT mean Direct.** It is a one-sided
> test, and the side it is blind on is exactly the side your example sits on.

### So the tier is not decided up front. It is decided by the cheap path failing.

A classifier that decides in advance is M-5 again, and you are right that the failure would land
on the expensive path. The alternative uses machinery that already exists:

1. **Always start Direct.** One read, the intent's own method. This is today's behaviour and
   costs exactly what today costs.
2. **`answerPlan.js` already validates the model's plan against the evidence, and
   `evidenceGate.js` already refuses a conclusion the evidence cannot support.** When the cheap
   path cannot answer, that is not a guess — it is a recorded verdict about specific evidence.
3. **Escalate on that verdict**, plus the free `n ≥ 2` signal as an immediate trigger.

> **The tier decision is never a prediction about the question. It is a fact about whether the
> first read was enough** — which is knowable, cheap, and already computed.

That also fixes the failure mode you named: when the classifier is wrong, the cost is one extra
read, not a wasted enquiry.

---

## 2. YOUR BOUNDS — FIVE ARE RIGHT, ONE IS WRONG

| bound | verdict |
|---|---|
| max 3 read rounds | **right**, and now with a reason: the longest real dependency chain is inventory → order_planning → supplier. Three is the depth of the data, not a round number |
| **max 4 sources** | **WRONG — same granularity error as §1** |
| read-only | right, and structural — see §5 |
| each step records why that source was needed | right, and **free** under §3: the graph edge *is* the reason |
| stop as soon as it can answer | right, and under §3 it is deterministic, not a judgement |
| round 3 short → say what is missing | right, and the runner already does exactly this (`STOPPED_ON_BUDGET`, `notEstablishedOnStop`) |

### Why 「max 4 sources」 is the wrong bound

There is only **one** business source. Six methods live under it. A bound of 「4 sources」 is
satisfied by reading all six aroma_system endpoints plus Gmail plus Calendar — it would never
bind on the case you are trying to bound.

> **It should be 「max 4 READS」.** Count what you are paying for — HTTP calls against your data —
> not the folders they sit in. This is the same mistake as §1's instinct and the same fix:
> the source is too coarse to be the unit of anything.

---

## 3. WHAT THE PLANNER ACTUALLY IS — AND IT IS NOT A MODEL CALL

> 「Round N's result must decide round N+1's goal. Say honestly whether that is a model call per
> round — and if so, what a typical enquiry costs, because 「$0.62 per question」 changes when I
> would use it.」

**No model call per round. Not one.** The reason is structural, not clever:

> The set of possible next steps is a **closed set of six**, and the reasons to move between them
> are **joins**, not judgements. `listOrderPlanning` returns rows carrying supplier ids →
> resolving them is `listSuppliers`. `listInventory` returns items below threshold → what to do
> about them is `listOrderPlanning`. A planner over six nodes with known foreign keys is a
> **dependency graph**, and a graph walk is not thinking.

So the planner is a small static table: for each method, which fields it returns that are
*unresolved references*, and which method resolves them. Round N's output names round N+1's goal
because the ID it returned has exactly one place it can be looked up.

### What a typical enquiry costs

| | Direct (today) | Bounded Enquiry |
|---|---|---|
| model calls | 1 | **1** |
| business reads | 1 | 2–4 |
| planning cost | — | **$0** (graph walk) |
| marginal $ | — | **~$0** |

**A bounded enquiry costs approximately the same as a direct query.** The extra rounds are GET
requests against your own system; the model is called **once, at the end**, with more evidence in
front of it. The 「$0.62 per question」 worry belongs to a model-planned loop — which is what the
existing `enquiryRunner` was designed for, because its worker is a code agent that thinks per
round.

The extra cost is **latency**, not money: 2–4 sequential HTTP reads instead of one.

### Where the graph is not enough

It will not be, sometimes. The honest rule: **when the graph is exhausted and the question is
still not answered, that is a 「say what is missing」 outcome — not a prompt to start thinking.**
Adding a model planner later is a separate decision with its own GO, and it should be made
against logged cases of the graph running out, not in advance.

---

## 4. WHAT STOPS IT RUNNING AWAY

> 「You raised this yourself when the runner was built and it was never answered.」

I did, and the answer is that **§3 removes the premise rather than mitigating it.**

The runaway risk is real when the thing deciding whether to continue is the same model being
measured — it can always find one more thing worth checking, and every round it adds is a round
it gets paid for. Every mitigation for that is a leash held by the thing being leashed.

**Under a deterministic planner there is no deciding brain in the loop:**

- **continuing** is not a decision — it is 「this row carries an unresolved reference」
- **stopping** is not a decision — it is 「the graph is exhausted」 or 「the cap was reached」
- the model is called **once, after all reads are done**, and it cannot ask for another

The residual risks are ordinary and bounded, and none is a judgement call:

| risk | bound |
|---|---|
| a reference cycle in the graph | the graph is static and can be checked for cycles once, in a test |
| fan-out (100 rows → 100 supplier lookups) | cap on READS (§2), not on rounds — this is why the granularity matters |
| a slow endpoint | the per-read timeout that already exists |

> **The strongest thing this design does is make your question unanswerable-by-construction
> rather than answered.** If a later round needs a model to plan it, that is the moment this
> section stops holding, and it should be re-opened then rather than assumed to still apply.

---

## 5. WHAT IT MUST NEVER DO — STRUCTURAL, NOT BY RULE

> 「read-only, no writes, no dispatch, nothing irreversible — anything else goes through Proposal
> and Approval as today. Say whether the bounds enforce that structurally or by rule.」

**Structurally, and it already is — provided the worker is the read adapter and not the code
agent.** From `context/adapters/aromaSystemRead.js`:

```js
/** THE HTTP METHOD. One constant, used once. Nothing here takes a method argument. */
const METHOD = 'GET'
```

Its header records that `/api/v1/ai` also holds three POST draft routes and that they are
**deliberately absent — not commented out, not disabled by a flag**. There is no expression in
that module that can evaluate to `'POST'`.

So:

| prohibition | enforced by |
|---|---|
| no writes | **structural** — no method parameter exists; POST is unreachable from this module |
| no dispatch | **structural** — the worker is an HTTP reader; it has no dispatch surface at all |
| nothing irreversible | **structural** — a GET is the whole vocabulary |
| Proposal/Approval unchanged | **structural** — this path never touches `confirmService`, the one `agentRunner.run(` call site |

### ⛔ THE ONE PLACE IT WOULD BECOME 「BY RULE」

If the enquiry worker were `claudeCodeWorker` — the existing one — then read-only is enforced by
`READ_ONLY_TOOLS`, which is **a list**. A list is a rule wearing a constant, and this week has
been about the difference.

> **Recommendation, and the single most important line in this document: business enquiry must
> use the read adapters and must never be pointed at the code agent.** Not because the code agent
> is unsafe, but because it moves the guarantee from 「the method does not exist」 to 「the tool is
> not in the list」, and those fail differently.

---

## 6. WHAT I WOULD BUILD, IN ORDER

Nothing is built. This is the shape, smallest first, each with its own GO:

1. **Count all intent matches instead of the first.** ~5 lines, no behaviour change — just stop
   discarding it, and log `n`. **This is measurement, and it should run for a while before
   anything is built on it**, so the tier rule is chosen against your real questions rather than
   my nine invented ones.
2. **The dependency graph**, as data plus a cycle test. No runner, no wiring — just the table
   and the proof it terminates.
3. **A read worker for the existing runner**, replacing the code agent. This is where 「max 4
   reads」 and 「each step records why」 land.
4. **Escalation on the evidence verdict** (§1), which is the only part that changes what you see.

Step 1 answers a question the rest depends on, costs nothing, and is reversible. I would do that
one first and show you the numbers before designing step 2 in detail.

---

## 7. WHAT THIS DESIGN DOES NOT COVER

- **Cross-source enquiry** (aroma_system + Gmail + Calendar in one question). The graph in §3 is
  within one source, where the joins are real foreign keys. Joining an invoice to an email is not
  a foreign key and would need something else.
- **The n ≥ 2 blind side** (§1). Your Costco example still routes Direct under this design and
  escalates only when the evidence gate says the answer is unsupported. That is a real gap and
  the escalation is the mitigation, not a fix.
- **Whether the graph is ever enough.** It has never run. Nothing here has been observed working;
  it is a design, and the first honest measurement is step 1.

---

# THE FIRST REAL TEST IS NOT THE COSTCO QUESTION — 2026-08-08

> **Owner: 「orderPlanning already carries supplier_name, so the Costco question needs no join at
> all. That means the first real test of the enquiry layer is not the one I asked about. Say what
> question actually requires a multi-step read, because I would rather build against a real case
> than the one I happened to type.」**

He is right, and the reason is worth naming: **`order-planning` is already a pre-joined view.**
Measured, its rows carry `ingredient_name`, `supplier_id`, `supplier_name`, `live_qty`,
`par_level`, `incoming_qty`, `projected_qty`, `suggested_order_qty` and `order_lead_days`. The
server has already done stock × par × on-order × supplier. 「今天 Costco 訂什麼」 is **one read**,
and no enquiry layer would improve it.

That is a good outcome and it removes the motivating example. So what is left?

## WHAT DOES NOT NEED MULTIPLE READS (checked, not assumed)

| question | why one read |
|---|---|
| what to order today, from whom | `order-planning` — pre-joined, supplier named inline |
| what is below par | `order-planning` carries `par_level` and `live_qty` |
| what is on order already | `order-planning` carries `incoming_qty` |
| what is on an invoice | `invoices` carries `lineItems` inline |
| what was counted in a stocktake | `daily-counts` carries `items` inline |

Nearly every business question has a pre-joined view. **That is the honest reason the enquiry
tier is smaller than it looked.**

## ⛔ THE ONE THAT GENUINELY DOES — count versus system

> **「上次盤點嘅數，同系統而家嘅存量對唔對得上？」**
> (Does the last stocktake agree with what the system thinks we have?)

Two reads, no pre-joined view, and a real operational question — a variance between counted and
recorded stock is money and it is what a stocktake is FOR.

```
1. daily-counts  → items[] { ingredientId, ingredientName, countedQty, unit }
2. inventory     → { id, name, currentStock, unit }
   join on: daily-counts.items[].ingredientId → inventory.id
```

Why this one and not the others:

- **No view does it.** `order-planning` compares live stock to PAR, never to a COUNT.
- **Both sides are populated** — `ingredientId` in the snapshot, `id` in inventory, both required
  and non-empty in the sample.
- **The join key is real, not inferred** — `ingredientId` is already in `ID_FIELDS`, and unlike
  `invoices.supplierId` it has values on both ends (HR-56).
- **It is exactly two steps**, so it exercises the runner without needing depth 3.
- **The answer is a list of differences**, which is the shape that makes 「what I read」 easy to
  state and 「查齊了」 easy to avoid: 「我對比咗 N 項，其中 M 項對唔上」 names its own scope.

### A second candidate, one step harder

> **「上次落嘅單，收咗貨未？」** — `purchase-orders.items[]` against `daily-counts` or `inventory`.

Same shape, but `/purchase-orders` sits behind the 30-day `createdAt` window (DEFECT-009), so the
answer would silently exclude older open orders. **Not a good first test until that is resolved** —
it would test the enquiry layer against a source that is already lying about its scope.

## WHAT THIS CHANGES ABOUT BUILDING IT

The first enquiry is **stocktake-vs-inventory**, not order planning. That means:

- the join map needs **one** verified edge to start, not three
- depth 2 is enough for the first real case; the 3-round bound is not exercised yet
- and the measurement now running (intent breadth) should be watched for whether questions of
  this shape are even asked — `daily_count` and `inventory` co-occurring is exactly an `n=2` line
  in the log, and if it never appears, the enquiry tier has no customer.

> **The counter added today is the thing that will say whether this is worth building.** That was
> the point of putting measurement first, and it now has a specific pattern to look for rather
> than a general hope.
