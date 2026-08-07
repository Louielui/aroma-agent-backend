# The L2 probes — **all three seen to fail**, and the lock behaviour measured rather than reasoned

<!-- record-status: ACTIVE 2026-08-06 -->

**Throwaway profiles only. The Owner's profile was never created and no credential was
touched. No paid model calls. `$0.00`.**

---

# ⚠ ONE CORRECTION TO THE ORDER

**L3 is already built.** It was step 1 in the order given last round, and it was built,
measured (free to read across six sites, 51 writes refused) and reported. The instruction 「do
not start L3 until both have been seen to fail」 is overtaken — **L3 exists.** What is still
outstanding from that order is **PUA stripping**, which has not been started.

---

# ALL THREE PROBES, SEEN TO FAIL

| probe | clean state | **seen to fail** |
|---|---|---|
| **payment methods** | `CLEAN`, 5 tables checked, all empty | **YES** — a fake card row inserted, probe returned `PAYMENT_METHOD_PRESENT`, `clean=false` |
| **card-saving preference** | `DISABLED` | **YES** — flipped back on, probe returned `ENABLED`, `ok=false` |
| **profile lock** | `FREE` after close | **YES** — `LOCKED` while a Chrome session was live |

## What the payment probe says when it catches him

```
呢個 profile 而家有付款方式(1 項:a card saved in this browser profile)。
最可能係你上次喺呢個 profile 完成付款嗰陣,Chrome 問你存唔存卡,而存咗。
要喺 Chrome 設定度刪走佢,我先可以開工。
```

> **Owner: 「the probe's message should point at my payment, not at a database table, or I will
> not understand what it caught.」**

**It names what he did.** `credit_cards` is kept as `where`, for whoever fixes it, and is never
the headline.

## Three states, never two

**`NO_DATABASE_YET` is not `CLEAN`.** A profile Chrome has never run in has no database —
「未存過卡」 is a different claim from 「查過冇卡」. And **`UNREADABLE` is not clean either**:
unsafe unless proven safe. HR-5, applied to a fence.

---

# ⛔ THE LOCK — MEASURED, NOT REASONED

> **Owner: 「you are right not to assert what a second `--user-data-dir` does against a live
> persistent context. Measure it, do not reason about it.」**

```
lock while a session is RUNNING   LOCKED   files=["lockfile"]
a SECOND launchPersistentContext  REFUSED  "Opening in existing browser session."  (0.3s)
lock after CLOSE                  FREE     files=[]
```

**Three facts, none of them assumed:**

1. **A second launch is REFUSED, cleanly and in 0.3 seconds.** It does not attach a tab, and it
   does not corrupt — it fails fast with a clear message. **The 首頁 「開返嗰版」 button will hit
   this exact refusal**, which is what §9 of the design must handle, and now it is known rather
   than hoped.
2. **The lock is released on close.** A leftover lock therefore means a crash, not a busy
   session — which is the distinction that makes 「stale lock」 a meaningful state.
3. **⚠ On Windows the file is `lockfile` — NOT `SingletonLock`.** `SingletonLock` is the POSIX
   name. **Checking only the name I would have reached for first would have reported `FREE` on
   a locked profile** — a probe that reports safe when it is not, which is the exact failure
   this whole step exists to prevent. It was caught because the list carried both names.

## And it never clears

> **Owner: 「Never auto-clear a stale SingletonLock. Two Chromes writing one profile is the
> kind of corruption that surfaces days later as something else entirely.」**

`probeProfileLock` reports and stops. **A test asserts the lock file still exists after the
probe runs.** Clearing it is the Owner's action, taken knowing why — never a step the system
performs to keep going.

---

# CARD SAVING IS OFF AT CREATION, AND RE-CHECKED EVERY SESSION

> **Owner: 「disabled at profile creation, not by policy at payment time — the person most
> likely to dismantle L2 is me, at the moment I am least paying attention.」**

`writeProfileDefaults` runs **once, when the directory is made, before Chrome has ever run**:

```
autofill.credit_card_enabled     false     never offer to save a card
autofill.profile_enabled         false     nor an address
credentials_enable_service       false     nor a password
```

**And a preference is a thing that can change**, so `probeCardSavingDisabled` re-checks it
before every session. Seen to fail: flipped back on, the probe says —

```
Chrome 而家會問你存唔存卡(設定係 true)。呢個係喺開 profile 嗰陣就應該熄死嘅嘢 ——
而家佢開返咗,所以下次你付款,張卡會留喺呢個 profile 度。
```

**It says what happens NEXT time he pays.** A setting-name message would not.

---

# NO NEW DEPENDENCY

Chrome's `Web Data` is plain SQLite and **`node:sqlite` is built into Node 24** — no package
added, and the no-new-dependency rule is untouched. The probe reads a **copy**, never the live
file Chrome holds open: **a fence must never be a reason the browser misbehaves.**

---

# STATUS

| | |
|---|---|
| **L1** | convenience — 100% fitted, **45% held-out**, optimistic |
| **L2** | **probes built and all three seen to fail.** The profile itself is still NOT created |
| **L3** | **built and measured** — free to read, 51 writes refused across six sites |
| **PUA stripping** | **not started** — still outstanding from the previous order |
| **the real profile** | **not created. No credential touched.** |
