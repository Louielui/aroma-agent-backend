# ERRAND-002 — 「去 aroma-system 個 invoice 頁，讀返而家 pending 嗰啲發票嘅供應商同金額」

<!-- record-status: ACTIVE 2026-08-06 -->

**Caps: 12 browser actions, 120s, zero paid model calls.** Used: **1 action, 1.8 seconds,
`$0.00`.**

---

# THE ANSWER: **login is the next wall.** It took 1.8 seconds to establish.

```
 1. navigate    ARRIVED    https://system.aromabistro741.com/invoices/intake   HTTP 200
 2. read_page   READ       19 of 19 shown (raw 90)
```

What the read surfaced:

```
[#r4ca74de2] heading  "Internal Management Platform"
[#r299b4760] StaticText "Enter your credentials to access the system."
[#r574c4e9c] textbox  "Email"
[#ra1d291d4] textbox  "Password"
[#rd49826a9] button   "Sign in"
```

**No login was attempted and none will be.** The script never looked for a way in — a login
screen is a **result**, not an obstacle to route around.

---

# WHAT THIS CONFIRMS

## 1. The six verbs work perfectly on a site that is not fighting them

90 raw AX nodes → 19 surviving, **completely legible**. No cookie wall, no interstitial, no
bot mitigation, no Akamai. `navigate` and `read_page` did the whole job in **one action**.

> ### Costco is confirmed as a CEILING, not a VERDICT.
>
> The capability is real. What stopped ERRAND-001 was the destination defending itself, and
> the Owner's own system does none of that.

## 2. The credential refusal fired on a real page, not a fixture

`type` refuses `input[type=password]` and credential-shaped names **structurally**. That was
built from a baseline measurement, unprompted, and its first real-world encounter came less
than a day later — **on the Owner's own login form.**

Had the script been written to 「just log in」, `type` would have refused before touching the
field. **The fence was there before the case arrived**, which is the only order that counts.

## 3. The stop was FAST — 1.8 seconds, not a timeout

Same property as `ORIGIN_NOT_IN_ORDER` at 0ms. **A wall that announces itself immediately is
usable; a wall that arrives as a timeout is indistinguishable from a hang.**

---

# ⚠ AND THE THING WORTH SAYING BEFORE ANY DECISION ABOUT LOGIN

> ## For THIS system, the browser is the wrong tool.

`aroma-system` has an HTTP API — `/api/v1`, Bearer token, documented in `CLAUDE.md`. Reading
pending invoices through it needs **no browser at all**: no accessibility tree, no refs, no
staleness, no clicking. One request and a JSON body.

**The browser's value is for systems that have no API** — a supplier portal, Canva, a vendor's
order form. Pointing it at a system we own and can query directly is using the hardest
available mechanism for the easiest available problem.

## The login question, stated and NOT pushed

The Owner's settled ruling ② was: **the Owner's own logged-in session — NO.** 「Credentials
plus a session that can spend is the thing every fence this month exists to prevent.」

**That ruling stands and is not being re-litigated.** What today's run establishes is only
this, factually:

- the wall is authentication, reached in 1.8s;
- `aroma-system` already has a scoped-token mechanism and, per `CLAUDE.md`, an account
  (`cowork@…`) created for a read-mostly role;
- **a scoped, read-only, non-spending identity is a different object from the Owner's session**
  — different enough that treating them as the same would be sloppy, and similar enough that
  the Owner should be the one to say whether they are.

**No recommendation is attached.** The evidence is that login is the wall; what to do about it
is his, and the honest technical note is above: for this particular system, the API makes the
question mostly moot.

---

# STATUS

| | |
|---|---|
| ERRAND-001 (Costco) | stopped by **adaptive bot mitigation** — a ceiling, ruled `④ accept it` |
| ERRAND-002 (aroma-system) | stopped by **login**, in 1.8s, no attempt made |
| the six verbs | **worked in both**, and reported both stops honestly |
| what neither errand needed | **a seventh verb** |
