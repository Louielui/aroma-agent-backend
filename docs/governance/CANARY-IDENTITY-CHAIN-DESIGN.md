# Canary execution chain — the AromaOperator identity design

**PREPARE ONLY. Nothing here is wired. The fence is shut and stays shut until it is.**

## 0. What went wrong, stated plainly

The canary was designed, sealed, approved, unlocked — and on the first real press of `E` it
refused with "the folder's permissions cannot be read from here". The refusal was correct. What
it exposed was not.

`run-notepad-canary.js:156` calls `built.executor.execute(...)` **directly**. The Companion is
constructed at `computerOperatorWiring.js:85` and then **never used**. So the whole chain —
node, PowerShell, `uiaCanary.ps1`, `Start-Process notepad` — inherits the token of whoever
double-clicked Step 2. That is `AROMABRAIN\louis`.

Every containment property this project spent weeks measuring belongs to **AromaOperator**: the
separate account, the separate session, the non-elevated token, the DENY around `C:\Aroma`. None
of them applied to the path that was about to run.

**The gap was not in containment. It was that nobody ever asked who was running.** A preflight
can check a folder, a hash, a flag and an audit sink, and still be checking the wrong process's
world. The ACL check was unsatisfiable for louis precisely *because* the folder was correctly
permissioned for someone else — the check failed for the right reason and pointed at the wrong
thing.

Running Step 2 elevated would have "fixed" it by opening an **elevated Notepad**: a cure worse
than the disease, and the reason option A was refused.

## 1. The chain, as ruled

```
Owner (louis, non-elevated)
  |
  |  reads the summary, presses A            Owner-Approve.ps1
  |  -> receipt: work order + execution package, signed by consent
  |
  |  presses E                               Owner-Execute.ps1
  |  -> SUBMITS A REQUEST. It does not execute anything.
  v
SessionGate / IPC  (named pipe, one fixed request shape)
  |
  v
Companion  — inside AromaOperator's own interactive session
  |  1. attests its OWN identity  ....... identityAttestation.js   [BUILT]
  |  2. re-verifies receipt + package hash
  |  3. preflight AS ITSELF: ACL readable, folder empty, file absent
  |  4. registry admission + durable admission audit
  |  5. executor.execute(receipt.approvedOrder)
  v
desktopAdapter -> uiaCanary.ps1 -> Notepad     all as AromaOperator, non-elevated
```

The Owner's side never requires the executor, never requires the adapter, never spawns UI
automation, and passes no command, path, text or argument. It submits an approvalId and nothing
else — the work order travels inside the receipt, which the Companion reads for itself.

## 2. Identity attestation — **BUILT**

`src/computer/identityAttestation.js`, 12 tests. Pure comparison over a snapshot the Companion
takes **of itself, immediately before acting**. Every field must be present; a field that could
not be measured is a refusal, never a partial pass.

| Checked | Refusal |
|---|---|
| SID equals the pinned operator SID | `wrong_identity` |
| account name agrees with the SID | `identity_name_mismatch` |
| token not elevated | `elevated_token` |
| no Administrators / SYSTEM / Backup Operators / High or System integrity SID in the token | `privileged_group` |
| integrity level is Medium | `wrong_integrity` |
| sessionId > 0, and equals the admitted session | `bad_session` / `wrong_session` |
| interactive | `not_interactive` |
| desktop is `WinSta0\Default` | `wrong_desktop` |
| every required field present | `incomplete_attestation` |

Pinned **by SID**, not by name: a recreated account with the same name is a different principal
wearing the same label. The **groups** are checked as well as elevation, because non-elevated is
not the same as unprivileged — a token can carry Administrators and simply not have it enabled.

## 3. The gaps — named, not glossed

| # | Gap | Why it blocks |
|---|---|---|
| **G1** | **The Companion has no adapter.** `companion.js` imports `sessionBoundary`, `sealedOrderGate`, `computerOperatorFlag` and `observation`. It reaches no executor and no adapter; an executor arrives only by injection, and nothing injects one. | Without this there is no path from the Companion to a desktop at all. |
| **G2** | **No SessionGate / IPC request path for execution.** `ipcChannel.js` exists and `phase3aChannel` proves a named-pipe round trip, but the message types are the 3a set. There is no execute-request envelope carrying an approvalId. | The Owner's press of E cannot reach the Companion. |
| **G3** | **The Companion process is not running as AromaOperator today.** `deploy-companion.ps1` launches it with credentials, but only during a deploy. There is no standing Companion in an interactive AromaOperator session. | AromaOperator must be **logged in interactively** for a desktop to exist. Session 0 has no desktop and UIA finds nothing there. |
| **G4** | **Nothing gathers the attestation snapshot.** `identityAttestation.js` compares; the PowerShell that measures `WindowsIdentity`, token groups, integrity level, session and desktop does not exist. | The attestation is a judge with no evidence yet. |
| **G5** | **The folder ACL grants AromaOperator, and the preflight runs on the Owner's side.** Both the ACL check and the folder checks must move into the Companion, which can actually read them. | Otherwise the same failure recurs with better wording. |

**None of these may be worked around by borrowing the Owner path.** The narrowest honest wiring
is: G4 (a measurement script), then G2 (one request type), then G1 (inject the executor into the
Companion exactly as `computerOperatorWiring` already does), then G3 (an operational decision
about a logged-in AromaOperator session). G5 falls out of G1.

**G3 is the one that is not a coding problem.** A desktop requires an interactive logon. Whether
AromaOperator is logged in at the console, or on a second session, or via a means the Owner
chooses, is his decision and it changes what the canary demonstrates.

## 4. Failure and cleanup semantics

Unchanged from the executor, and now preceded by identity:

- attestation fails → **zero desktop actions**, recorded, order invalidated, approval spent;
- admission audit unwritable → zero desktop actions;
- step-start audit unwritable → that step does not run;
- nonce burns **after** the step-start audit and **before** the action, so a crash in that window
  leaves it spent — recovery is a new approval, never a resume;
- outcome audit unwritable → later steps do not start, cleanup runs;
- cleanup closes only the process the run opened, and never reopens the order;
- `COMPUTER_OPERATOR` is restored in a `finally` and re-verified in all three scopes.

## 5. Evidence a completed run must produce

Notepad's process owner, process and session id, non-elevated token proof, the exact file path,
its content hash, its file owner, the full step audit chain, Notepad closed, the flag back to
OFF, and a statement that no other desktop action and no other file write occurred.

## 6. Current state

Fence shut. The Owner's receipt `appr_fee3be6a…` is marked
**SUPERSEDED — WRONG EXECUTION IDENTITY — NOT EXECUTABLE** by a sidecar file; the receipt itself
is byte-identical to what he signed, because a signed record that gets amended afterwards is no
longer the thing that was signed. It never entered the spent ledger as an execution.
