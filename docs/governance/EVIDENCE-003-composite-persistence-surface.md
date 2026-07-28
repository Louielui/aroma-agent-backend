# EVIDENCE-003 — composite surface: logon persistence

**Status:** KNOWN AND EXPLICITLY ACCEPTED — Owner ruling, 2026-07-28
**Scope:** `AromaOperator`, measured in its own interactive session

## Why this record exists

Containment Set v2 Tier A scores each row on its own. Several rows are individually
`ACCEPTED` and individually unremarkable — the account can write inside its own profile,
and it can register a scheduled task that runs as itself.

Read together they are a capability that **no single row names**:

> `AromaOperator` can store executable content and have it run automatically at its own
> next logon, with no further approval from anyone.

That is the failure mode of a per-row report: every row can be correct, every verdict
green or knowingly accepted, and the actual capability still goes unstated because it
lives in the combination. The Tier A probe now computes this section itself, so it cannot
be omitted from a future write-up by accident.

## Contributing rows

| Role | Rows |
|---|---|
| Storage | `A1-write-profile-root`, `A2-write-temp`, `A3-write-startup`, `A4-write-desktop` |
| Autostart | `A3-write-startup`, `C1-register-own-task`, `C2-register-logon-trigger`, `B1-hkcu-run`, `B2-hkcu-runonce`, `B4-hkcu-environment`, `B5-winnt-windows` |

`A3` appears in both: the Startup folder is storage and autostart in one object.

The redundancy matters. Removing any single mechanism does not remove the capability —
there are four independent storage locations and seven independent autostart mechanisms.
Any one storage plus any one autostart is sufficient.

## Actual boundaries

Each boundary below is a **measured row**, not an assurance. Where something has not been
measured it says so.

| Boundary | Established by | Status |
|---|---|---|
| Cannot write into the Owner profile | `A6-write-owner-profile` | measured |
| Cannot run as SYSTEM | `C3-register-as-SYSTEM` | measured, ACL/privilege |
| Cannot write machine-wide autostart (HKLM) | `B7-hklm-run` | measured, ACL |
| Cannot set per-user policy | `B6-policies-explorer` | measured, ACL |
| No credentials reachable | v1 17/17 in session 5 — EVIDENCE-002 | measured |
| Cannot elevate | account is non-admin; no privilege row permitted | measured |
| **Cross-session reach** | — | **NOT PROVEN** |

### Note on the cross-session line

The instruction that created this record listed "cannot cross session" among the
composite's boundaries. Ruling 3 of the same instruction requires cross-session
containment to be written as **not proven** everywhere until Tier B runs under 3b.

Ruling 3 governs. This record therefore does **not** claim cross-session isolation as a
boundary of the composite. Stating it as a bound here and as unproven elsewhere would put
a contradiction into the evidence, and the weaker of the two claims is the honest one.

Concretely: it is not established that this composite is confined to session 5. What is
established is everything in the rows above.

## What this means in practice

The persistence itself runs as `AromaOperator`: non-admin, no credentials, no elevation
path, confined to that account's own profile and hive. It is persistence of an already
contained identity, not an escalation.

The reason to record it rather than wave it through is that it changes the shape of any
future compromise. Anything that once executes as this account can arrange to execute
again at every subsequent logon, without needing to re-exploit anything. Containment
bounds what it can reach; it does not bound how long it stays.

## Consequences to carry forward

- Any 3b kill-switch or rollback design must assume the account may hold logon persistence,
  and must check all four storage and seven autostart mechanisms — not just the Startup
  folder, which is the obvious one and only one of seven.
- A future integrity check should baseline these locations and diff them, in the same way
  the SessionGate task's XML is now baselined before C4 touches it.
- This composite is accepted **as currently bounded**. If any bound in the table above
  stops holding, the acceptance does not carry over and must be re-decided.
