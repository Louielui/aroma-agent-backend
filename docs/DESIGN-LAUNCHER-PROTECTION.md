# L-1 — the launcher: what protects it, and how we would know it stopped

<!-- record-status: ACTIVE 2026-08-07 -->

Written to `docs/DESIGN-DOC-CONVENTION.md`: every requirement carries `⛔ ENFORCED BY:`.

`C:\Aroma\xiangxiang.ps1` holds every flag the process runs under. **It is outside the
repository**, so `src/governance/` cannot contain it and `FORBIDDEN_FILE_PATTERNS` cannot reach
it. This is the answer to the open question left unsolved on purpose in
`DESIGN-SHE-CHANGES-HERSELF.md`.

---

# ⛔ READ THIS FIRST — ACL IS NOT WEAK HERE. IT IS ABSENT.

> **Owner: 「I asked which mechanism is better and the answer is that one of them is not present
> at all.」**

```
她跑緊嘅身分 = AROMABRAIN\louis        (measured)
你嘅身分     = AROMABRAIN\louis
```

> ## 冇一條 ACE 講得出「louis 用鍵盤打字得，louis 個 node process 唔得」。

A Windows ACL discriminates by **principal**, and she and the Owner are the **same principal**.
An ACL that permits him permits her, necessarily and by construction.

| | against other accounts | against her |
|---|---|---|
| **ACL** | ✅ works — `AromaOperator` is already denied | ❌ **structurally absent** |
| **content hash** | prevents nothing | ✅ **detects**, which is the half that was asked for |

**This inverts the obvious instinct.** The reflex on reading §0 is to tighten the ACL — remove
`Authenticated Users: Modify`, add an explicit deny. That is worth doing for other accounts and
it does **nothing** about the case this section exists for. Recorded here so the next reader does
not spend the effort and believe the problem is solved.

**The only real prevention is ③ — running her as a different account — and that is deferred
with its cost stated, not rejected.**

---

# 0. What was measured, 2026-08-07

```
owner : AROMABRAIN\louis
ACL   : every ACE INHERITED — the file has no ACL of its own
        NT AUTHORITY\Authenticated Users  →  Modify        (Allow)
        AromaBrain\AromaOperator          →  FullControl   (Deny)
```

- **Who can change it:** any authenticated account. `AromaOperator` is the one deliberate
  exclusion, from the Computer Operator work.
- **Does anything notice:** **no.** No hash, no signature, no git history — it is outside the
  repo. Two tests read it; neither checks integrity.
- **Is there a copy:** it had none. FIXED the same day and recorded as its own defect —
  `MAINTENANCE-BACKLOG.md` M-7. **It is deliberately not designed here**, because it needed
  fixing rather than designing: the monthly job already existed and the launcher simply was not
  in its list. One line to a list is not a document.
- Already foreseen and never acted on: `scripts/computer/deploy-companion.ps1` names
  「drop something beside xiangxiang.ps1」 as a persistence path.

---

# ① SHRINK THE SURFACE — a shim outside, the body inside

Rather than protect 8,964 bytes that cannot be protected, make the unprotectable part three
lines that never legitimately change.

```
C:\Aroma\xiangxiang.ps1                       ← a shim: hand off, nothing else
        ↓
repo\scripts\launcher\xiangxiang-body.ps1     ← the real launcher, IN the repo
```

What this buys:

- the **body** gets the repository's protections and, more importantly, **git history** — every
  flag change appears in a diff;
- the **shim** has no reason to change, ever, so **any** change to it is high-signal rather than
  noise (HR-33: a signal that fires on ordinary days stops being read);
- what remains unprotectable shrinks from a whole program to a handoff.

> **R1.1** The shim contains no configuration, no flags and no logic beyond locating and invoking
> the body. A flag added to the shim is a flag with no history.
> ### ⛔ ENFORCED BY: `src/governance/launcherPin.test.js` → 「the shim carries no configuration」.

> **R1.2** The body lives in the repo and is loaded by path from the shim.
> ### ⛔ ENFORCED BY: `src/governance/launcherPin.test.js` → 「the body exists at the pinned path」.

---

# ② PIN AND DETECT — and the checker's home is what the migration paid for

A hash prevents nothing. It **detects**, and detection is the half the Owner actually asked
about: *「a silently changed ACL looks identical to a working one.」*

## ⛔ The circularity, and why it is closed now

A check that she performs on a file she can edit is worth nothing if she can also edit the
check. So the checker and the expected hash must live somewhere her code-editing path cannot
reach — and as of `d54c3ed` such a place exists:

> ### `src/governance/` is forbidden BY LOCATION. **This is the first thing the migration paid
> ### for.** Before it, there was nowhere to put a checker that the thing being checked could not
> ### rewrite.

## And pinning gives the launcher a history it does not have

The file is outside the repo, so it has no commits and no diffs. **Pinning its hash inside the
repo means every legitimate change becomes a reviewable commit**, and every illegitimate one
becomes a mismatch.

> **R2.1** The expected hash lives in `src/governance/`, in the protected path.
> ### ⛔ ENFORCED BY: `src/governance/workOrderRefusal.test.js` → 「every file inside the path is un-allowlistable」, which covers any file added there. **Already enforced.**

> **R2.2** The check runs at STARTUP, so it is not 「remember to check」. Every restart is a check.
> ### ⛔ ENFORCED BY: `src/governance/launcherPin.test.js` → 「index.js calls the check at startup」.

> **R2.3 ⛔ IT REPORTS. IT NEVER REFUSES TO START.**
> A legitimate flag edit would otherwise brick her — **and the thing that would repair a refused
> start is the thing that refused to start.**
>
> ### ⛔ THIS IS THE SAME PROBLEM AS L2-1, NOT A SECOND ONE.
> `DESIGN-SHE-CHANGES-HERSELF.md` §3: *the thing that repairs a failed restart is the thing that
> failed to restart.* Here: *the thing that repairs a refusing launcher is the launcher.* One
> shape, one answer — **report loudly, start anyway** — and whatever eventually answers L2-1
> should answer this too. Reading them as two problems would produce two half-mechanisms.
> ### ⛔ ENFORCED BY: `src/governance/launcherPin.test.js` → 「a mismatch never throws」.

> **R2.4** A mismatch surfaces on 首頁 as a DEFECT line, not as an operational state. It is rare
> by construction, so it does not become background noise.
> ### ⛔ ENFORCED BY: `src/home/briefing.test.js` → 「a launcher mismatch renders as a defect」.

> **R2.5** `scripts/verify/launcher.js` joins the other three: PASS / FAIL / **UNKNOWN non-zero**,
> and it prints its evidence — the hash, the ACL principals that can write, the backup state.
> ### ⛔ ENFORCED BY: `NOTHING YET` at time of writing; the script is built in this round and is proven by being seen to fail against a modified copy.

---

# ③ RUN HER AS ANOTHER ACCOUNT — **not now, and here is what it would cost**

⛔ **NOT REJECTED — DEFERRED, WITH ITS PRICE STATED.** This is the only mechanism that would
actually **prevent** rather than detect, and it stays on the table. What follows is what it
would cost, so the decision can be made on the cost rather than on the effort of re-deriving it.

**What it would do:** give her process a principal distinct from the Owner's, so an ACL finally
has two things to tell apart, and `Deny` on the launcher becomes meaningful.

**⛔ Its known cost, measured, not speculative:** the scheduler-profile trap. On 2026-07-20 the
backup tasks failed `0x1` because a scheduler logon **could not see user-profile files**, and the
fix was relocating the whole toolchain to `C:\ProgramData\AromaBackup`. A second account has the
same class of problem across a wider surface: her profile directory, her Chrome profile, her
`AROMA_CORE_DIR`, the token in the user environment, and every path she writes.

**And a second cost:** the credential profile is bound to a user. Changing accounts means either
re-creating it under the new account or sharing it across accounts, and the Owner's standing
ruling is that the profile folder is a credential.

> ### Not now. Revisit only if detection proves insufficient — that is, if something actually
> ### changes the launcher and the mismatch is not enough.

---

# What this design does NOT claim

> **A file outside the repository cannot be protected the way one inside it can.**

Parts ① and ② deliver **a smaller surface, a history, and detection at every start.** None of
them is prevention. Anything running as the Owner — including her — can still change the shim,
the body, the pin and the checker, in that order, given the intent to do so.

What changes is that **doing so leaves marks**: a diff on the body, a mismatch on the shim, a
commit on the pin.

⛔ Four verify scripts and a startup check will make a reader FEEL protected. This sentence is
the only thing in the repository that will tell them what they actually have:

> ## 我唔會將偵測包裝成防止。

---

# Build order

| # | | status |
|---|---|---|
| ① | shim outside, body in the repo | ✅ built 3de03b7 |
| ② | pin + startup check + verify script | ✅ built 3de03b7, seen to fail live |
| ③ | separate account | **not now** — its cost is stated above, so the decision is about the cost |
