# SEALED WORK ORDER — `wo_canary_notepad_1` (revision 2)

**Status: PREPARED, NOT APPROVED, NOT EXECUTED.**
`COMPUTER_OPERATOR` is OFF and measured OFF, `approvalId` is empty, and Notepad has not been
opened. Executing requires a separate Owner EXECUTE GO.

The two environment preconditions in §13 **have now been met** (2026-07-31): the allowed
directory exists and the Companion is staged. Nothing in the order itself has run. And per §14
the `approvalId` authorization chain is **not yet established**, which is a second and
independent reason this order is not executable — meeting the preconditions did not make it so.

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

## 13. Blocking preconditions for EXECUTE — **BOTH NOW MET** (2026-07-31)

Both were the Owner's to perform, and both were performed by him in elevated PowerShell.

1. **`C:\Aroma\ComputerOperator-Test` — CREATED.** Script A, run under
   `run-script-a-measured.ps1`. Three ACEs, inheritance protected, AromaOperator holds
   `ReadAndExecute, Write` (`0x1201BF`) and none of Delete, ChangePermissions, TakeOwnership or
   FullControl. `C:\Aroma`'s own descriptor was captured before and after and is ordinally
   identical; on the verify-only re-run the child descriptor was identical too. **A PASS.**
2. **Companion re-staged to the seven-file closure — DONE.** Script B, under
   `run-script-b-measured.ps1`. The inventory confirmed the concern was real rather than
   theoretical: the old staging held five files, and two of them were stale content —
   `companion.js` at `0c0903fe…` and `observation.js` at `4326c45a…`, neither matching the
   current sources. Parent descriptor ordinally identical before and after. **B PASS.**

### 13a. `ComputerOperator-Backups` ACL — INDEPENDENTLY VERIFIED

Owner, elevated read-only `Get-Acl`, 2026-07-31. The earlier
`PASS BY SCRIPT ASSERTION — NOT YET INDEPENDENTLY REVIEWED` label is **removed**.

**`C:\Aroma\ComputerOperator-Backups`** (the root)

| Field | Value |
|---|---|
| Owner | `BUILTIN\Administrators` |
| `AreAccessRulesProtected` | **True** |
| Own (non-inherited) ACEs | 2 |
| — | `NT AUTHORITY\SYSTEM` — Allow, FullControl, ContainerInherit+ObjectInherit |
| — | `BUILTIN\Administrators` — Allow, FullControl, ContainerInherit+ObjectInherit |
| Inherited ACE count | **0** |
| AromaOperator ACE count | **0** |
| SDDL | `O:BAG:S-1-5-21-…-1002D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)` |

**`…\companion-20260731-191120`** (an individual backup set)

| Field | Value |
|---|---|
| Owner | `BUILTIN\Administrators` |
| `AreAccessRulesProtected` | **False** |
| Own (non-inherited) ACEs | **0** |
| Inherited ACEs | 2 — SYSTEM and Administrators, both `FullControl` |
| SDDL | `O:BAG:S-1-5-21-…-1002D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)` |

**THE DISTINCTION, AND IT MUST NOT BE PARAPHRASED AWAY.** The backup ROOT is protected.
Individual backup sets are **not** independently protected — they inherit the root's
SYSTEM-and-Administrators-only ACL. Read the two SDDLs together: the root carries `P` and its
ACEs have no `ID`; the set has no `P` and both its ACEs carry `ID`. That is the whole story in
two flags.

Cause, visible in the script rather than inferred: `Set-ProtectedAcl` is applied at
`stage-companion.ps1` L323 (`$BackupRoot`) and L385 (`$StageDir`) only. A backup set is created
by a plain `New-Item` at L338 and is never given an ACL of its own.

What is therefore guaranteed, stated exactly:

- **While the root ACL is unchanged**, every backup set — existing and future — remains
  inaccessible to AromaOperator.
- **If the root ACL changes, every backup set changes with it**, existing ones included. Today's
  "AromaOperator ACE count = 0" on a set is inherited, not self-held, and is contingent on the
  root staying as it is.
- `C:\Aroma`'s inherit-only DENY **stops at the protected root** and never reaches the sets,
  which is why a set that is itself unprotected is still safe.
- **Backup security depends on the root as a SINGLE CONTROL POINT.**

**It must never be written that each backup set is independently locked down.** It is not. The
single control point is a deliberate property with a real upside — no per-set drift, nothing to
get wrong on the fiftieth backup — but it is one lock, not many, and a future reader who
believes otherwise will misjudge the blast radius of one ACL edit.

---

## 14. Owner-issued `approvalId` — the authorization procedure

Adopted 2026-07-31. **No HMAC, no digital signature, no key management and no Authority Service
this round** — those are §15.

### The twelve rules

1. **The builder must not generate or suggest an actual `approvalId`.** Not a draft, not an
   example, not "something like appr_2026…". A value the builder proposes is a value the builder
   chose, and the Owner rubber-stamping it is not issuance.
2. Until the Owner issues one, the field stays **empty or an obvious placeholder**.
3. The Owner supplies a **fresh** `approvalId` himself, **outside this repo and outside the
   builder's process**.
4. The builder fills in **exactly** the value given, character for character. No normalising, no
   prefixing, no case changes.
5. `approvalId` is part of the **canonical Work Order and of `orderHash`** —
   `sealedOrderGate.js:84`.
6. Once it is filled in, the canonical JSON and its SHA-256 are **recomputed**. A hash computed
   before the id was known is meaningless.
7. The builder returns the **complete final canonical JSON and the final hash** to the Owner. Not
   a summary, not a diff — the bytes that will be executed.
8. The Owner **explicitly confirms that final hash**.
9. **No execution without that confirmation.** An unconfirmed hash is an unapproved order.
10. **Any field change voids the old hash and the old confirmation.** Not "probably stale" —
    void. The gate enforces it mechanically: a changed field changes the hash, and a stale
    `orderHash` fails `order_hash_mismatch`.
11. **One `approvalId`, one Work Order, one use.** Enforced by the registry's spent ledger rather
    than by discipline: a second admission of the same id is refused `approval_id_already_used`,
    whatever it was spent on and however it ended.
12. The **EXECUTE GO must cite both** the `approvalId` and the Owner-confirmed final hash. A GO
    naming only one of them does not identify a unique executable object.

### What SHA-256 does and does not do here

It proves **the content has not changed since the Owner confirmed that hash**. That is all.

It is **not** proof of identity, authorship, provenance or authority. The hash is computed from
public data by a public function; anyone able to run the builder can compute a valid hash for any
content. Under this procedure the authority lives entirely in **the Owner having issued the id
out of band and having confirmed the final hash through a channel the builder does not control**.
The hash must not be described as proof of origin anywhere.

### The circularity, and how the procedure resolves it

`approvalId` is inside the hash, so it must exist before the hash does. Hence the ordering:
**issue → fill → recompute → return → confirm**. The Owner confirms a hash that already contains
his id, and never confirms a hash that then changes.

## 15. v2 Authority Roadmap — the identity gap, recorded

**The gap:** this procedure has **no cryptographic proof of Owner identity**. It rests on an
out-of-band human channel. For one canary, run by the Owner at his own machine, with the flag off
by default and one live order at a time, that is a defensible place to stand — and it is a gap,
written down as one rather than left implied.

It must be closed **before any of**:

- **standing authority** — an approval authorising more than one specific run;
- **multi-file or open-ended work orders** — where the content is too large to eyeball, so the
  hash becomes the only thing anyone actually checks;
- **remote or unattended execution** — where no human is present to have issued anything.

Two candidate designs, to be chosen when it matters:

- **Secret-backed signature.** A key only the Owner holds; the gate verifies a signature over the
  canonical hash. The cleanest fix, and it argues for taking `approvalId` *out* of the hash so
  approval becomes a signature *over* the work rather than a field *inside* it.
- **An independent Authority Plane.** A separate service that issues and records approvals, which
  the gate consults. Heavier, and the right shape once approvals outlive a single conversation.

## 16. The registry is now wired into the executor

Previously `orderRegistry` guarded the dry-run planner and nothing else — its single-live-order
rule, its nonces and its expiry were real and reached no code that could touch a desktop. The
guarantee sat beside the risk rather than over it.

### Order of operations

```
validateOrder            seal, hash, path, limits, flag, kill switch      (sealedOrderGate)
registry.admit           approvalId, workOrderHash, stepCount, timeoutSec  <- BEFORE any action
admission audit          durable                                          <- BEFORE any action
  per step:
    step-start audit     durable                                          <- BEFORE the step
    consumeStep(nonce)   burns the nonce                                  <- BEFORE the action
    the desktop action
    step-outcome audit   durable
registry.close           on success — frees the single live slot
registry.invalidate      on ANY failure — terminal, never reopened
```

### State transitions

| From | Event | To | Slot | approvalId |
|---|---|---|---|---|
| — | `admit` ok | LIVE | held | spent |
| — | `admit` refused | — | free | untouched |
| LIVE | all steps + `completed` audit | CLOSED | freed | spent forever |
| LIVE | any failure, abort, audit failure | INVALIDATED | freed | spent forever |
| LIVE | window elapses | EXPIRED (swept) | freed | spent forever |
| CLOSED / INVALIDATED / EXPIRED | anything | — | — | `approval_id_already_used` |

There is no transition back to LIVE. Cleanup tidies a desktop; it does not reopen an order.

### Fail and crash semantics

- **The nonce burns after the step-start audit and before the action.** If the process dies in
  that window the nonce is **already spent**. Consuming after the action would leave a window
  where a crash is indistinguishable from "never ran", and the only way out of that is guessing.
  A step whose outcome nobody can evidence must not be retryable.
- **Recovery is a new `approvalId` and a new Work Order.** Never a resume. That returns the
  judgement to the Owner.
- **An admitted-but-unrecordable order burns the approval** and frees the slot: zero desktop
  actions, and no quiet retry under the same authorisation.
- **A timeout is not a retry.** Expiry retires the id into the spent ledger.

### Registries: SEPARATE — decided, with reasons

The dry-run planner and the executor hold **different registry instances**, and the executor's is
created in exactly one place (`computerOperatorWiring.js`).

Sharing one was considered and rejected. A dry-run would occupy the single live slot, so
**planning an order would block executing it** — a self-inflicted denial of service on the only
path that matters. Worse, a shared registry would let a dry-run **consume the real order's step
nonces**, after which the executor would refuse its own steps as replays.

They govern **different resources**. The supervisor's registry books a planning slot that reaches
nothing; the executor's books **the desktop**. Both being live at once is therefore not a
contradiction — it is two independent bookings of two different things, and the invariant that
matters, *at most one order can cause a desktop action*, holds because exactly one registry
governs the desktop.

The asymmetry is explicit: the planner's registry is `singleUse: false` (a plan may be re-run),
the executor's is single-use by default (an approval may not). Both halves are tested in
`executorRegistryWiring.test.js`, including that a live plan cannot block a real run.

## 17. Sealed draft — NOT executable

```json
{
  "orderId": "wo_canary_notepad_1",
  "approvalId": "",
  "sealed": true,
  "sealedText": "Aroma Computer Operator canary. Round 1.",
  "allowedPath": "C:\\Aroma\\ComputerOperator-Test",
  "maxSteps": 3,
  "timeoutSec": 300,
  "orderHash": "",
  "steps": [
    { "n": 1, "action": "open_app", "appId": "notepad" },
    { "n": 2, "action": "type_text", "text": "Aroma Computer Operator canary. Round 1.",
      "bind": { "processId": null, "sessionId": null, "windowHandle": null, "uiaControlId": null } },
    { "n": 3, "action": "save", "fileName": "canary-1.txt",
      "bind": { "processId": null, "sessionId": null, "windowHandle": null, "uiaControlId": null } }
  ]
}
```

`approvalId` and `orderHash` are **empty on purpose**. Per rule 1 the builder does not invent an
id, and per rules 6–8 the hash cannot exist until the Owner's id is in the document. The `bind`
values are `null` because they are captured from step 1's real result at run time.

The earlier hash `df26f090…` was computed with a placeholder approval and is **void**. The final
hash will be produced only after the Owner issues an id, and returned in full for confirmation.

**This draft is not executable**, and not by convention: `verifySeal` refuses it —
`order_not_approved` on the empty `approvalId`, and `order_not_sealed` on the empty hash.
