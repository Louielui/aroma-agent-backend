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

Measured separately. Until that is answered, this rule is a design intent, not a guarantee.

---

## What this does NOT settle

- **Identity.** A worker acting as itself and a worker acting as the Owner are different risk
  objects, and the sealed work order has no field for which — it assumes one kind, an agent
  with no identity at all in a disposable environment.
- **`costCapUsd`.** Calibrated for CLI tokens. Against a browser that can transact, the words
  "cost cap" mean something entirely different and the number is not transferable.

**Both are now designed out in `DESIGN-IDENTITY-DIMENSION.md`** — identity as the third class
of risk object, and the Owner's ruling that it comes *before* generalising the Agent Bridge.
