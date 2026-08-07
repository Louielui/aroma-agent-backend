# ⛔ L3's premise holds on the half of the web we measured, and fails on the half we built it for

<!-- record-status: ACTIVE 2026-08-06 — CEILING ACCEPTED BY THE OWNER -->

> **Owner's ruling: 「That is not a limitation of L3, it is a fact about what 『reading』 means
> behind a login, and I would rather carry it as a known ceiling than discover it each time.」**

**This is the finding. The errand that produced it is below it, not above it.**

---

# THE FINDING

L3 denies non-`GET` by default, on the premise that **reading is `GET` and almost everything
irreversible is not.**

| where it was measured | what it cost |
|---|---|
| **six public pages** | **nothing.** 51 writes refused, no page lost readable content |
| **the first logged-in account area** | **the errand** |

> ## The public web is mostly `GET`. The logged-in web is not.
>
> **Account areas commonly gate READS behind a `POST` auth handoff** — and account data is
> exactly what a logged-in errand exists to reach.

**Measured on Costco Business Centre with the Owner's own session:** the orders area performs
`POST /OAuthLogonCmd` as a **document navigation**, however it is entered. There is a plain
`GET` anchor to `/myaccount/#/app/…/orders`; navigating straight to it, with no fence change,
hits the same handoff and the same `ERR_BLOCKED_BY_CLIENT`.

> ### There is no read-only path to the order history. Reading it requires a POST.

**I had written that the unpaid cost would be 「a site whose search runs over GraphQL」. That
was too narrow, and the narrowness was not visible from the six sites the measurement used.**

---

# ⛔ THE CEILING IS ACCEPTED. A NARROWER DISTINCTION IS REFUSED.

> **Owner: 「Your option ② is recognition wearing a different name, and we measured recognition
> at 45% on a corpus we chose. A fence I can reason my way past on the day it blocks something
> I want is not a fence — it is a preference with a changelog.」**

**Option ② — 「same-origin document POSTs that are not payment paths」 — is not built and will
not be proposed again.** It is L1's judgement in a new place, and L1 measured **45% on pages it
had never seen**.

---

# WHAT THIS LEAVES — recorded so it is not re-litigated

| | |
|---|---|
| **public pages, read** | ✅ **works** — ERRAND-003 returns real answers in ~5 seconds |
| **his accounts, personalised front pages** | ✅ **works** — recognised, nav and greeting read fine |
| **his accounts, the data he actually wants** | ⛔ **blocked by our own fence, permanently** — unless he later decides the fence should be weaker |

**The third line is the whole trade, stated in the Owner's words**, and it is the price of a
fence that cannot be reasoned past.

## OPEN OWNER QUESTION — not decided today

**Three shapes. None is being built, and none should be raised again until he raises it.**

1. **Accept it permanently.** Logged-in reading works where the account area is `GET`-served
   and not where it is not.
2. **A narrower distinction than method.** ⛔ **Refused today** — recognition with a new name.
3. **A per-errand `allowedWrites` for a specific non-auth path.** The pre-decided answer still
   stands for a search or filter endpoint. **It did not apply here**, because the blocked
   request was authentication.

> **He is not deciding today. This is recorded as his open question, with the shapes named, so
> that re-opening it is a choice rather than a rediscovery.**

---
---

# The errand that produced it — STEP 5, second run

**All four layers live. Probes clean at launch. Nothing added to a cart, no order placed,
nothing modified, no paid model call.**

```
probes             payment CLEAN · cardSaving DISABLED · signIn BLOCKED · lock FREE
navigate           www.costcobusinesscentre.ca              ARRIVED
read_page          105 nodes                                LOOKS SIGNED IN
click              link "Orders"                            CLICKED
read_page          5 nodes → ERR_BLOCKED_BY_CLIENT

⛔ refused NAVIGATION (document):  POST .../OAuthLogonCmd
```

**Aborting a background XHR degrades a page. Aborting a document navigation replaces it with a
Chrome error page** — which is why this stop looks like a broken site rather than a refusal,
and why the report has to name it.

---

# ⚠ AND HR-25 WAS NOT CAUGHT BY A TEST EITHER

> **Owner: 「a guardrail that erases the key its own probe reads would have reported clean
> forever, and the only reason it did not ship that way is that you noticed while wiring it.
> Say so; that was not caught by a test either.」**

**Said plainly: no test caught it.** `writeProfileDefaults` set `account_info = []`;
`probeBrowserSignIn` reads `account_info`. Every unit test passed — **including the two that
prove the sign-in probe catches a signed-in Chrome**, because those tests wrote the account
themselves *after* the defaults were written.

**It was caught while wiring the per-launch re-assert**, by reading the two functions next to
each other and noticing they touched the same key from opposite directions.

| how the last four defects were caught | |
|---|---|
| the unmounted enquiry router | a live 404 |
| Chrome sign-in missing from the defaults | **the Owner** reading the design against the report |
| L1 and L3 wired to nothing | **the Owner** saying 「check, do not recall」 |
| **the fence erasing its own evidence** | **reading two functions side by side while wiring a third thing** |

> ### Four defects of the same family. **Zero caught by the suite.** The wiring smoke tests now cover the third; nothing yet covers the fourth, and the honest reason is that I do not know what shape that test has.
