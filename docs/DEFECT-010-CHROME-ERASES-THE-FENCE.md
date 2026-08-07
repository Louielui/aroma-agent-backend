# DEFECT-010 — Chrome erased step 1's fences on its first run. **Step 5 did not run.**

<!-- record-status: OPEN 2026-08-06 -->

**Zero paid model calls. `$0.00`. No browser was launched by me. Nothing was read, clicked or
changed.**

---

# WHERE IT STOPPED

```
⛔ THE SESSION REFUSED TO OPEN. No browser was launched by me.

  reason: PROFILE_NOT_CLEAN
    - cardSaving  NO_PREFERENCES
    - signIn      NO_PREFERENCES

  liveLayers(): not available — there is no session to ask.
```

**The wiring worked.** The session refused before `launchPersistentContext` was called, exactly
as the smoke test asserts. **That is the good half.**

---

# ⛔ THE DEFECT — writing Preferences before Chrome's first run does not survive it

| step 1 wrote | what is in the file now |
|---|---|
| `autofill.credit_card_enabled: false` | **undefined** |
| `autofill.profile_enabled: false` | **undefined** |
| `credentials_enable_service: false` | **undefined** |
| **`signin.allowed: false`** | ⛔ **`true`** |
| `sync.requested: false` | **undefined** |
| `account_info: []` | **missing** |
| **5 top-level keys** | **54 top-level keys** |

> ## Chrome rewrote `Preferences` wholesale from its own defaults on first run. Every fence step 1 set was erased by step 3.

**The design's central claim — 「card saving disabled at profile creation, not by policy at
payment time」 — is not true as implemented.** The mechanism was right; **the moment was wrong.**

## What was NOT harmed

- **`payment` probe: `CLEAN`.** No card was saved. 
- **No Google account** is on the profile (`account_info` absent, and the Owner reports he
  declined everything).

**So nothing bad happened. What happened is that the guarantee stopped being true**, and the
probes are the only reason anyone knows.

## And a second, smaller finding

**Reading `Preferences` while Chrome is running is racy.** Chrome rewrites it atomically —
temp file, then rename — so a probe can catch the instant it does not exist. My first read got
`NOT_SET`; the session's read minutes later got `NO_PREFERENCES`.

**Both are 「unclean」, so it fails safe.** But the sentence it shows the Owner —
「搵唔到個 profile 嘅設定檔」 — describes a missing file when the truth is 「Chrome is holding
it open」. **A correct refusal with a misleading reason.**

## And Chrome is still running on that profile

**10 chrome.exe processes** hold `C:\Aroma\browser-profile`. **The lock probe was right**, and
it did not delete anything.

---

# THE FIX — proposed, not built

> ## The prefs must be written while Chrome is CLOSED, and the right place is immediately before launch, inside the session runner.

That makes it **structural instead of a one-time act**: every session re-asserts the fences on
a closed profile and then verifies them, so 「Chrome rewrote it again」 becomes a non-event
rather than a silent regression.

| option | verdict |
|---|---|
| **write prefs in the session runner, before launch, with Chrome closed** | ✅ **proposed.** Per-profile, re-asserted every time, verified immediately after |
| Chrome **policies** via registry (`AutofillCreditCardEnabled`, `BrowserSignin`, `SyncDisabled`) | ⛔ **no** — those are user- or machine-wide and would change the Owner's everyday Chrome |
| tell the Owner to check the settings by hand | ⛔ **no** — that is the thing the probe exists to replace |

**The runbook's step order needs the same correction:** step 1 cannot be 「write the fences and
never think about them again」. It is 「write them, and re-write them before every launch」.

---

# WHAT THIS ROUND ACTUALLY PROVED

**The errand did not run, and the round is not wasted:**

1. **The probes caught a real regression on a real profile** — not a staged one. Their first
   encounter with reality found something.
2. **The session refused to open rather than opening and warning.** The wiring behaved under
   live conditions exactly as the cut-tests predicted.
3. **A design claim was falsified by contact.** 「Set at creation」 was measured and is wrong.

> **Step 5 remains unrun. It should not run until the fences are back in force**, because a
> read-only errand on a profile whose card-saving fence is off is only safe by luck — and luck
> is what this whole structure exists to replace.
