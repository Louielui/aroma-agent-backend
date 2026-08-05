# When the worst case is an order, not a bad diff

**Owner ruling, 2026-08-05.** Recorded because it is the finding of the day and it is bigger
than Costco: it says what our whole safety story has actually been resting on.

---

## The sentence to keep

> ### 「forbiddenActions 由機制退化成意向」
> **`forbiddenActions` degrades from a mechanism into an intention.**

---

## What the safety story has actually been

Not the prohibition list. The prohibition list is a *description*. The safety came from the
environment making the forbidden thing impossible:

> `隔離方式：丟棄式副本，已移除所有 remote，改動無法回到 main`
> *(isolation: disposable copy, all remotes removed, changes cannot reach main)*

**`push` is not forbidden. There is nowhere to push.** Delete the clone and the consequence
ceases to exist. Every reassuring property of the Agent Bridge descends from that one fact.

## What a logged-in browser does to it

| | file edit | browser logged into a retailer |
|---|---|---|
| **isolation** | disposable clone, remotes removed | **none — the action lands on a live third-party system** |
| **how "must not X" is enforced** | **structurally** — no remote exists | **by intention** — the agent chooses not to click |
| **what the kill switch stops** | the process; the consequence dies with the clone | the process. **After Place Order is clicked, stopping it does nothing** |
| **what the audit records** | the diff — a complete account of the effect | *"we clicked submit."* **The order lives on their servers, not in our record** |
| **reversibility** | delete a file, free | maybe cancellable, maybe with a fee, maybe not at all |
| **same order run twice** | same result | **may differ** — price changed, out of stock, an interstitial appeared |
| **worst case** | a bad diff nobody applied | **money spent in the Owner's name** |

Every row is the same movement: a guarantee that was a property of the world becomes a
promise made by the agent. This project has spent a week removing exactly that gap between
what a record claims and what is true — and the browser reintroduces it wholesale.

## The structural equivalent, and why it is the answer

The browser equivalent of *a clone with no remotes* is **a browser profile with no payment
method**. No stored card, no wallet, no one-click.

Then "cannot spend" stops being a rule the agent follows and goes back to being a fact about
where it works. That is the same shape as the disposable clone, restored at the layer where
the money is.

---

## STANDING RULE — supersedes the wording of 2026-08-05 earlier the same day

The earlier rule was written by site:

> ~~log into her account anything for purchasing and supplier work — Costco, supplier
> portals. Never log in anything that can spend my money — TD Bank, CRA, Manitoba, personal
> Gmail. Nothing that pays, nothing that signs.~~

**Those two clauses collide.** A Costco account with a stored card is both "purchasing work"
and "can spend my money". The Owner accepted the sharper edge rather than the one he wrote:

> ### The line is not which website.
> ### **Her browser profile carries no payment method — or the final click stays with me.**

### The shape this gives

> **She prepares, I commit.**
>
> She fills a cart in a profile that cannot pay. I press the last button.

The Owner's own framing of why it works, and it is the part worth keeping:

> The structural isolation comes back — **not because she is restrained, but because the
> capability to spend is absent from where she works.**

### What still has to be true for this to be architecture rather than wishful thinking

**A Costco account must be able to exist with no payment method stored at all.** If the site
requires a card on file, the profile is not payment-free and the structural claim fails —
"she prepares, I commit" would then rest on the agent not clicking, which is exactly the
intention-not-mechanism failure above.

> ### ❌ SUPERSEDED, SAME DAY — see §「Two measurements closed this branch」 below.
> **The payment-method question is closed as MOOT, not deferred.** "She prepares, I commit"
> was resting on a cart the Owner could reach, and that cart does not exist. No authenticated
> look was ever taken and none is needed now.

---

# Two measurements closed this branch

**Owner conclusion, 2026-08-05, stated so it survives.** Both measurements are read-only,
unauthenticated, on costco.ca. Nothing was added to any cart.

## 1. A cart is session-bound — so 「she prepares」 could not have meant a cart

This is the most consequential thing measured, **and it would have been discovered after
building rather than before.** The whole "she prepares, I commit" shape assumed a cart she
fills and he finishes. A cart belongs to a session. So reaching it needs one of:

| route | what it costs |
|---|---|
| same account in both browsers | her profile carries **his identity** — excluded by the standing rule |
| same profile | same problem |
| **she hands him a LIST, not a cart** | **the only one that keeps the rule intact** |

The third is not a smaller version of the plan. **It is a different plan**, and it does not
need a browser at all.

## 2. Four actions, six judgements — the clicking was never the hard part

Measured on the live 「paper towel」 result set:

- **4 actions** from opening the site to Add to Cart. That is the entire automation problem.
- **6 classes of judgement a selector cannot make** — wrong category (101 results across 7
  categories, including Automotive & Tires), **wrong product** (result #4 was facial tissue,
  #7 was disinfecting wipes), fulfilment channel, stock at the specific warehouse, price
  ("After $6 OFF", and the cart page warns pricing may change at checkout), pack size.

> ### The Owner's reading, which is the finding
>
> **「A selector cannot decide that tissue is not a towel, and a real order is dozens of
> lines.」**

Four actions against six judgements per line, times dozens of lines. **The ratio is the
answer.** This was never an automation problem wearing a governance problem; it was a
judgement problem wearing an automation problem.

---

# THE CONCLUSION — recorded to survive the conversation

> ## Filling a Costco cart is not the thing to build.

> **「The value was never the clicking; it was knowing what to order. That is judgement, and
> judgement is what she is for — the browser was only how I imagined it reaching me.」**

> ### **「The gap was never the browser.」**

## What this reframes into

> **She tells him WHAT to buy, from the inventory she can already read.**
>
> 「Napa Cabbage 缺 45, Beef Plate 見底, 這是清單」 — and he does the ordering.

She already reads the restaurant system. **The output is a list, not a cart** — which is
exactly what measurement 1 said was the only route that keeps the standing rule intact. The
two measurements converge on the same shape from opposite directions.

**NOT STARTED. Owner: record the conclusion and stop.** The next session looks at the restock
list — par levels and computed 缺口 — as a shorter path to something he would actually use
than any amount of browser work.

## What is now closed, and what is not

| | |
|---|---|
| Costco cart automation | **CLOSED** — not the thing to build |
| "she prepares, I commit" (cart form) | **CLOSED** — rests on a cart he cannot reach |
| Costco payment-method question | **CLOSED as moot** — never measured, no longer needed |
| the standing rule 「nothing that pays, nothing that signs」 | **STANDS** — untouched by any of this |
| the order-vs-file table and 「forbiddenActions 由機制退化成意向」 | **STANDS** — a general finding about browsers, not about Costco |
| identity as the third class of risk object | **STANDS** — see `DESIGN-IDENTITY-DIMENSION.md` |

---

## What this does NOT settle

- **Identity.** A worker acting as itself and a worker acting as the Owner are different risk
  objects, and the sealed work order has no field for which — it assumes one kind, an agent
  with no identity at all in a disposable environment.
- **`costCapUsd`.** Calibrated for CLI tokens. Against a browser that can transact, the words
  "cost cap" mean something entirely different and the number is not transferable.

**Both are now designed out in `DESIGN-IDENTITY-DIMENSION.md`** — identity as the third class
of risk object, and the Owner's ruling that it comes *before* generalising the Agent Bridge.
