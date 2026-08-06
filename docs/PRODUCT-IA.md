# Product Information Architecture

<!-- record-status: ACTIVE 2026-08-06 -->

**DOCUMENT ONLY. Nothing here is authorised to be built.** 2026-08-06.

---

# 0. THE MAP IS NOT THE SIDEBAR

> ## The IA is the map. The sidebar renders only the parts of the map that already exist.

A workspace can live in this document for a year without appearing on screen. **That gap is
not a backlog — it is the mechanism.**

A sidebar item is a promise. It says 「there is something here」, and a person who clicks it
and finds a placeholder learns that the navigation lies, which is not a lesson that unlearns.
Keeping the map larger than the sidebar means the product can be *planned* without being
*claimed*.

**So the only question that ever admits a new sidebar item is: does something real exist
behind it today?** Not 「could she do this」. Not 「is it on the roadmap」.

---

# 1. THE ORGANISING IDEA — two layers, never conflated

**Recorded as the correction it came from**, because the first framing was wrong and the
correction is what the rest of this document is built on:

> **The question was first answered as 「which departments does she own」.**
> **That was the wrong question.** It merges what the Owner *sees* with how she *works*, and
> once merged, neither can be reasoned about — every discussion about a domain turns into a
> discussion about permission, and every discussion about permission turns into a map redraw.

> ## The right separation, and the organising idea of this document:
>
> | layer | what it answers |
> |---|---|
> | **UI workspace** | what the Owner sees, organised by **business domain** |
> | **execution mode** | how she handles the work behind it |

**A workspace CONTAINS several execution modes. Modes do not replace domains.**

「財務」 is a place. 「提案→你批准→執行」 is a way of working that happens inside it, alongside
reads that need no approval at all. A product that navigates by execution mode would put
「things needing approval」 in one room and 「things she can just tell you」 in another — and the
Owner would have to know *how* an answer is produced before he knows *where* to look for it.

**This distinction is the document's spine, not a footnote.**

---

# 2. THE SIDEBAR — six items

```
首頁 · 營運 · 財務 · 行政 · 系統 · 設定
```

## Two things that are deliberately NOT sidebar items

### 匯報 is not a destination — it IS 首頁

The Owner's own first principle is that the homepage is a **COO morning briefing**. Splitting
「匯報」 out as its own item empties one of the two: either 首頁 becomes a launcher with nothing
on it, or 匯報 becomes a second homepage nobody opens.

**One of them would win by accident.** They are the same thing, so they get one item.

### 工作與批准 is not a peer of 財務

**Every domain produces approvals.** An invoice approval is finance, a roster change is admin,
a code change is system. Making 「工作與批准」 a sibling of the domains implies approvals live
somewhere *else*, which they do not.

And the decisive argument is its failure mode:

> **The way approvals fail is that the Owner does not see them.**
> **A tab he must click into IS that failure mode.**

So it is a **persistent indicator, visible from anywhere** — not a room he has to remember to
enter. This is measured, not theoretical: pending proposals accumulated unseen more than once
this week and had to be cleaned by hand (`PROPOSAL-CANCELLATIONS.md`, six of them).

## In the map, not in the sidebar

**品牌與廣告** and **客戶服務** — planned domains. No data source, no capability, nothing
measured. They exist here so that when something real arrives it has a home, and so that
their absence from the sidebar is a decision rather than an oversight.

---

# 3. STATUS — two axes, because one list makes both ambiguous

## Axis A — DATA STATUS, per workspace

| status | meaning |
|---|---|
| **可用** | she can read it, and the read is proven |
| **唯讀** | she can read it and cannot change it — by construction, not by rule |
| **未連接** | the source exists but she has no path to it |
| **規劃中** | no source yet |

## Axis B — EXECUTION MODE, per **ACTION** — not per workspace

| mode | what happens |
|---|---|
| **她讀完告訴你** | a read and a sentence. No side effect anywhere |
| **提案→你批准→執行** | she prepares, he approves, then it runs |
| **自動執行後回報** | it runs, and he is told afterwards |

> ## 「Requires approval」 is NOT a capability state. It is an execution mode.
>
> A workspace can be **唯讀** and still contain actions that need approval — 營運 is exactly
> that today: every read is read-only, and moving a Drive folder would still need approval.
> Putting both on one axis makes 「唯讀」 mean two different things and 「需要批准」 mean two
> different things.

## ⚠ THE THIRD MODE DOES NOT EXIST ANYWHERE TODAY

**Stated plainly, because it is the largest governance step remaining.**

Nothing in this system runs and reports afterwards. Measured 2026-08-06:

- **no scheduler at all** — 0 `setInterval` / `cron` / `schedule(` in `src/`, no scheduling
  dependency. The four `Aroma*` Windows tasks are backup infrastructure, not hers;
- every path that acts requires a sealed order and a human approval;
- the Drive backlog line is mode 1 and computed **when he opens the page**.

**So the third mode is missing at two levels: the governance to permit it, and the trigger to
start it.** And it is not a small step, because it removes the human from the loop — which is
precisely the condition the approval gates exist for. The rules that would have to exist
first are already written: `DESIGN-SCHEDULED-SURFACE.md` §4 (on a timer, reads only) and
`DESIGN-WORKER-ADAPTER.md` (an `effect` result has no second gate).

---

# 4. PER WORKSPACE

## 首頁 — **RENDER NOW**

**Purpose.** The COO morning briefing. What needs him today, in the fewest words that are
true.

**What exists today** (live, `c2d99be`):
- the greeting, resolved in **his** timezone rather than the browser's;
- the **waiting-invoices line** — a real read of two Drive folders, with five states that
  never merge, a clear state that names the time it looked, and the caveat that it counts
  files rather than invoices;
- the **stale-tab banner** — the page compares its own build fingerprint against the server's.

**What does not exist.** Anything from 營運, 財務 or 行政. Today the briefing has exactly one
line in it, and that line is honest.

**First honest version.** Two or three more lines of the same shape — each one a real read,
each one silent only when the feature is off, each one naming what it did not look at.

## 營運 — in the map, **DO NOT RENDER YET**

**Purpose.** Stock, ordering, prep, recipes — the daily running of the kitchen.

**What exists today**, measured against the live API:
- `/ai/inventory` — 199 active ingredients with `currentStock` and `parLevel`. **No location,
  no as-of timestamp.**
- `/ai/order-planning` — below par **after** inbound stock. 43 rows today; 61 are below par
  ignoring what is on order, and the 18-row difference is open purchase orders.
- `/ai/daily-counts` — stock takes, **7-day window and a cap of 50, neither disclosed**.
- `/ai/suppliers` — active suppliers, delivery days, lead days.

**What does not exist.**
- **`parLevel` is 0 on 85 of 199 items** — 43% of the master is invisible to any par-based
  view.
- `category` is empty on 178 of 199 (`subCategory` is populated on all 199).
- No recipe or prep endpoint exists among the six she can read.
- No write path of any kind.

**First honest version.** The restock list: what to buy, grouped by supplier, stating its own
coverage — 「85 items have no par level」 rather than presenting 114 as the inventory — and
naming which stock question each number answers.

## 財務 — in the map, **DO NOT RENDER YET**

**Purpose.** Invoices, costs, prices, spend.

**What exists today.**
- `/ai/invoices` and `/ai/purchase-orders` — both windowed **30 days on the ENTRY date**, cap
  100. `DEFECT-006`: they answer 「entered recently」 while every reader hears 「dated
  recently」.
- The invoice intake pipeline runs in `aroma-system` and **works** — classification, the
  approval queue, the dual-write to price book and ingredient master.

**What does not exist.**
- **`latest_price` on 4 of 43** order-planning rows; roughly 90% of linked ingredients are
  unpriced. **No costing conclusion is available**, and one built on this data would be
  confident and wrong.
- No bank connection. No P&L. No recipe cost roll-up.
- **The pipeline is idle for a reason that is not technical**: 1 invoice ingested in 30 days
  while 64 files wait in Drive.

**First honest version.** Supplier spend over a period, with the window it actually used
stated in the answer.

## 行政 — in the map, **DO NOT RENDER YET**

**Purpose.** People, rosters, scheduling, the things that are neither kitchen nor money.

**What exists today.** Almost nothing. Gmail and Calendar read scopes are live and unused for
this domain.

**What does not exist.** 7shifts is not connected. There is no roster data anywhere in the
system.

**First honest version.** The roster — **and this is the one workspace with a clear case for
a page**, see §5.

## 系統 — **RENDER NOW**

**Purpose.** How she works. Not a business domain — the machinery, and the record of what she
did.

**What exists today.**
- **Read connectors**: Drive, Gmail, Calendar, GitHub, aroma_system — all read-only by
  construction (`aromaSystemRead.js`: one constant `method: 'GET'`, a frozen path list, no
  write route reachable).
- **Agent Bridge** — sealed work orders, the WYSIWYA card, a durable approval audit in the
  truth store.
- **The four-flag matrix** — any two of `WORKER_INVOCATION` / `DEVELOP_DISPATCH` /
  `AGENT_BRIDGE` / `COMPUTER_OPERATOR` on → `configuration_conflict` → zero execution.
- **The build stamp / stale-tab guard.**

**What does not exist.**
- **Computer Operator is unwired** — `COMPUTER_OPERATOR` has 0 references in the running app,
  and 14 of its 24 modules are absent from this repo.
- **No scheduler** (§3).
- The **worker adapter** is designed, not built — and by its own entry rule the browser
  worker is **refused**, not pending.

**First honest version.** What ran, what she read, and what is awaiting approval — the last
of which is the persistent indicator, not a page.

## 設定 — **RENDER NOW**

**Purpose.** Timezone, style, preferences, feature flags.

**What exists today.** `/settings`, `GET`/`POST /api/v1/settings`. The write path accepts
exactly three keys and a closed list of switch names — nothing the browser invents becomes a
setting.

**What does not exist.** No per-workspace configuration, because there are no workspaces yet.

---

# 5. WHAT RENDERS, AND THE RULE BEHIND IT

**RENDER NOW:** 首頁 · 系統 · 設定
**DO NOT RENDER YET:** 營運 · 財務 · 行政

> ### Not for lack of capability. She answers those better in conversation today.

> ## A workspace earns a page when it has something conversation does BADLY.
> ### **A roster is that. A stock number is not.**

A stock number is one sentence, and a sentence is what a conversation is made of. Asking
「Napa Cabbage 仲有幾多?」 and getting an answer is *better* than navigating to a page — the
page adds a click and subtracts nothing.

A roster is a grid: seven days across, N people down, and the thing the Owner needs is the
*shape* — who is doubled up, where the gap is. **Reading a grid aloud is worse than showing
it.** That is what earns a page.

**The test, stated so it can refuse:** if the workspace's answer fits in a sentence, it does
not need a page. If it needs a grid, a calendar, or a side-by-side comparison, it might.

---

# 6. THE GROWTH RULE

> ## New capability lands in an EXISTING domain. It does not open a new item.

| new thing | where it lands | why |
|---|---|---|
| 7shifts | **行政** | it is scheduling; scheduling is admin |
| bank read-only | **財務** | it is money |
| browser worker | **系統** | **a way of working, not a business domain** |
| Computer Operator | **系統** | same |
| a supplier portal reader | **營運** | it is ordering |

> ## A new sidebar item opens ONLY when a PLANNED DOMAIN gains its first real thing.
> ### Not when she could theoretically do it.

「品牌與廣告」 becomes an item when there is a real thing in it — not when a connector *could*
be added, not when it is agreed to be a good idea, and not when a design exists for it. **A
design is not a real thing.** This document is full of designs, and none of them has earned a
sidebar item.

## This rule exists to REFUSE, and here is how to tell it is working

Every one of these is a refusal, and each is the kind of proposal that sounds reasonable in
the moment:

- 「Computer Operator is big enough to deserve its own item」 — **no.** It is a way of working.
  系統.
- 「The browser worker is a whole new capability」 — **no**, and it is currently *refused
  outright* by the worker-adapter entry rule, so an item for it would be a promise the
  governance actively forbids.
- 「Approvals are important enough to be a tab」 — **no.** Importance is an argument for
  *visibility*, and a tab is less visible than an indicator.
- 「We should add 匯報 so the briefing has a home」 — **no.** It already has one: 首頁.
- 「Add 客戶服務 now so the structure is ready」 — **no.** An empty room teaches the Owner that
  the navigation lies.

> ### **If the sidebar is still six items in a year, that is the rule working — not the product stalling.**

The measure of this rule is not how many items get added. It is how many *did not*, and
whether anything real ended up with nowhere to live. **The second number is the one that
would mean the rule is wrong.**

---

# 7. WHAT THIS DOCUMENT IS NOT

It is not a build plan, a roadmap, or an authorisation. **Nothing in it may be built on the
strength of appearing here.** A workspace listed as 規劃中 has no more standing than a
sentence in a conversation; the difference is only that it will still be here next month.
