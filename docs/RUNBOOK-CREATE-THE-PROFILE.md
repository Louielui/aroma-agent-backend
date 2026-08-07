# RUNBOOK — creating the profile and logging in once

<!-- record-status: PROPOSED 2026-08-06 — NOT EXECUTED. Nothing created. -->

**PROPOSAL. Nothing here has been run. The profile does not exist and no credential has been
touched.**

---

# ⛔ THE QUESTION FIRST: is anything of hers active while you type passwords?

> **Owner: 「Specifically whether anything of hers is active while I am typing passwords,
> because the answer should be nothing.」**

## The answer is NOTHING — and it is structural today, not a promise

**Verified just now, by reading the code rather than asserting it:**

| checked | result |
|---|---|
| does anything outside `src/browser/` import the browser verbs? | **no** |
| does `playwright-core` appear anywhere in `src/`? | **no — only in `scripts/`** |
| is any browser code reachable from the composition root (`app.js`, `index.js`)? | **no — not mounted on any route** |

> ## Her running server CANNOT launch a browser. Not 「will not」 — there is no code path from anything she serves to `chromium.launch`.
>
> **Every browser run so far has been a script I started by hand.** The six verbs are not
> wired to a route, a scheduler, or a message handler.

**So during your login, 8090 may keep running and it changes nothing** — it serves 首頁 and the
API and has no ability to open Chrome. **I am not asking you to trust that; the three checks
above are repeatable in ten seconds.**

**And the second fence underneath it:** `type` refuses `input[type=password]` **structurally** —
measured on your own login form. Even a future errand written carelessly could not type a
password.

---

# WHAT YOU DO — five steps

## STEP 1 — I create the directory and write the defaults. **You do nothing.**

```
C:\Aroma\browser-profile\
  Default\Preferences   autofill.credit_card_enabled  false
                        autofill.profile_enabled      false
                        credentials_enable_service    false
```

| running | not running |
|---|---|
| a one-shot Node script, ~1 second | **no Chrome. No browser at all** |

**Card, address and password saving are off before Chrome has ever opened the folder** — not a
prompt you decline later.

**I report:** the three settings, read back from the file.

## STEP 2 — I run the three probes on the empty profile. **You do nothing.**

**Expected:** `NO_DATABASE_YET` · `DISABLED` · `FREE`.

| running | not running |
|---|---|
| a Node script reading files | **no Chrome, no automation, no network** |

**If any probe does not return what is expected, we stop here** and I report why. **A probe
that surprises us before the profile has been used is a probe we do not understand yet.**

## STEP 3 — ⛔ YOU LOG IN. **Nothing of mine is running.**

**I hand you one command and then I am out of the loop.**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\Aroma\browser-profile"
```

**That is plain Chrome.** Not Playwright, not a script, not `launchPersistentContext` — the
same executable you use every day, pointed at a different folder.

| running | **not running** |
|---|---|
| Chrome, driven by your hands | **no Playwright · no CDP session · no automation · no script of mine · nothing reading the window** |

**You then:**

1. sign into the accounts you want her to reach — **Costco, suppliers, whatever you choose**;
2. **decline every 「save card」 and 「save password」 prompt** — they should not appear, since
   step 1 disabled them, **and if one DOES appear, tell me: it means the preference did not
   take, and that is a finding before it is an inconvenience**;
3. close Chrome fully.

> ### There is no field for me to intercept, because no process of mine is driving. That is not a policy — it is the absence of a process.

**What I never see:** your passwords, your 2FA codes, your card. **What lands on disk:** session
cookies, which is the point — and which is why the folder is a credential from that moment on
(§6.3 of the design: ACL, out of the repo, out of offsite backup).

## STEP 4 — I re-run the three probes. **You do nothing.**

**Expected now:** `CLEAN` (5 tables checked, empty) · `DISABLED` · `FREE`.

**This is the step that catches what step 3 might have changed** — a card saved by a prompt
that should not have appeared, a preference that did not stick, a lock left by a crash.

**If `CLEAN` does not come back, nothing proceeds.** The message will name what it found and
point at what you did, not at a table.

## STEP 5 — one read-only errand, to prove the session works. **You watch.**

**Not a purchase. Not a cart.** A single `navigate` + `read_page` against one site you logged
into, to confirm she is recognised as you.

**And with L3 installed**, so the first logged-in run is fenced: **every non-`GET` refused**,
and the report says how many.

---

# ⚠ WHAT THIS RUNBOOK DOES NOT DO

- **It does not wire the verbs to anything.** After step 5 she still cannot start a browser
  on her own — running one remains a script I execute. **Making it automatic is a separate
  decision with its own report.**
- **It does not create 首頁's stopped-errand line.** That is last, per the build order.
- **It gives her no new ability to act** — L3 refuses every write, so the first logged-in
  capability is strictly *reading, as you*.

## And the one thing that changes the moment step 3 finishes

> ## Until now she has read public pages as nobody. After step 3, she reads as you.
>
> **The residual risks recorded in §6 become live at that instant** — unrestricted reading
> (accepted, knowingly), the profile folder as a credential, and prompt injection while
> wearing your identity. **Nothing in steps 1–5 mitigates the third**, and the design says so.

---

**Awaiting your go. Nothing above has been run.**
