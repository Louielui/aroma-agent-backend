# Phase 3b — handoff

**Updated 2026-07-29.** Branch `feat/computer-3b-observation`, HEAD `5c9e1b9`. `main` untouched.
Supersedes the earlier version of this file, which was written before Stage 3 ran.

**Phase 3b is NOT closed.** Part B executed and returned `STAGE 3 COMPLETE`, but four Tier B
assertions were never run, Lock 3 is not met, and the integrity of the assertion IDs
themselves is unverified. Do not read "STAGE 3 COMPLETE" as "3b done".

---

## 1. Current honest state

| Item | State |
|---|---|
| Evidence-directory PNG contents | **NOT CHECKED** |
| Lock 3 (7-day retention) | **NOT MET** |
| Tier B | **4 of 8** adjudicated |
| Cross-session containment | **NOT PROVEN** |
| Assertion-ID integrity | **UNVERIFIED** |
| Test suite | 1600 tests, 1596 pass, 0 fail, 4 skipped |
| `COMPUTER_OPERATOR` | off · `app.js` 0 references · 8090 untouched |

### PNG contents — not checked

`check-evidence-signatures.ps1` exists and is correct, but its only run was pointed at the
assistant's **scratchpad**, not the evidence directory — which the assistant had already
stated it cannot read unelevated. The "13 PNGs, OWN 0 / OWNER 0" result describes test
artefacts and is **not evidence about the evidence store**. It was retracted.

The Owner runs it elevated; until that output exists, PNG contents are **unchecked**.

Scope limit the script states about itself: it detects the owner **sentinel colour**. It
cannot prove the absence of all owner-session content — only that the one marker made
deliberately detectable is absent.

### Lock 3 — not met

The 7-day sweep in `evidenceStore.js` matches `ev_*.png` only:

```
EVIDENCE_PREFIX = 'ev_'   EVIDENCE_EXT = '.png'
sweep skips anything not matching both
```

The artefacts that actually hold raw content are named otherwise — `stage3-capture-*.png`,
`stage3-uia.json`, `obs-*.png`, `obs-*.uia.txt` — so **none of them is ever swept**. The
retention test passes and is honest about what it tests; it tests the store's own sweep,
which does not cover the files being produced. An earlier green report on Lock 3 was
withdrawn.

### Tier B — 4 of 8

| ID | Verdict | Mechanism |
|---|---|---|
| E1 enumerate other-session windows | **BOUNDED** | SESSION-ISOLATION |
| E2 OpenWindowStation | **NOT PROVEN** | — |
| E3 OpenDesktop | **NOT PROVEN** | — |
| E4 other-session clipboard | **NOT PROVEN** | — |
| E5 enumerate other-session processes | **ACCEPTED** | none — known-visible surface |
| E6 OpenProcess | **BOUNDED** | ACL, win32Error 5 |
| E7 read other-session MainModule | **NOT PROVEN** | — |
| E8 capture other-session screen | **BOUNDED** | SESSION-ISOLATION |
| E9 other-session command line | **NOT PROVEN** | — |
| E10 PROCESS_TERMINATE (new, see §4) | **BOUNDED** | ACL, win32Error 5 |

E2/E3/E4/E7/E9 were **omitted from the harness**, not deliberately skipped and not merged
into other rows. Nothing may be inferred about them from E1/E8 being BOUNDED: those use
window enumeration and screen capture, while E2/E3 test kernel-object DACLs, E4 tests
window-station clipboard namespacing, and E9 tests process-token rights. **Four different
mechanisms. One holding is not evidence for another.**

Positive controls that did hold, and which make the negatives meaningful: `POS-list_windows-own`,
`POS-capture_screen`, `POS-read_uia_tree-own`, all ACCEPTED, with owner-sentinel attestation
present, own sentinel on the primary monitor, same-round baseline OWN 0 / OWNER 0, no
residue, wall clock 3432 ms, and a closed manifest loop (minted louis/session 3 → consumed
AromaOperator/session 5, STARTED and COMPLETED markers both present).

---

## 2. Assertion-ID drift — three findings

Found by reading code and register together after the Owner observed that if one number can
change meaning unnoticed, **every** number is unverified until re-read.

**1. E7 collision.** Register says `E7-read-other-session-module` (read MainModule). The
harness ran `E7-terminate-other-session-process` (PROCESS_TERMINATE). Different assertions
under one number, with no note. The registered E7 was therefore never run, while the row
looked covered.

**2. E6 semantic narrowing.** The Tier A E6 used `.Handle` (broad access). The harness E6
requests `PROCESS_QUERY_INFORMATION` (0x0400) specifically. Both are "open another session's
process", but they test different access masks, so the harness result does not carry the
registered meaning.

**3. Row count.** 24, 26 and 23 were all quoted at different points. **Measured: 23.** The
figure 26 was never correct, and it propagated — the Owner repeated it from the assistant's
own report.

**And a fourth, structural:** every `POS-*` row is harness-only and appears in **no register
at all**. It cannot drift from a definition because none exists. An unregistered positive
control is the same class of risk as a drifted negative ID: nothing constrains what it means.

---

## 3. `assertionRegistry` — design, not yet implemented

One module is the single source of truth. The harness and the Tier A probe **read** from it
and may not define assertions locally.

Per entry:

```
id                  stable, never reused for a different assertion
title               short human description
target              the exact object/path/mask under test
accessMask          where applicable, the literal numeric mask (e.g. 0x0400)
mechanism           expected class: ACL | SESSION-ISOLATION | PRIVILEGE | NONE
expectedPermitted   true | false
positiveControlId   the id of the row that proves the prober is not blind
tier                A | B
implies             what the result licenses  (e.g. "denial of any superset mask")
doesNotImply        what it explicitly does NOT license
```

Tests that must exist:

- every id emitted by any probe or harness **exists** in the registry
- for each emitted row, `target`, `accessMask`, `mechanism` and `expectedPermitted` **match
  the registry entry field for field** — a changed target or mask fails the test
- every registry entry with `expectedPermitted: false` names a `positiveControlId`, and that
  control is present in the same run
- **`POS-*` rows are registered too** — the positive controls are constrained by the same
  mechanism as the negatives
- ids are unique, and a test fails if an id's `target` or `accessMask` changes without the
  id changing

The point is that the drift above becomes a failing test rather than something someone has
to notice.

---

## 4. E6 — decision: correct the register, do not re-run

Owner ruling, confirmed by the assistant.

**Narrow denial implies broad denial.** `OpenProcess` succeeds only if *all* requested
rights are granted, so a denial of `PROCESS_QUERY_INFORMATION` (0x0400) entails denial of
any mask containing it — including the `PROCESS_ALL_ACCESS` that `.Handle` requests. The
executed assertion is therefore **stronger** than the registered one, and the result stands.
The fix is to make the register match the mask actually used.

**It does NOT imply `PROCESS_QUERY_LIMITED_INFORMATION` (0x1000).** That is a separate,
weaker right that can be granted independently, so no subset argument reaches it. It must be
asserted on its own.

A probe of 0x0001 / 0x0010 / 0x0400 / 0x1000 found **all four denied** — but it ran
**louis → session 5**, whereas E6 is **operator → session 3**. The directions are not
symmetric and the ACLs need not be. That measurement is **corroboration, not the
measurement**, and 0x1000 in the operator→owner direction remains untested.

Register the mask, the implication and the non-implication explicitly. A register that says
only "cannot open other-session process" claims more than was proven — the same disease as
a drifted id: **the record reading wider than the evidence.**

---

## 5. Next round, in this order

1. **`assertionRegistry` + full cross-check tests** — including `POS-*`. Nothing else until
   the ids can be trusted; re-running assertions whose identity is unverified just produces
   more unverified rows.
2. **Top-up run**: E2, E3, E4, E7, E9 — each with its own positive control inside session 5.
   Add **E10** for PROCESS_TERMINATE as its own id (a valid extra finding, not a
   replacement for E7). Extend E6 with 0x1000 in the operator→owner direction.
3. **Lock 3**: make retention actually cover `stage3-*` and `obs-*`, with the deletion path
   exercised by a test against those names.

The top-up **does not need a full Part A redo**: none of E2/E3/E4/E7/E9 depends on the owner
sentinel or the owner reference capture — each needs a positive control inside session 5
(own window station, own desktop, own clipboard, own process). A fresh manifest is minted
anyway for a clean evidence chain, but it is not what makes those rows valid.

---

## 6. Environment facts

- **Session 5 must stay signed in.** No sign-out, no reboot, no sleep. The gate task, the
  escape-hatch verification and the A4b baseline are all bound to that session id; losing it
  costs the whole Part A precondition chain. Sleep is already disabled (standby/hibernate AC = 0).
- **Signature colours** — changed after the original pair were found to sit exactly on the
  Windows console palette, which let a single magenta console line put 18 owner hits into a
  clean baseline:
  ```
  OWN    RGB(32, 208, 64)
  OWNER  RGB(208, 32, 144)     tolerance ±12
  ```
  Every channel clears tolerance against all 16 palette entries by ≥16.
- **`cls` before pasting anything in session 5.** Console text is part of the captured frame.
- **The evidence directory needs elevation to read.** The assistant cannot inspect it; any
  check of its contents must be a script the Owner runs.
- Display: console, dpiX 96 after the Owner set scaling to 100%. **Two monitors** —
  `\\.\DISPLAY1` primary at 0,0 and `\\.\DISPLAY5` at −1920,0; VirtualScreen 3840×1080. The
  capture samples the **virtual** screen; `GetDeviceCaps` reports only the primary, which is
  why two scripts once disagreed by a factor of two.
- Sentinels are positioned explicitly from `PrimaryScreen.Bounds`, never `CenterScreen`,
  which placed them on the negative-origin monitor.

---

## 7. Working rules — every one of these caught something real

1. **Run it; do not parse-check it.** The DPI defect, the wallpaper risk, the Lock 3
   selectivity flaw, a `-Include` that matched all 144 files, and a one-liner that failed
   while printing plausible output were all found by executing.
2. **A zero result is evidence only against a same-round positive baseline.**
3. **Never infer from absence.** "No STARTED" had two causes; the optimistic one was wrong.
4. **An unexplained block is not containment.** `NO-EXCEPTION` and `UNDETERMINED` are INVALID.
5. **Refuse, do not trim.** Dropping a bad field destroys the evidence that something tried.
6. **No baseline, no destructive attempt.**
7. **Report mechanism-verified and real-value-unverified as separate columns.**
8. **NEW — check what you are measuring before reporting the measurement.** The PNG check
   was run against the scratchpad and reported as though it covered the evidence directory,
   in the same session in which the assistant had said it could not read that directory. A
   correct method pointed at the wrong subject produces a confident, wrong answer, and it
   looks exactly like a right one.
