# SEALED WORK ORDER — `wo_canary_notepad_1`

**Status: PREPARED, NOT APPROVED, NOT EXECUTED.**
Nothing in this document has run. `COMPUTER_OPERATOR` is OFF, no desktop adapter exists in the
code, and Notepad has not been opened. Executing this order requires a separate Owner EXECUTE GO.

| Field | Value |
|---|---|
| Order id | `wo_canary_notepad_1` |
| Approval id | *(empty — filled only by an Owner EXECUTE GO)* |
| Branch | `feat/computer-3b-observation` |
| Code commit | `e0068c6` |
| **Order hash (SHA-256)** | `d27a07628faa3d9cf2273cf0b389a92607de46f96d33c3799e66344258b54ae0` |
| Max steps | 3 (ceiling 10) |
| Timeout | 300 s |
| Concurrency | one step in flight |

---

## 1. The exact text

```
Aroma Computer Operator canary. Round 1.
```

40 bytes UTF-8, no trailing newline, ASCII only.
SHA-256 `2a0dd10ded575af6139fc6ff06394de412137e416d0c14de02049e4669fa1ad7`

The text is a constant in the sealed order. It is not composed, templated or supplied at run
time, and a `type_text` step whose text differs from `sealedText` is refused before anything is
typed (`text_not_sealed`).

## 2. The exact file

```
C:\Aroma\ComputerOperator-Test\canary-1.txt
```

New file. Directory `C:\Aroma\ComputerOperator-Test\` is the only permitted location, and the
filename is a bare name — no separators, no traversal, no drive letter, characters limited to
`[A-Za-z0-9._-]`. If the file already exists the save is refused (`refuse_overwrite`) **before**
the save is attempted. Written through Notepad's own Save As dialog; no filesystem API stands in
for it.

## 3. The three steps

| n | action | parameters — and NOTHING else |
|---|---|---|
| 1 | `open_app` | `appId: "notepad"` |
| 2 | `type_text` | `text: <the sealed string>`, `bind: {processId, sessionId, windowHandle, uiaControlId}` |
| 3 | `save` | `fileName: "canary-1.txt"`, `bind: {…}` |

`appId` is an identifier, never a path or an executable. The parameter set per action is exact:
an extra field — `path`, `arguments`, `exe`, anything — is a refusal (`unexpected_field`), not an
ignored key. The binding on steps 2 and 3 is captured from step 1's real result; any field that
does not match, or a UIA control that no longer resolves, is refused (`stale_binding`) rather
than re-bound.

## 4. The audit chain

Every record is written to the `computer-audit` artifact kind, in this order:

```
admission        runId, orderId, approvalId, orderHash, plannedSteps[], limits
step-start       runId, n, action                          ← BEFORE each step
step-outcome     runId, n, action, outcome, detail          ← AFTER each step
… repeated per step …
completed        runId, stepsRun, steps[]
aborted          runId, reason, detail, phase, n, cleanup   ← on any failure
```

**Success conditions, and what each failure costs:**

| If this record cannot be written | Then |
|---|---|
| `admission` | zero desktop actions occur; Notepad is never opened |
| `step-start` for step *n* | step *n* performs zero actions; the run stops |
| `step-outcome` for step *n* | steps *n+1…* never start; cleanup runs; no PASS |
| `completed` | no PASS, even though every step succeeded |

The Owner's rule, stated as the reason it is built this way: a failed audit at the end cannot
make a completed action never have happened. So "no record, no action" is enforced by the
*pre-action durable record*, not by a `catch`.

## 5. Prohibited — refused by construction, not by policy

clipboard · global SendKeys · focus-based fallback typing · arbitrary exe / path / arguments ·
filesystem API in place of Notepad Save As · overwriting any file · writing outside
`C:\Aroma\ComputerOperator-Test\` · any other session's desktop · any pre-existing window ·
network · shell · browser · Office · Explorer · `main` · port 8090 · production · any other flag.

The executor's only `require` is `node:crypto`. It reaches a desktop solely through an injected
adapter, so with no adapter the entire path is inert.

## 6. UNVERIFIED ASSUMPTION — recorded as unverified, on purpose

> This machine's Notepad is the newer Windows App. Its UIA tree, its tabbed mode, and whether
> `open_app` yields a NEW window or a NEW TAB inside an existing process, all differ from the
> legacy `notepad.exe`, and all three directly determine the `processId` / `windowHandle` that
> steps 2 and 3 bind to. PREPARE forbids touching Notepad, so this assumption **cannot be
> verified now** and is recorded here as unverified rather than assumed away.

At EXECUTE time, if the process / window / UIA binding does not match, the run fails closed. The
binding conditions are not to be relaxed to accommodate whatever Notepad turns out to do.

## 7. The flag

`COMPUTER_OPERATOR`, read via `src/computer/computerOperatorFlag.js`. Currently OFF and measured
OFF. At EXECUTE time it is turned on immediately before the run and restored to OFF in a
`finally`, so an aborted or crashed run still leaves it OFF.

## 8. Cleanup, in order

1. Confirm the audit chain is on disk.
2. Confirm `C:\Aroma\ComputerOperator-Test\canary-1.txt` exists and its content matches the
   sealed text byte for byte.
3. Record the file's SHA-256.
4. Confirm no other file changed.
5. Delete the test file.
6. Confirm Notepad is closed and no residue remains.
7. Confirm `COMPUTER_OPERATOR` is OFF.

## 9. Rollback

The change is one commit on a feature branch, with no deploy, no migration and no production
surface: `git revert e0068c6` (revert, not reset). The canary's only external effect is a single
new file in a dedicated directory, removed by step 5 above. `main` is untouched at `1a6d7bd`.

## 10. Code closure

| File | SHA-256 |
|---|---|
| `src/computer/computerExecutor.js` | `4a0aebe395d62c63cd8f3a1e468a286dfd8b2f81c07107e969422cc9e6e2ab0d` |
| `src/computer/computerExecutor.test.js` | `a315cc1b1f9759be93ddd749d696d71b3e4b87f0cc9983d4a688b1f0186aea26` |
| `src/computer/computerSupervisor.js` | `d35958fb4f70cdfcdc66c814e7319b1e28ae3ed2094469142c7f9f51aff5099f` |

If any of these move, the order is void and must be re-sealed.
