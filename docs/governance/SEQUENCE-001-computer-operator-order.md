# SEQUENCE-001 — the order Computer Operator work happens in

**Owner ruling, 2026-08-05. Recorded so it survives the conversation it was decided in.**

**Nothing here is started.** This is the order, not the work.

---

## The ruling, and the reason

> **Not now.** Agent Bridge went live today and has not been used in anger yet. Turning it
> off to try a capability that is not even wired into the running backend would trade a
> working thing for an experiment.

The four-flag gate makes this a genuine either/or, not a matter of preference. Measured live
on 2026-08-05:

```
AGENT_BRIDGE=on   COMPUTER_OPERATOR=off  ->  agent_bridge_authorized     ← today
AGENT_BRIDGE=on   COMPUTER_OPERATOR=on   ->  configuration_conflict      ← BOTH dead
AGENT_BRIDGE=off  COMPUTER_OPERATOR=on   ->  not_authorized (no runner configured)
```

Turning Computer Operator on **without** turning Agent Bridge off does not add a capability;
it removes the one that works. The launcher's own comment states the constraint.

---

## 1. WIRE-IN — currently on no list, and larger than it looks

`COMPUTER_OPERATOR` means nothing in the running app today. Two facts, both measured:

- `aroma-agent-backend/src/app.js` contains **0** references to `COMPUTER_OPERATOR`.
- `computerOperatorFlag.js` says so itself: *this string is read by nobody.*

### Scope, measured rather than estimated

The working code lives in **`C:\Aroma\aroma-3b`**, not in the backend. Of 24 non-test modules
in `aroma-3b/src/computer/`, the backend has **10**. The **14 missing ones are the ones that
do the work**:

| missing | what it is |
|---|---|
| `computerExecutor.js` | performs the actions |
| `computerOperatorWiring.js` | the wiring itself |
| `sealedOrderGate.js` | the gate that authorises a sealed order |
| `desktopAdapter.js`, `observation.js`, `machineProbe.js` | the observation surface |
| `powershellJsonRunner.js`, `powershellHazards.js` | the PowerShell boundary |
| `companionCanaryRunner.js`, `companionProductionFactory.js` | how a Companion is built |
| `executeRequestSchema.js`, `executeRequestStore.js` | the request contract |
| `assertionRegistry.js`, `measurementContext.js` | the evidence machinery |

### ⚠️ AND ALL TEN SHARED MODULES HAVE DIVERGED

Every one of the ten that exists in both repos differs between them — `companion.js`,
`computerAudit.js`, `computerWorkOrder.js`, `evidenceStore.js`, `killSwitch.js`,
`orderRegistry.js`, `sessionBoundary.js`, `ipcChannel.js`, `computerSupervisor.js`,
`computerOperatorFlag.js`.

**So wire-in is not a copy.** It is a merge of two versions of ten safety-relevant modules,
each of which has to be adjudicated rather than picked.

### A concrete instance of that divergence, today

The `windowTitle` removal committed on 2026-08-05 (`32fbebf`) was applied to the **backend**
copy of `computerAudit.js`. **`aroma-3b`'s copy still carries `windowTitle` as a live evidence
field.**

> **HARD CONDITION ON WIRE-IN:** whichever copy wins the merge, `windowTitle` must not come
> back. The Owner's reason stands whatever the file path is — a window title can carry a
> customer name or an email subject, and the audit mirror sends `.aroma/computer-audit/` to
> Backblaze nightly. Re-check it explicitly at merge time; do not assume the newer file is
> the safer one.

### What "done" would mean for this item

The flag read in the live app, the executor and gate reachable from it, the ten divergences
adjudicated with a written reason each, and the whole thing still inert with the flag off —
proven the way the M-3 fix was proven, by measurement rather than by reading.

---

## 2. THE SEVEN REMAINING 3b ITEMS

From `PHASE3B-HANDOFF.md` §「3b REMAINING」, unchanged:

| # | item | status |
|---|---|---|
| R1 | cross-session desktop object, both directions | **not proven — no route** |
| R2 | `E4` clipboard verify | unfinished; needs an Owner-side `-Verify` run |
| R3 | Lock 5 third binding (`oskill`) | not demonstrated; does not gate DoD |
| R4 | Lock 3 deletion path in production | untested; needs a real file past 7-day retention |
| R5 | 37 unclassified evidence files | undeclared |
| **R6** | **`C4b` gate-script hash** | **INVALID (ACL)** |
| R7 | FINAL-REPORT for `6f6eff2178f0` | not written |

### 🚩 R6 IS FLAGGED, per the Owner

> **A gate script the Companion cannot read is a gate that is not checking anything.**

The Companion is required to hash the gate script and cannot open the file, so the check
returns INVALID rather than a verdict. That is not a failed check — it is an **absent** one
wearing a status. It sits in the same family as everything else corrected this week: a record
that reports a state it never measured.

It is listed sixth because that is where the handoff put it, **not** because it ranks sixth.
Ordering inside this list is open; R6 should be treated as first among them unless the Owner
rules otherwise.

Also unchanged, and worth restating because the id count flatters it: **Tier B is 4 of 11
adjudicated.** The number of registered assertion ids is not a measure of what has been
measured.

---

## 3. THE EXCLUSIVITY DECISION — last, and only when there is something to weigh

> **Owner: 「I will make it when there is something real to weigh against Agent Bridge.」**

Today there is not. Computer Operator cannot run in the live app at all, so the choice would
be between a working capability and an unwired one — which is not a choice.

After items 1 and 2, the comparison becomes real: a wired, inert-provable Computer Operator
against a working Agent Bridge, with the four-flag rule forcing one. **That decision is the
Owner's and is not implied by finishing the work above.**

---

## 4. CONCURRENCY WAS DESIGNED AROUND, NEVER DEMONSTRATED

**Recorded on Owner instruction, 2026-08-05, because it is exactly the kind of thing that
later reads as proven.**

 enforces, in code, that the MEASURING stage runs with the Companion
session  on the . The note beside it, dated 2026-07-31, records what
happened when the rule was stricter:

> launcher 4 refused with 「the Companion session is Disc, not Active」, and it was right to
> by the rule as written — but **the rule could never be met. Only ONE session is connected
> to the console at a time**, so the Companion session is Active only while somebody is
> switched INTO it; and Lock 3 needs elevation, which that account does not have. Both
> conditions cannot hold at once.

It was resolved by **narrowing what must be simultaneous** — identity stays invariant, state
is enforced only where the measurement happens. That was the right fix for the problem it
faced. **But it means concurrent operation was never tested.** The commissioning path
() has the Owner switching INTO the operator account, so at no
point did both sessions do work at the same time.

Nothing in the record is false about this. The risk is subtler: a reader arriving later sees
a session-state precondition, sees stages passing under it, and concludes the arrangement
was validated. **It was avoided.**

### The framing that was missing from both sides

The question was always posed as 「the operator works DISCONNECTED in the background」. On
this machine that is not the interesting configuration, because measured 2026-08-05:



The Owner is not on the console. So the configuration to test is **AromaOperator Active on
the CONSOLE while the Owner is Active over RDP** — two Active sessions, neither disconnected.
That **satisfies** the existing  requirement instead of fighting it, and no
part of the record considered it because the commissioning path assumed the Owner would be at
the console himself.

**Still not established.** A console session with no human at it may be locked, and a locked
session's rendering behaviour is the same open question. See
 — three primitives, three states, nine results,
and it needs no flag enabled because it is a Windows question rather than a Computer Operator
one.

---

## What must NOT happen

- Do not turn `COMPUTER_OPERATOR` on to "see what happens". With `AGENT_BRIDGE=on` the result
  is `configuration_conflict` and both channels stop.
- Do not weaken the four-flag rule to avoid the choice. Its value is that it is simple enough
  not to be reasoned about wrongly; an exceptions table has to be remembered.
- Do not treat `BACKLOG-002` (Targeted Notepad Save) as reopened by any of this. It is closed
  to further diagnostic rounds by Owner decision of 2026-08-02, and the only permitted
  statement is that the evidence available was **not sufficient** — never that it is
  infeasible.
