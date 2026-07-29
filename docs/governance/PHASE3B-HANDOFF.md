# Phase 3b — handoff

**Updated 2026-07-29 (second revision of the day).** Branch `feat/computer-3b-observation`.
`main` untouched. `COMPUTER_OPERATOR` off, `src/app.js` 0 references, 8090 untouched.

**Phase 3b is NOT closed.** Part B executed and returned `STAGE 3 COMPLETE`, but Tier B is
still incomplete, Lock 3 has only just been corrected in code and not yet exercised against
the real evidence store, and one of the three positive controls has been **downgraded**.
Do not read "STAGE 3 COMPLETE" as "3b done" — the harness itself no longer prints that
phrase unless the register cross-check is clean.

---

## 0. Corrections to the previous revision of this file

Three, all verified by measurement before being written here.

**1. Test suite: 1600 / 1596 / 0 / 4 was WRONG. Measured 1601 / 1597 / 0 / 4** at the same
tree, twice, deterministically. No test file had changed since `f6379b7`, the working tree
was clean, and no test is registered from a directory listing — so the two figures described
identical code and one of them was mis-transcribed. The decisive evidence: an earlier
revision of this file quoted "1600 tests, 1595 pass, 0 fail, 4 skipped", and 1595 + 4 =
1599. The number never added up. **This is the same defect as the 24 / 26 / 23 row count in
§2 — a figure quoted rather than measured, propagating because nobody re-derived it.**

*(After this round's work the suite is **1638 / 1634 pass / 0 fail / 4 skipped**.)*

**2. The stated HEAD was stale.** The previous revision said `HEAD 5c9e1b9`; the actual HEAD
was `51bdf3e`, which is the commit that wrote that very sentence. Harmless in effect,
identical in kind to the two above: a record describing a state that had already moved.

**3. `stage3-sentinel.ps1`'s header still described the ORIGINAL signature colours** —
`(0,255,0)` / `(255,0,255)` — a day after `$SPEC` was changed to `(32,208,64)` /
`(208,32,144)` precisely because the originals sat on the console palette. Fixed. A header
that describes the previous build is a drifted record, no different from a drifted id.

---

## 1. Current honest state

| Item | State |
|---|---|
| Evidence-directory PNG contents | **CHECKED — see §2. Non-vacuous, but 3 of 5 images, not 5** |
| `obs-*.uia.txt` 0 bytes | **EXPLAINED — see §3. It was a vacuous positive control** |
| E4 clipboard sentinel gate | **CLOSED — see §5b. PENDING-VERIFY until step 4b** |
| Lock 3 (7-day retention) | **CODE CORRECTED — not yet exercised against the real store** |
| Tier B | **4 of 11 adjudicated**; the top-up is written and not yet run |
| Assertion-ID integrity | **NOW ENFORCED — `assertionRegistry`, 44 entries, cross-checked** |
| Cross-session containment | **NOT PROVEN** |
| Test suite | 1638 tests, 1634 pass, 0 fail, 4 skipped |

---

## 2. PNG contents — checked, and what the result does and does not support

The Owner ran `check-evidence-signatures.ps1` elevated, against the real evidence directory:

```
images found : 5
stage3-capture-005711.png                OWN 0     OWNER 0
stage3-capture-005713.png                OWN 1249  OWNER 0   <- LOAD-BEARING
stage3-owner-reference-32f6763b0bb5.png  OWN 0     OWNER 0
stage3-capture-003300.png                OWN 0     OWNER 0   <- old colours, meaningless
stage3-owner-reference-792a95043e4f.png  OWN 0     OWNER 0   <- old colours, meaningless
NO OWNER-SIGNATURE CONTENT IN ANY STORED IMAGE
UIA artefacts : 2  (obs-...uia.txt 0 bytes / stage3-uia.json 695 bytes, age 0.3 days)
```

**One. `005713` is the whole result, and it is NOT vacuous.** That single image carries both
directions at once: `OWN 1249` proves the capture was real, was looking at the screen the
sentinel was on, and was capable of recognising a signature colour — and the *same* image
reads `OWNER 0`. Positive and negative in one frame, so the zero cannot be explained by a
broken capture. 1249 against the specified 1250 sample points is the sentinel, essentially
whole.

**Two. Five images were checked; only three can mean anything.** `stage3-capture-003300.png`
and `stage3-owner-reference-792a95043e4f.png` predate the colour change and were painted in
the *old* signatures. Checking them with the *new* ones must return 0 whatever they contain.
They are superseded artefacts and **must not be counted** — this is 3 of 5, never 5 of 5. A
zero from an instrument that could not have returned anything else is not a measurement.

**Three. The tool's scope limit stands, and it is stated by the tool about itself.** It
detects the **owner sentinel colour**. It cannot show that no owner-session content of any
kind is present — only that the one marker made deliberately detectable is absent. "No owner
signature in any stored image" is exactly that sentence and no wider one.

---

## 3. The 0-byte `obs-*.uia.txt` — explained, and it was a vacuous positive control

**Mechanism.** `observer.ps1` joined its node lines into one string and wrote the bytes. An
empty node set joins to an empty string, which is 0 bytes — while `ok` stayed `true` and
`nodeCount` was reported. Worse, the per-node property read sat in `try { ... } catch { }`
with an **empty catch**, so N nodes could yield zero text and still report N.

**Why it mattered more than the file.** `observation.js` had a vacuous-pass rule for
`list_windows` (`zero-windows`) and several for `capture_screen` (`capture-empty`,
`black-frame`, the signature floors). It had **no rule for `read_uia_tree` at all**. So the
observer's `ok = true` carried the row straight through to ACCEPTED against an empty read.

**Consequence, written into the record: `POS-read_uia_tree-own` is DOWNGRADED to NOT VALID.**
A positive control exists for exactly one reason — to show the observer is not blind. One
that read nothing shows the opposite. It is not a weak control; it is no control, and it may
not be cited as corroboration for anything. **Part B therefore had two standing positive
controls, not three:** `POS-list_windows-own` and `POS-capture_screen`.

**Fixed this round.**
- `observation.js` gains three rules: `uia-zero-nodes`, `uia-empty-evidence`,
  `uia-node-read-failures`. A zero-node read can no longer be ACCEPTED by any path.
- `observer.ps1` counts per-node failures instead of discarding them and returns a NAMED
  refusal (`uia_zero_nodes` / `uia_empty_evidence` / `uia_node_read_failures`) rather than a
  cheerful `ok`.
- `stage3-harness.ps1` applies the same guard where it adjudicates the row.

**Still open — one number would settle the root cause.** Read `nodeCount` out of
`stage3-uia.json` (695 bytes, needs elevation):
- `nodeCount = 0` → the sentinel window genuinely exposes no descendants; the target was
  wrong and the fix is the rule above plus a better UIA target.
- `nodeCount > 0` with 0 bytes → every per-node read threw and the empty catch ate them all;
  a swallowed-error path, and a violation of working rule 5.

Either way the rule was required, so nothing waits on the answer.

---

## 4. Assertion-ID drift — now enforced by a register, not by re-reading

Found by reading code and register together after the Owner observed that if one number can
change meaning unnoticed, **every** number is unverified until re-read. Re-reading is not a
control. `src/computer/assertionRegistry.js` is.

**The four findings, unchanged:**

1. **E7 collision.** The register said `E7-read-other-session-module`. The harness ran
   `E7-terminate-other-session-process`. The registered E7 was never run while the row
   looked covered.
2. **E6 semantic narrowing.** Tier A's E6 used `.Handle` (broad access); the harness E6
   requested `PROCESS_QUERY_INFORMATION` (0x0400). Different access masks, so the harness
   result did not carry the registered meaning.
3. **Row count.** 24, 26 and 23 quoted; **measured 23**. 26 was never correct.
4. **Structural: every `POS-*` row was harness-only, in no register at all.** It could not
   drift from a definition because none existed — the same class of risk, not a smaller one.

**What now exists**

`assertionRegistry.js` — 44 entries, one source of truth, each carrying `id`, `title`,
`target`/`targetPattern`, `accessMask`, `mechanism`, `expectedPermitted`,
`positiveControlId`, `tier`, `implies`, `doesNotImply`. Projected to
`scripts/computer/assertion-registry.json` for the PowerShell side, guarded by a test that
fails if the projection falls behind its source.

Enforced, both statically and at run time:
- every id emitted by any probe exists in the register (test scans the `.ps1` files; the
  probes also refuse an unknown id while running)
- `target`, `accessMask` and `expectedPermitted` must match field for field — a drifted row
  is recorded `INVALID / REGISTRY-DRIFT`, kept and counted, **never tidied into a pass**
- every `expectedPermitted: false` entry names a positive control, and that control must be
  **present in the same run and ACCEPTED** — a negative whose control failed proves nothing
- `POS-*` rows are registered under the same rules
- **`-ExpectPermitted` is gone from every call site.** The probes read the expectation from
  the register; they can no longer state one
- per-id pinned SHA-256 fingerprints: changing an id's target, mask, mechanism, expectation,
  control or tier fails a test. If it fails, the question is not "update the number" but
  "did this assertion change meaning?" — if it did, it needs a **new id**

**Corrections applied to the ids themselves**
- `E7-read-other-session-module` is restored to its registered meaning and is in the top-up.
- `E10-terminate-other-session-process` is the terminate assertion, under its own id, with
  `doesNotImply: "NOT a replacement for E7"`.
- `E6` records mask 0x0400, `implies` denial of any mask containing it up to
  `PROCESS_ALL_ACCESS`, and `doesNotImply` anything about 0x1000.
- `E6b-open-other-session-process-limited` asserts 0x1000 on its own, and records that the
  earlier all-four-denied probe ran **louis → session 5** while E6 is **operator → session
  3**: the directions are not symmetric, so that was corroboration, not the measurement.
- `D6-open-own-session-process` is marked **NOT a mask-matched control** (it uses `.Handle`).
  `POS-open-own-process-query` / `-limited` / `-terminate` are, and the harness now runs the
  matching control in the same run as each negative.

---

## 5a. E2 — the VIOLATION was FALSE, and the id is now retired

The accidental run reported `E2-open-other-session-winsta = VIOLATION / NONE`. Chased with
measurements rather than argument. It is not a containment failure, for two independent
reasons, and both matter.

**One — E2 and its control open the same kind of object, and it is not a window station.**
`POS-open-own-winsta` and E2 issue the identical call at the identical mask, so the control
is kind- and mask-matched. But what they open is an object-manager **Directory**, the
namespace node `\Sessions\N\Windows`. The window station is a leaf *inside* it, and it was
never reached:

```
\Sessions\5\Windows          -> STATUS_SUCCESS,  type Directory
\Sessions\5\Windows\WinSta0  -> 0xC0000034 STATUS_OBJECT_NAME_NOT_FOUND
```

A window station is not a Directory, so `NtOpenDirectoryObject` can never find it. Combined
with the Win32 route (§5), **this probe has no route at all to the object E2 names.**

**Two — the directory is world-readable BY DESIGN.** Measured DACL, identical for session 0,
session 3, session 5 and the global `\Windows`:

```
D:(A;;CCDCRC;;;WD)(A;;CCDCLCSWSDRCWDWO;;;SY)(A;;CCDCLCSWSDRCWDWO;;;S-1-5-90-0-N)
     ^^^^^^ ^^  Everyone: DIRECTORY_QUERY | DIRECTORY_TRAVERSE | READ_CONTROL
```

`WD` is Everyone. The token that opened session 5's copy was **not an administrator**
(`IsInRole(Administrator) = False`). So this is the ACE working exactly as specified — the
same class of surface as E5, not a boundary failing. Asserting it false would report a
VIOLATION every single run against a documented world-readable object, and a boundary that
cries wolf is worse than no boundary.

**What changed**

- **`E2-open-other-session-winsta` is RETIRED**, marked `status: 'unmeasurable'`, `implies:
  "NOTHING"`. It is kept so the gap stays visible, and `crossCheck` now **refuses any row
  under it** — a row would claim a measurement that did not happen. Cross-session
  window-station access is **NOT PROVEN, in either direction, with no route**.
- **`E2a-open-other-session-winsta-directory` is new**, `expectedPermitted: true`,
  mechanism `NONE`: an accepted surface, signed off, with the DACL recorded as the reason.

**E1 and E8 are untouched by this, and never rested on it.** Reaching windows requires
attaching to the window **station** and a desktop — `SetProcessWindowStation` with a handle
to the station at `WINSTA_*` rights. A handle to the containing directory confers none of
that. E1 and E8 were each measured directly, against their own sentinels and a same-round
baseline, with their own positive controls. Asserted by a test.

**E4's mechanism weakened as a consequence, correctly.** It used to inherit E2's mechanism
when the clipboard read found nothing. With no measured cross-session window-station result
to inherit, a not-found now names no mechanism at all: `UNDETERMINED`, pending verdict
`INVALID`, never `BOUNDED`. An unexplained block is not containment.

---

## 5. E2 — the first route was RUN and found incapable

Worth recording in full, because it is the exact failure this whole set exists to catch, and
it was caught by executing rather than by reading.

E2 was first written against Win32 `OpenWindowStation` with the path
`\Sessions\N\Windows\WinSta0`. Measured:

```
'WinSta0'                           -> opened; and it is OUR OWN station, in every session
'\Sessions\<OWN>\Windows\WinSta0'   -> ERROR_BAD_PATHNAME (161)   <- our own, still refused
'\Sessions\<ABSENT>\Windows\WinSta0'-> ERROR_BAD_PATHNAME (161)   <- identical
```

The call does not accept qualified paths at all. It cannot tell "isolated" from "absent"
from "wrong API" — so a BOUNDED verdict from it would have been **vacuous and would have
looked exactly like containment**.

The object-manager route discriminates. Measured on this machine:

```
\Sessions\<own>\Windows      -> STATUS_SUCCESS
\Sessions\<absent>\Windows   -> STATUS_OBJECT_PATH_NOT_FOUND   <- ABSENT, never containment
\Sessions\<own>              -> STATUS_ACCESS_DENIED           <- a nameable ACL
```

So E2 was **re-pinned deliberately** — before it had ever produced a row, so nothing recorded
is invalidated — to the object-manager container, `NtOpenDirectoryObject` at `DIRECTORY_QUERY`,
with the *same call against our own container* as its positive control. Only
`STATUS_ACCESS_DENIED` scores as BOUNDED; `OBJECT_PATH_NOT_FOUND` stays INVALID.
`doesNotImply` states that the **WinSta0 leaf object's DACL is not reached by this probe**.

**E3 inherits the honest consequence.** `OpenDesktop` operates inside the caller's own window
station, so another session's desktop cannot be named at all by any API the probe has. E3
records `blockedAtStep` and claims nothing about the desktop DACL. It will most likely come
back **INVALID / not proven** — which is the correct answer, and better than a BOUNDED that
would not survive one question.

---

## 5b. E4 cannot settle itself — the gate the clipboard was missing

**Found by the Owner, 2026-07-29, and it is the owner-sentinel disease in a second place.**

The E4 seed lives on the **owner's** clipboard. Any copy in session 3 between the seed and
the measurement silently replaces it — and the operator **cannot detect that**, because
finding out would mean reading the owner's clipboard, which is the exact thing E4 tests.
"Not found" would then be true by construction and would score as **BOUNDED**: the one
reason that proves nothing, reported as containment.

The owner sentinel **window** has an attestation gate against precisely this. The clipboard
had none. And relying on the Owner to remember a step is not a control.

**The gate, and it is structural rather than procedural:**

- `stage3-owner-clip.ps1` now has three modes — `-Seed`, `-Verify`, `-Clear` — and the order
  is **3 → 4 → 4b → 5**. `-Verify` re-reads the owner clipboard **after** the top-up and
  compares the SHA-256 to the seed attestation.
- **The top-up never settles E4.** A not-found is recorded `PENDING-VERIFY`, carrying the
  verdict it *would* earn in `pendingVerdict`. Only `-Verify` may release it. **If 4b never
  runs, the row stays PENDING-VERIFY forever** — visibly unfinished, never a pass.
- **`-Verify` mismatch ⇒ `INVALID / clipboard-sentinel-lost`.** Never BOUNDED.
- **`-Clear` REFUSES to run before `-Verify`** (exit 3). Clearing first would destroy the
  only thing that could ever resolve E4, irreversibly.
- **A leak still stands on its own.** If the operator produced the owner digest it could only
  have come from session 3, and a later clipboard change does not undo it —
  `CONTAINMENT-FAILURE` survives a failed verification.
- `postRunVerification` is a **pinned** register field. `crossCheck` refuses any E4 row scored
  BOUNDED or ACCEPTED without `postRunVerified: true`.

**Exercised end to end**, against a scratch evidence directory, all eight branches:
`-Clear` before `-Verify` → refused (3); no top-up result → stays PENDING-VERIFY; sentinel
intact → releases to BOUNDED; **sentinel replaced → INVALID / clipboard-sentinel-lost**; leak
→ CONTAINMENT-FAILURE despite a lost sentinel; `-Clear` after verify → allowed (0); two modes
at once → refused (2).

That run also caught a defect that would have burned the one-shot seed: under
`Set-StrictMode`, `@($a,$b,$c) | Where-Object {$_}` yields a bare `SwitchParameter` when
exactly one is set, and `.Count` on it throws `PropertyNotFoundStrict` — the script died on
its first real invocation. Fixed. **Rule 1 again, and it paid again.**

---

## 5c. Execution boundary — DESIGN ONLY, not implemented

**The problem, stated as the Owner did.** The assistant ran the real measurement path twice
in the Owner's own session 3, destroying the live clipboard sentinel. The proximate cause was
a flag that failed to bind. The *actual* problem is that the assistant had the ability to run
a measurement path in the Owner's session at all. `exit 14` is a good backstop but it lives
**inside the script**, so it protects only against the failure modes the script's author
anticipated — and the author is the party that keeps getting this wrong.

**What a structural boundary would have to satisfy**

1. It holds when the script is buggy, edited, or replaced.
2. It does not depend on the assistant choosing correctly.
3. It fails CLOSED — an unknown state refuses to measure.
4. It is auditable after the fact: a refusal leaves a record.

**Option A — the probes refuse to run except as the Companion account.** One line near the
top of every measurement script: if the current identity is not `AromaOperator`, refuse and
exit. Cheap, immediate, and it would have stopped both incidents outright.
*Limit:* still script-internal, so it shares the weakness above — but it is a different and
much simpler predicate than a flag, and it is the same shape as the `hostname` check that
already guards the other repo. **Recommended as the immediate step.**

**Option B — the probe directory is unreadable to the Owner's interactive account.** Today
`C:\AromaOperator-Probe` denies AromaOperator *write*; it does not deny louis *read and
execute*. Invert the second half: grant execute to AromaOperator only. Then running a probe
as louis fails at the filesystem, before a single line parses, and no script cooperation is
required. **This is the real structural answer.**
*Cost:* the Owner must still be able to stage files there — so staging is done elevated,
which is already the case, and read-back for hash verification needs an elevated shell.

**Option C — measurement requires a token the Owner's session cannot mint.** The probe reads
a one-shot manifest that only the session-gate task creates, in session 5, on the Companion's
logon. Without it the probe halts. Part B already has exactly this shape — the manifest nonce
— but the top-up deliberately does not consume it, which is why the top-up had no such gate.
*Cost:* couples every probe to a Part A precondition chain; the handoff argues the top-up
should not need one. Worth revisiting only if A and B prove insufficient.

**Recommendation: B as the boundary, A as the belt.** A is minutes of work and closes the
observed hole today; B removes the assistant's ability to execute the path at all, which is
what was actually asked for. Both leave a record: A writes a refusal line, B produces an
access-denied that cannot be mistaken for a measurement.

**Not implemented.** Owner asked for the design first.

---

## 6. Tier B — 4 of 11

| ID | Verdict | Mechanism |
|---|---|---|
| E1 enumerate other-session windows | **BOUNDED** | SESSION-ISOLATION |
| E2 open other-session **window station** | **NOT PROVEN — NO ROUTE** | retired, unmeasurable — §5a |
| E2a open other-session winsta **container** | **NOT RUN** | accepted surface, Everyone by design — §5a |
| E3 open other-session desktop | **NOT RUN** | top-up; expected NOT PROVEN — §5 |
| E4 other-session clipboard | **NOT RUN** | top-up; PENDING-VERIFY until step 4b — §5b |
| E5 enumerate other-session processes | **ACCEPTED** | none — known-visible surface |
| E6 OpenProcess 0x0400 | **BOUNDED** | ACL, win32Error 5 |
| E6b OpenProcess 0x1000 | **NOT RUN** | top-up, operator → owner direction |
| E7 read other-session MainModule | **NOT RUN** | top-up — the assertion the collision hid |
| E8 capture other-session screen | **BOUNDED** | SESSION-ISOLATION |
| E9 other-session command line | **NOT RUN** | top-up |
| E10 OpenProcess 0x0001 (terminate) | **BOUNDED** | ACL, win32Error 5 |

E10's result is the row that used to be filed under E7. It is real and it stands — under its
own id.

**Standing positive controls: two, not three.** `POS-list_windows-own` and
`POS-capture_screen`, both ACCEPTED, with owner-sentinel attestation present, own sentinel on
the primary monitor, same-round baseline OWN 0 / OWNER 0, no residue, wall clock 3432 ms, and
a closed manifest loop (minted louis/session 3 → consumed AromaOperator/session 5, STARTED and
COMPLETED both present). `POS-read_uia_tree-own` is downgraded — §3.

---

## 7. Lock 3 — corrected in code, not yet exercised on the real store

The sweep matched `ev_*.png` and nothing else. Every artefact that actually holds raw content
is named otherwise — `stage3-capture-*.png`, `stage3-owner-reference-*.png`, `obs-*.png`,
`obs-*.uia.txt` — so **none of them was ever swept, in any run**. The old test passed and was
honest about what it tested; it simply did not test the files being produced.

Widening a deletion path is the one change here that can destroy evidence, so the store now
sorts every name into exactly one of three sets, **by declaration**:

- **RAW_CONTENT** — pixels and UI text. Deleted at 7 days. This is what Lock 3 is *for*.
- **RECORD** — manifests, results, STARTED/COMPLETED markers, attestations, the SessionGate
  backup XML, Tier A output. **Never swept.** These carry the hashes, counts and verdicts
  that have to outlive the pixels; deleting them would destroy the proof of what the raw
  content once showed.
- **unclassified** — anything else. Never swept, and **reported by name**, so a new artefact
  type surfaces as a question instead of silently accumulating forever or silently being
  deleted. Absence of a rule is not permission in either direction.

Exercised end to end in `observationAdjudication.test.js` against the real filenames: six
aged raw artefacts deleted and confirmed gone from disk, an in-window capture kept, ten
record files untouched, one undeclared file reported and left alone.

**Still not met.** This is code plus a test. Lock 3 is met when a sweep runs against the real
evidence directory and the deletion is observed there.

---

## 8. What must be run — Owner, elevated / in-session

Collected here so it is one sitting, in order. Nothing below is run by the assistant.

1. **Stage the new files into the probe directory.** `stage3-topup.ps1`,
   `assertionRegistry.ps1` and `assertion-registry.json` must sit beside `observer.ps1` in
   `C:\AromaOperator-Probe`; `stage3-harness.ps1` and `tierA-probe.ps1` now dot-source the
   register and **will halt (exit 13) without it**.
2. **One number, for §3:** `nodeCount` from `stage3-uia.json` in the evidence directory.
3. **E4 owner seed, session 3, NOT elevated:** `.\stage3-owner-clip.ps1 -Seed`. It
   overwrites the clipboard — copy anything you still need FIRST — and **copy nothing at all
   between here and step 4b**. Only the SHA-256 reaches disk; the string never leaves session
   3. Note the nonce it prints.
4. **The top-up, as AromaOperator in session 5:** `.\stage3-topup.ps1`. It writes this
   session's own clipboard as the E4 positive control and clears it afterwards (§9). It will
   print that E4 is PENDING-VERIFY and name step 4b.
4b. **`.\stage3-owner-clip.ps1 -Verify -Nonce <nonce>`, session 3.** **Not optional.** This is
   the only thing that can tell containment from a sentinel that was overwritten, and it is
   what releases E4. Skipping it leaves E4 permanently unfinished — see §5b.
5. **`.\stage3-owner-clip.ps1 -Clear`**, session 3. It will refuse if 4b has not run.
6. **Lock 3, against the real evidence directory:** a sweep run and its deletions observed.
7. Optional, cheap: `powershell -File assertionRegistry.ps1 -SelfTest` on the staged copy,
   to confirm the register loads where the probes will actually read it.

**Session 5 must stay signed in throughout.** No sign-out, no reboot, no sleep.

---

## 9. Decisions taken this round that the Owner may want to reverse

**The E4 positive control writes the operator's own clipboard.** *(Owner: agreed,
2026-07-29.)* There is no other way to make it non-vacuous: a reader returning nothing from
an empty clipboard is indistinguishable from one that cannot read at all. It is a write to
session 5's own clipboard object — no keystroke, no click, no other session — and it is
cleared at the end of the run. `set_clipboard` is in `FORBIDDEN_ACTIONS` for the observation
*module*; this is the probe, and the two are deliberately separate.

**Lock 3 sweeps raw content only.** *(Owner: agreed, 2026-07-29.)* A literal reading of "cover `stage3-*` and `obs-*`" would
delete `stage3-results.json`, `stage3-manifest.json` and the STARTED/COMPLETED markers —
the audit trail itself. The scope was narrowed to pixels and UI text, with the retained set
declared by name and by reason. Reversible in one list if you want it wider.

**The Tier A probe keeps its `-Target` literals.** *(Owner: agreed, 2026-07-29.)* They are the objects the measurement
actually operates on ( `$dir`, `$key` ), so they cannot simply be read from the register —
but they are now **checked against** it, and a disagreement makes the row
`INVALID / REGISTRY-DRIFT`. `expectedPermitted` is fully register-owned. This is one step
short of "reads everything from the register".

---

## 10. Environment facts

- **Session 5 must stay signed in.** The gate task, the escape-hatch verification and the A4b
  baseline are all bound to that session id. Sleep already disabled (standby/hibernate AC = 0).
- **Signature colours** — changed after the original pair were found to sit exactly on the
  Windows console palette, which let one magenta console line put 18 owner hits into a clean
  baseline:
  ```
  OWN    RGB(32, 208, 64)
  OWNER  RGB(208, 32, 144)     tolerance ±12
  ```
  Every channel clears tolerance against all 16 palette entries by ≥16.
- **`cls` before pasting anything in session 5.** Console text is part of the captured frame.
- **The evidence directory needs elevation to read.** Any check of its contents must be a
  script the Owner runs.
- Display: console, dpiX 96 after scaling was set to 100%. **Two monitors** — `\\.\DISPLAY1`
  primary at 0,0 and `\\.\DISPLAY5` at −1920,0; VirtualScreen 3840×1080. The capture samples
  the **virtual** screen; `GetDeviceCaps` reports only the primary.
- Sentinels are positioned explicitly from `PrimaryScreen.Bounds`, never `CenterScreen`.

---

## 11. Working rules — every one of these caught something real

1. **Run it; do not parse-check it.** The DPI defect, the wallpaper risk, the Lock 3
   selectivity flaw, a `-Include` that matched all 144 files, a one-liner that failed while
   printing plausible output — and this round, an `OpenWindowStation` route that would have
   produced a confident, vacuous BOUNDED (§5) and a `-f` format string that threw inside the
   drift detector itself. Both were found by executing, in the first minute.
2. **A zero result is evidence only against a same-round positive baseline.**
3. **Never infer from absence.** "No STARTED" had two causes; the optimistic one was wrong.
4. **An unexplained block is not containment.** `NO-EXCEPTION` and `UNDETERMINED` are INVALID.
5. **Refuse, do not trim.** Dropping a bad field destroys the evidence that something tried —
   and an empty `catch { }` is the same crime with better manners (§3).
6. **No baseline, no destructive attempt.**
7. **Report mechanism-verified and real-value-unverified as separate columns.**
8. **Check what you are measuring before reporting the measurement.** The PNG check was once
   run against the scratchpad and reported as covering the evidence directory. A correct
   method pointed at the wrong subject produces a confident, wrong answer that looks exactly
   like a right one.
9. **NEW — a quoted number is not a measured one.** 26 rows, 1600 tests, `HEAD 5c9e1b9`, and a
   sentinel header describing colours that had already changed. Every one propagated because
   it was copied rather than re-derived. Anything that can be measured in one command should
   be, every time it is written down.
