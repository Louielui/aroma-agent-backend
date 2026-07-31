# SEALED WORK ORDER — `wo_canary_notepad_1` (revision 2)

**Status: PREPARED, NOT APPROVED, NOT EXECUTED.**
Nothing here has run. `COMPUTER_OPERATOR` is OFF and measured OFF, the allowed directory does
not exist, and Notepad has not been opened. Executing requires a separate Owner EXECUTE GO.

Revision 2 re-seals against the Owner ruling of 2026-07-31 (option A). Revision 1's hash
`d27a0762…` is **void** — the order now carries its own bounds, so the hash changed.

| Field | Value |
|---|---|
| Order id | `wo_canary_notepad_1` |
| Approval id | *(empty — filled only by an Owner EXECUTE GO)* |
| Branch | `feat/computer-3b-observation` |
| Code commit | `3a6b5ab` |
| **Order hash (SHA-256)** | `df26f0900661ba38a4fd731c04eac50de92c42ee9a50d8843e41871bfb7311e0` |
| allowedPath | `C:\Aroma\ComputerOperator-Test` |
| maxSteps | 3 (ceiling 10) |
| timeoutSec | 300 |
| Concurrency | one step in flight |

The path and both limits are now **fields of the order** and are **inside the hash**. An
approval is therefore an approval of specific bounds, not of whatever the constants happen to
say on the day it runs.

---

## 1. The exact text

```
Aroma Computer Operator canary. Round 1.
```

40 bytes UTF-8, no trailing newline, ASCII only.
SHA-256 `2a0dd10ded575af6139fc6ff06394de412137e416d0c14de02049e4669fa1ad7`

Fixed in the seal as `sealedText`. A `type_text` step whose text differs is refused
(`text_not_sealed`) before anything is typed.

## 2. The exact file

```
C:\Aroma\ComputerOperator-Test\canary-1.txt
```

New file, bare name, `[A-Za-z0-9._-]` only. `allowedPath` must equal
`C:\Aroma\ComputerOperator-Test` **exactly** — a trailing separator, a subdirectory, a
different case or a longer name are all refused (`allowed_path_mismatch`). An existing file is
refused (`refuse_overwrite`) before the save is attempted. **The directory is not created by
this system**: if it is missing, the run fails closed.

## 3. The three steps

| n | action | parameters — and NOTHING else |
|---|---|---|
| 1 | `open_app` | `appId: "notepad"` |
| 2 | `type_text` | `text: <the sealed string>`, `bind: {processId, sessionId, windowHandle, uiaControlId}` |
| 3 | `save` | `fileName: "canary-1.txt"`, `bind: {…}` |

Extra fields are refused (`unexpected_field`), not ignored. Bindings are captured from step 1's
real result; any mismatch, or a UIA control that no longer resolves, is refused
(`stale_binding`) rather than re-bound.

## 4. The unlock condition

Every gated action passes `sealedOrderGate.verifyUnlock`, which requires **all five**:

```
sealed === true        the order is sealed
approvalId             an Owner approval id is present
orderHash matches      recomputed and compared
flag === 'on'          COMPUTER_OPERATOR
not stopped            the 3a kill switch
```

**The flag is necessary and not sufficient.** With the flag on and no order presented, the gate
refuses `sealed_order_required`. There is no branch anywhere that proceeds on the flag alone.

`NEVER_ACTIONS` — click, mouse movement, clipboard, `write_file`, `delete_file`, `network` and
the rest — are decided **before** an order is read. No seal reaches them at any price.

## 5. The audit chain

```
admission        runId, orderId, approvalId, orderHash, plannedSteps[], limits
step-start       runId, n, action                          <- BEFORE each step
step-outcome     runId, n, action, outcome, detail          <- AFTER each step
… per step …
completed        runId, stepsRun, steps[]
aborted          runId, reason, detail, phase, n, cleanup   <- on any failure
```

| If this record cannot be written | Then |
|---|---|
| `admission` | zero desktop actions; Notepad is never opened |
| `step-start` for step *n* | step *n* performs zero actions; the run stops |
| `step-outcome` for step *n* | steps *n+1…* never start; cleanup runs; no PASS |
| `completed` | no PASS, even though every step succeeded |

A failed audit at the end cannot make a completed action never have happened, so "no record, no
action" is enforced by the **pre-action durable record**, not by a `catch`.

## 6. Adapter boundary and fail-closed points

`desktopAdapter.js` is the only module permitted to reach a desktop, and it does so only through
an injected runner calling one fixed script, `scripts/computer/uiaCanary.ps1`, with data as a
JSON payload. No command string is ever assembled.

| Point | Fails closed on |
|---|---|
| `openApp` | app id not `notepad`; window not found; **more than one candidate window**; no Document/Edit control; any binding field missing |
| `typeTextIntoControl` | missing binding; stale binding; `ValuePattern` unsupported; control read-only; read-back mismatch; helper reporting any method other than `ValuePattern` |
| `saveAsViaUi` | missing binding; **directory absent**; **file exists**; File menu, Save-as item, dialog, filename field or Save button not found; `ValuePattern` unsupported on the filename field; file not present afterwards |
| `verifyBinding` | process gone, session changed, window changed or ambiguous, UIA control missing — any doubt answers no |
| `cleanup` | bounded to the recorded process and session; never throws, so it cannot mask the original failure |

There is **no fallback path anywhere**. A lookup failure is a refusal, because the case where
the lookup failed is exactly the case where we do not know what we would be acting on.

## 7. Prohibited — refused by construction

clipboard · global SendKeys · any keystroke synthesis · focus-based fallback · arbitrary
exe/path/arguments · filesystem API in place of Notepad Save As · creating the directory ·
overwriting any file · writing outside `allowedPath` · any other session's desktop · any
pre-existing window · network · shell · browser · Office · Explorer · `main` · port 8090 ·
production · any other flag.

**Wording, per the Owner's ruling:** the source scan establishes that these techniques are **not
present in the source** — the correct term is **SOURCE-CONSTRAINED**. It is *not* "verified",
"blocked" or "passed". Real UIA behaviour can only be established by EXECUTE.

## 8. UNVERIFIED ASSUMPTION — carried forward unchanged

> This machine's Notepad is the newer Windows App. Its UIA tree, its tabbed mode, and whether
> `open_app` yields a NEW window or a NEW TAB inside an existing process, all differ from the
> legacy `notepad.exe`, and all three directly determine the `processId` / `windowHandle` that
> steps 2 and 3 bind to. PREPARE forbids touching Notepad, so this assumption **cannot be
> verified now** and is recorded as unverified rather than assumed away.

Every element name in `uiaCanary.ps1` — `File`, `Save as`, `File name:`, `Save` — is part of the
same unverified assumption. If EXECUTE shows the tree differs, the fix is to **measure it and
update the lookups**, never to loosen them. If the process/window/UIA binding does not match at
EXECUTE time, the run fails closed.

## 9. The flag

`COMPUTER_OPERATOR`, resolved by `src/computer/computerOperatorFlag.js`. Currently OFF and
measured OFF. At EXECUTE time it is set immediately before the run and restored to OFF in a
`finally`, so an aborted or crashed run still leaves it OFF.

Both sides read it: the Service-side wiring, and the Companion in its own process. The Companion
resolves it from the **real** process environment, so a caller cannot hand it a fabricated `on`.

## 10. Cleanup, in order

1. Confirm the audit chain is on disk.
2. Confirm `C:\Aroma\ComputerOperator-Test\canary-1.txt` exists and matches the sealed text byte
   for byte.
3. Record the file's SHA-256.
4. Confirm no other file changed.
5. Delete the test file.
6. Confirm Notepad is closed and no residue remains.
7. Confirm `COMPUTER_OPERATOR` is OFF.

## 11. Rollback

Two commits on a feature branch; no deploy, no migration, no production surface.

```bash
git revert 3a6b5ab e0068c6
```

Revert, not reset. The canary's only external effect is one new file in a dedicated directory,
removed by cleanup step 5. `main` is untouched at `1a6d7bd`.

## 12. Code closure

| File | SHA-256 |
|---|---|
| `src/computer/sealedOrderGate.js` | `c7c7d78dbd0a88ecedcb494f9790a58d61f8c961db7d5d9b59f9bda45eaac4b3` |
| `src/computer/computerExecutor.js` | `d36c46205dbdead8d53059bbe03e46fd5ba925b76c96b4c468c60afe2b0e6fe1` |
| `src/computer/desktopAdapter.js` | `4958b8bd00f178a271a496f1ced8d62a4ded5fe2396c573d24304929349c785b` |
| `src/computer/computerOperatorWiring.js` | `38b967500b83ee19a3b1453fb69989008f4cbdc5a71267112249c357e3447db5` |
| `scripts/computer/uiaCanary.ps1` | `85f08b79a26c05ad8c29ddb2a531bbb2d276ca634180b26baa64fba21b852e86` |
| `src/computer/companion.js` | `b6c4ae49895686ab2bae31832f256929b1bb759f26dc1fc3b86d53733168709a` |
| `src/computer/observation.js` | `942dabf0ba653ff36afc47abd74763caa358d7fd9456254c5592043705d02b17` |

If any of these move, the order is void and must be re-sealed.

## 13. Blocking preconditions for EXECUTE

Neither can be done from here, and both are the Owner's to perform:

1. **`C:\Aroma\ComputerOperator-Test` does not exist**, and this system will not create it. It
   must be created with an explicit ALLOW for the Companion account — `deploy-companion.ps1`
   applies a container-level DENY for AromaOperator on `C:\Aroma`, so without an explicit ALLOW
   on this subdirectory the Save As will be refused by the filesystem regardless of everything
   above. One elevated action, by the Owner.
2. **The deployed Companion staging directory is now stale.** The staged closure grew from five
   files to seven (`sealedOrderGate.js`, `computerOperatorFlag.js`). It must be re-staged before
   the Companion can load.
