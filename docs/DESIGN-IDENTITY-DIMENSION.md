# Identity — the third class of risk object

**Owner ruling, 2026-08-05: identity comes BEFORE generalising the Agent Bridge.**

> Generalising a shape that cannot say who is acting would just spread that assumption to two
> more workers.

**Design only. Nothing built.** Companion to `GOVERNANCE-BROWSER-VS-FILE.md`, which records
the other half of the same day's finding.

---

## Why this is a class, not a field

The sealed work order has no place to say who is acting. That is measurable:

```
approvalId · goal · branch · allowedFiles · allowedTestCommand · forbiddenActions
timeoutSec · costCapUsd · approvalTtlSec · currentExcerpt · intendedChange
```

Nothing about identity. And the audit's `who: 'louie'` is the **approver**, not the actor.

**Adding a field would not fix it**, and this is the load-bearing point. `costCapUsd` and
`forbiddenActions` were both calibrated for one case — an agent with no credentials in a
disposable environment. Their *meanings* change per identity, not just their values. A
discriminator on one schema invites carrying `costCapUsd: 0.50` into a case where it is not a
limit at all.

**So identity should select WHICH ORDER SCHEMA APPLIES**, not annotate a shared one. Three
order types with different required fields, because the fields mean different things.

---

## Case 1 — NO IDENTITY

*A throwaway clone with no credentials. Today's case, and the only one that works.*

| | |
|---|---|
| **sealed order** | Unchanged. `allowedFiles`, `branch`, `forbiddenActions`, caps, TTL. |
| **`costCapUsd`** | **Model tokens.** Our own money, our own API, enforced by our own runner. The number means exactly what it says. |
| **`forbiddenActions`** | **STRUCTURAL.** No remotes ⇒ push is impossible. Protected paths ⇒ credential files unreachable. Disposable clone ⇒ nothing escapes. The list *describes* what the environment already prevents. |
| **audit** | **Complete as built.** The diff fully describes the effect, and the effect is local. `who` is unambiguous because only one party acted. |

**Nothing is missing here.** This is the case the governance was designed for and it holds.

---

## Case 2 — OWN IDENTITY

*An external service acting as itself. Consequences attributable to it. (Manus.)*

| | |
|---|---|
| **sealed order** | Needs a **named principal**, what that principal is entitled to, and the **attribution boundary** — actions land on external systems under *its* name, not ours. |
| **`costCapUsd`** | **Two currencies, neither enforceable by us.** What we spend with the service, and what the service spends on our behalf. We can *declare* a cap; they enforce their own. The field degrades from a limit to a request — the same mechanism-to-intention slide as `forbiddenActions` in a browser. |
| **`forbiddenActions`** | **Mostly declaration.** We cannot remove remotes from someone else's machine. **The one structural lever left is what we TRANSMIT:** a credential never sent cannot be used. So the control moves from *the sandbox we build* to *the grant we make*. |
| **audit — what is missing today** | The external **principal id**. The **request as sent**, so attribution is provable later. The external **job/run id**, so their record and ours can be reconciled. And, explicitly, **that our record is now one side of a two-sided event** — today's audit assumes it is the whole account. |
| **also missing** | **Result provenance.** Today the result is a patch we hold and can verify. From an external worker it is a *claim they make*. It must be marked attested-by-them, never recorded as observed-by-us. |

---

## Case 3 — THE OWNER'S IDENTITY

*Acting as Louie. Every action is indistinguishable from his to the counterparty.*

| | |
|---|---|
| **sealed order** | Needs an explicit, **per-order impersonation grant** — not a flag but a scoped statement: what may be done as him, on which origin, for how long. Should be the **narrowest and shortest-lived** of the three. |
| **`costCapUsd`** | **Meaningless as written, and dangerous as a name.** It was a token budget. The cap that matters here is transaction value, which we cannot observe — a browser does not tell us what a click costs. **Better absent and admitted absent than carrying a number that reads as protection.** A `costCapUsd: 0.50` on an order that can place a $400 order is worse than no field. |
| **`forbiddenActions`** | **Almost nothing is structural.** This is what `GOVERNANCE-BROWSER-VS-FILE.md` is about. Two levers survive, and both are environmental rather than declarative: a **profile with no payment method**, and a profile **only ever logged into the permitted origin**. |
| **audit — what is missing today** | The **origin acted upon**. The **ordered list of actions and their targets**. And that they were performed **as the Owner**. |

### ⚠️ `who` IS ALREADY OVERLOADED THE MOMENT CASE 3 EXISTS

Today `who: 'louie'` means **the approver**. In case 3 the actor is also, to the counterparty,
Louie. **One field, two meanings, silently** — and six months later "who did this" must not
resolve to "the agent" when Costco's record says Louie.

That is precisely the class of defect this project spent the week removing: a record that
reads as an answer while carrying two. **`who` must split into `approvedBy` and `actedAs`
before case 3 is built, not after.**

---

## Which of the three can the current governance honestly carry

> ## Only the first.

Not by a shortfall of degree — by kind. Five separate properties are true only for case 1:

1. the order shape has no identity field at all (measured);
2. `costCapUsd` is denominated in the one thing case 1 spends;
3. `forbiddenActions` is enforced by an environment we control only in case 1;
4. the audit's completeness assumption — *the diff is the effect* — holds only in case 1;
5. `who` is unambiguous only in case 1.

**It is not one-third built.** Cases 2 and 3 need different KINDS of control, not more of the
same one. Case 1 contains, case 2 grants, case 3 removes capability from the environment.
Three mechanisms, not three settings.

---

## Consequence for the sequence

Generalising the Agent Bridge is still the right first step **once identity exists** — it is a
working reference implementation, which beats two integrations that are names on a roster.
But it must be generalised over a shape that can state who is acting, or it will carry the
no-identity assumption into two more workers and look correct while doing it.

---

## Appendix — a structural wrinkle in "she prepares, I commit"

Measured 2026-08-05 on costco.ca, unauthenticated: **a cart is session-bound**, and the whole
browse/search/add flow works with no account at all.

So if she fills a cart in her own profile, **the Owner cannot press the last button — it is
not his cart.** Reaching it requires one of:

- the same account in both browsers → her profile carries his identity, which the standing
  rule excludes;
- the same profile → same problem;
- **she hands him a list, not a cart** → he builds the cart himself.

**Only the third keeps the rule intact**, and it is a materially smaller prize than "she fills
the cart". Recorded before anything is built on the larger assumption.
