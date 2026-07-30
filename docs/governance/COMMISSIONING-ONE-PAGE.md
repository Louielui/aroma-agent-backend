# Aroma — physical machine commissioning

**For Louie. One page. No commands anywhere on it.**

You will press **two icons** and **switch Windows accounts twice**. That is all.
If anything goes wrong, a window will tell you it has stopped and where the report is.
**You are never asked to fix anything, judge anything, or type anything in.**

---

## Before you start

Sit at the machine itself. Not remotely.

Have the screen on and the keyboard reachable. Nothing else is needed — no notes, no
passwords, no numbers to remember.

> **Do not close either window until this page says you may.** Both stay open, one in each
> account, and they talk to each other.

---

## Step 1 — press the first icon

On the desktop of **your own account**, find:

> **Aroma — Owner Sentinel**

Double-click it.

Windows will ask for permission (a blue box asking if you allow changes). **Choose Yes.**

A window opens and works through a checklist. A **bright green square window** may appear on
screen — that is meant to happen; leave it alone.

**Wait until the big message at the bottom says to switch accounts.**

*If instead it turns red and says STOPPED — you are finished. Nothing else to do here. Read
Step 4.*

---

## Step 2 — switch to the other account

Press **Ctrl + Alt + Delete** together, then choose **Switch user**.

Pick the account called **AromaOperator**.

> It should already be signed in, so you will only need to unlock it — the same as waking your
> own screen. **If it asks you to sign in from scratch instead, stop and read Step 4.**

---

## Step 3 — press the second icon

On **that** account's desktop, find:

> **Aroma — Operator Check**

Double-click it.

This one does **not** ask for permission — that is correct, do not go looking for a permission
box.

A window opens and works through its own checklist. It takes a few minutes and will pause at
times — that is normal, the two windows are waiting for each other.

**Wait until it says FINISHED HERE and tells you to switch back.**

Then press **Ctrl + Alt + Delete → Switch user**, and go back to **your own account**.

---

## Step 4 — read the result

Your first window is still open. Look at the big message at the bottom.

| What it says | What it means | What you do |
|---|---|---|
| **PART B: PASS** and a **LOCK 5** line | It worked | Nothing. Send the report file path. |
| **STOPPED** in red, with a file path | It stopped safely | Nothing. Send that file path. |

Either way there is a **file path** and a long code (SHA-256) on screen.
**Take a photo of the window with your phone.** That is the whole handover.

Then you may close both windows.

---

## If something looks wrong

**Do not try to fix it.** There is nothing on this page that expects you to.

- A red **STOPPED** window is a *normal, safe* outcome — it means the machine refused to
  continue rather than doing something half-finished.
- If a window seems frozen for more than about twenty minutes, take a photo and close it.
- If no window appears at all when you double-click, take a photo of the desktop.

In every case: **photo, then stop.** Someone else picks it up from there.

---

## What this is doing, in one sentence

It is checking that the restricted Windows account on this machine genuinely cannot see or
touch your own session — and writing down the proof.

---

### Notes for the executor (not for Louie)

- Run `install-commissioning.ps1` **elevated, before the visit**. It places both icons and
  sets the directory permissions. Louie never runs it.
- Do a **`-DryRun`** pass first: it exercises every screen and the whole file handoff without
  measuring anything or changing machine state.
- **Louie's account must stay signed in on both sides.** The Owner launcher hard-stops at the
  start if `AromaOperator` is not signed in, because switching would then need a password —
  which Louie must not be asked for. Verified present at build time: `signedIn=True, session=5`.
- **Part B is sealed to disk before Lock 5 begins.** A Lock 5 failure cannot invalidate a Part B
  pass; the report carries the two verdicts in separate columns.
- Up to **3 rounds** are attempted automatically. Every round is recorded and the final report
  names the total and each round's outcome. After the third it stops and reports.
- Everything Louie might otherwise have to do — nonce handling, manifest minting and consuming,
  hash verification, timeouts, cleanup, residue, audit writes, the PASS/FAIL call — is done by
  the launchers.
