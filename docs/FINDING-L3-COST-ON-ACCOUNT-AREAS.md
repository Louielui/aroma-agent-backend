# The real cost of L3, measured on the first logged-in errand

<!-- record-status: ACTIVE 2026-08-06 -->

**Step 5 ran with all four layers live. It stopped, and the reason changes the picture of what
L3 costs.**

---

# WHAT HAPPENED

```
probes at launch   payment CLEAN · cardSaving DISABLED · signIn BLOCKED · lock FREE
navigate           www.costcobusinesscentre.ca              ARRIVED
read_page          105 nodes                                LOOKS SIGNED IN
click              link "Orders"                            CLICKED
read_page          the orders page                          5 nodes
                   heading "www.costcobusinesscentre.ca is blocked"
                   ERR_BLOCKED_BY_CLIENT
```

**`ERR_BLOCKED_BY_CLIENT` is L3's own abort.** The refused request:

```
⛔ NAVIGATION (document):  POST https://www.costcobusinesscentre.ca/OAuthLogonCmd
```

## And the GET route hits the same wall

The page offers an ordinary anchor — `/myaccount/#/app/…/orders` — **a plain GET, no form.**
Navigating straight to it, with no fence change:

```
landed: chrome-error://chromewebdata/     ERR_BLOCKED_BY_CLIENT
```

**The account area performs the same `POST /OAuthLogonCmd` handoff however you enter it.**

> ## There is no read-only path to the order history. Reading it requires a POST.

---

# ⛔ THE FINDING — L3's cost is not what the six-site measurement suggested

**Measured earlier:** L3 free across six public sites, 51 writes refused, no page lost content.
I wrote that the unpaid cost would be 「a site whose search runs over GraphQL」.

**That was too narrow.** The real cost:

> ### Account areas commonly gate READS behind a POST auth handoff — and account data is exactly what a logged-in errand exists to reach.

| where L3 was measured | what it cost |
|---|---|
| six public pages | **nothing** |
| the first logged-in account area | **the errand** |

**The public web is mostly `GET`. The logged-in web is not.** L3's design premise — 「reading is
GET, almost everything irreversible is not」 — holds for the half of the web we measured it on
and does not hold for the half we built it for.

## NOT WIDENED — the Owner's ruling, and it stands

> **Owner: 「Do not widen allowedWrites for the auth path. You were right that it is where the
> three wrong fixes look most reasonable.」**

The refused request is `OAuthLogonCmd` — an OAuth logon handoff. **That is the auth path**, and
opening it would be the first of the three fixes written down in advance precisely so it could
be recognised in the moment.

**So the errand does not complete. That is ④ accept the ceiling**, and it is a real ceiling
rather than a bug.

---

# WHAT THIS LEAVES ON THE TABLE — stated, not resolved

**Three shapes, and none is being built:**

1. **Accept it.** Logged-in reading works wherever the account area is `GET`-served; it does
   not work where the site uses a POST handoff. **Costco Business Centre is in the second
   group.**
2. **A narrower distinction than method** — for example, same-origin document POSTs that are
   not payment paths. **That is recognition again**, and L1 measured 45% on exactly that kind
   of judgement.
3. **A per-errand `allowedWrites` for a NON-auth path.** The pre-decided answer still stands
   for a search endpoint or a filter. **It does not apply here**, because the blocked request
   is authentication.

> ### The honest summary: L3 is the guardrail and it works. What it guards against and what the Owner wants to read overlap more than the six-site measurement suggested, and that overlap is now a measured fact rather than a surprise waiting.

**No fence was changed. Nothing was added to a cart, no order was placed, nothing was modified,
and no paid model call was made.**
