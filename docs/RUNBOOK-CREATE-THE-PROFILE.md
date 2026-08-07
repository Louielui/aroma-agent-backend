# RUNBOOK — creating the profile and logging in once

<!-- record-status: PROPOSED 2026-08-06 — NOT EXECUTED. Nothing created, no credential touched. -->

**PROPOSAL. Nothing here has been run.**

---

# ⛔ THE QUESTION FIRST: is anything of hers active while you type passwords?

> **Owner: 「The answer should be nothing, and I want it stated rather than assumed.」**

## Stated, and verified by reading the code rather than asserting it

| checked | result |
|---|---|
| does anything outside `src/browser/` import the verbs? | **no** |
| does `playwright-core` appear anywhere in `src/`? | **no — only in `scripts/`** |
| is any browser code reachable from `app.js` / `index.js`? | **no — not mounted on any route** |

> ## Her running server CANNOT launch a browser. Not 「will not」 — there is no code path from anything she serves to `chromium.launch`.

**Every browser run so far has been a script I started by hand.** So 8090 may keep running
during your login and it changes nothing.

**And underneath it:** `type` refuses `input[type=password]` **structurally** — measured on
your own login form.

---

# STEP 1 — I create the folder and write the settings. **You do nothing.**

**All of it lands before Chrome has ever opened the folder — not after your first login.**

| setting | value | why |
|---|---|---|
| `autofill.credit_card_enabled` | **false** | never offer to save a card |
| `autofill.profile_enabled` | **false** | nor an address |
| `credentials_enable_service` | **false** | nor a password |
| **`signin.allowed`** | **false** | ⛔ **Chrome itself may not sign into Google** |
| **`sync.requested`** | **false** | ⛔ **and may not sync** |
| `account_info` | **`[]`** | no account on file |

## ⛔ Why the last three matter as much as the first

> **Signing CHROME into a Google account is a different act from signing into a website with
> Google. It syncs Google Pay cards and autofill INTO the profile — dismantling L2 without
> anyone visiting a payment page.**

**You flagged this and it was in the design but NOT in the code.** It is now, with its own
probe, and **both failure routes have been seen to fail** on a throwaway profile:

```
Chrome signed in (account_info populated)  ->  SIGNED_IN   ok=false
sync turned on with no account listed      ->  SIGNED_IN   ok=false
```

**Running:** a one-shot Node script, about a second. **Not running:** no Chrome, no browser,
no network.

**I report:** all six settings read back from the file.

---

# STEP 2 — I run four probes on the empty profile. **You do nothing.**

| probe | expected |
|---|---|
| payment methods | `NO_DATABASE_YET` — Chrome has never written here |
| card saving | `DISABLED` |
| **browser sign-in** | **`BLOCKED`** |
| profile lock | `FREE` |

**Running:** a Node script reading files. **Not running:** no Chrome, no automation, no network.

> **If any probe does not return what is expected, we stop here.** A probe that surprises us
> *before the profile has been used* is a probe we do not understand yet.

---

# STEP 3 — ⛔ YOU LOG IN. **Nothing of mine is running.**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\Aroma\browser-profile"
```

**Plain Chrome.** Not Playwright, not a script, not `launchPersistentContext` — the same
executable you use daily, pointed at a different folder.

| running | **not running** |
|---|---|
| Chrome, driven by your hands | **no Playwright · no CDP · no automation · no script of mine · nothing reading the window** |

> ### There is no field for me to intercept, because no process of mine is driving. That is the absence of a process, not a policy.

## Which sites — and the standing rule, restated because it changed

> **Your rule was 「nothing that pays, nothing that signs」. Approving logged-in browsing
> changed it. It is now:**

> ## She may be signed in ANYWHERE SHE ONLY NEEDS TO READ. The stop moved from the LOGIN to the ACT.

| log in | leave alone |
|---|---|
| **suppliers you read** — order history, invoices, price lists, delivery schedules | ⛔ **anything government**: CRA, My Business Account, provincial filing. Never in an order, and a denylist overrides |
| **Costco** — reading products, prices, past orders | ⛔ **banking and payment providers** — nothing is read there that is worth the risk class |
| **7shifts, Lightspeed** — schedules, sales, reports | ⛔ **personal email and personal accounts** — this profile is for the business |
| **Drive / Workspace**, if you want her reading documents | ⛔ **⚠ and do NOT sign CHROME ITSELF into Google** — the website is fine; the browser is not |

**The distinction in the last row is the one that matters and is easy to get wrong:** signing
into `drive.google.com` in a tab is a website login. Accepting Chrome's own 「turn on sync」 is
the thing that breaks L2.

**Also, while you are in there:**

- **Decline any 「save card」 or 「save password」 prompt.** They should not appear — **and if one
  DOES, tell me. It means the preference did not take, and that is a finding before it is an
  inconvenience.**
- **Close Chrome fully** when done.

**What I never see:** your passwords, your 2FA codes, your card. **What lands on disk:**
session cookies — which is the point, and which is why step 5 exists.

---

# STEP 4 — I re-run the four probes. **You do nothing.** Here is what each result means.

| probe | result | what it means |
|---|---|---|
| **payment** | `CLEAN` | five tables checked, all empty — **proceed** |
| | `PAYMENT_METHOD_PRESENT` | ⛔ a card is in the profile. Almost certainly a save prompt you accepted. **Delete it in Chrome settings; nothing proceeds until it is gone** |
| | `NO_DATABASE_YET` | ⚠ Chrome never wrote a database — **did step 3 actually happen?** Not an error, but not proof of anything either |
| | `UNREADABLE` | ⛔ **we could not look.** Treated as failure. A guardrail that cannot read its own evidence is blind, not clean |
| **card saving** | `DISABLED` | still off — **proceed** |
| | `ENABLED` | ⛔ it got switched back on. **Next time you pay, the card stays in this profile** |
| **sign-in** | `BLOCKED` | **proceed** |
| | `SIGNED_IN` | ⛔ **Chrome itself is signed in or syncing.** Google Pay cards may already be here. Sign out, turn off sync, re-probe |
| **lock** | `FREE` | Chrome is closed — **proceed** |
| | `LOCKED` | ⚠ either Chrome is still open, or it crashed and left a lock. **I will never delete it** — two Chromes writing one profile is corruption that surfaces days later as something else |

> **Any ⛔ and nothing proceeds.** The message names what you did, not a database table.

---

# STEP 5 — one read-only errand. **You watch.**

**Not a purchase. Not a cart.** A single `navigate` + `read_page` against one site you signed
into, to confirm she is recognised as you.

**With L3 installed**, so the first logged-in run is fenced: **every non-`GET` refused**, and
the report says how many.

---

# WHERE IT LIVES AND WHAT PROTECTS IT — from the first minute

```
C:\Aroma\browser-profile\
```

> ## From the moment step 3 finishes, this folder holds LIVE SESSION COOKIES for your accounts. Anything with file access to it has those accounts — no password, no 2FA.

**Four protections, applied at creation and not after a scare:**

| | |
|---|---|
| **ACL** | readable only by the Windows account that runs her. Inherited permissions removed, not merely added to |
| **repository** | added to `.gitignore` **before the folder is created**, so it can never be staged |
| **offsite backup** | **excluded from the Backblaze B2 sync** — it must not leave this machine |
| **the record** | named in the docs as a **credential-equivalent artifact**, so nobody later reads it as a cache and copies, syncs or clears it casually |

**It is a new credential on this machine**, and 「she never sees passwords」 does not cover it.

---

# WHAT THIS RUNBOOK DOES NOT DO

- **It wires nothing.** After step 5 she still cannot start a browser on her own — running one
  is a script I execute. **Making it automatic is a separate decision with its own report.**
- **It gives her no ability to act.** L3 refuses every write, so the first logged-in capability
  is strictly *reading, as you*.
- **It does not build 首頁's stopped-errand line.** That is last.

## And the one thing that changes the moment step 3 finishes

> ## Until now she read public pages as nobody. After step 3 she reads as you.
>
> The residual risks become live at that instant: **unrestricted reading** (accepted,
> knowingly), **the folder as a credential**, and **prompt injection while wearing your
> identity**. **Nothing in steps 1–5 mitigates the third.**

---

**Awaiting your go. Nothing above has been run.**
