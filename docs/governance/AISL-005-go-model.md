---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-005 — The GO Model (Plane-Scoped) + The Policy Layer

**GO is not a single concept.** It splits by **Plane**. This is Owner decision 1.

## 1. The two GOs

### Business GO
- **Who may issue it:** Owner **and** Executive Director.
- **What it approves:** Business Plane operations only — proposals, purchasing,
  inventory/recipe/menu/supplier/scheduling changes, business finance/HR actions,
  and the like.
- The Executive Director's Business GO is what makes them operationally
  autonomous: they can run the business without the Owner in the loop for
  ordinary Business operations.

### Governance GO (Owner GO)
- **Who may issue it:** **Owner ONLY.**
- **What it approves:** any modification to **Aroma itself** — prompt, memory,
  AISL, policy/thresholds, connector, MCP, desktop agent, worker, workflow engine,
  security, repo, deployment, source, and the permission model.
- No other role can issue it, and no session other than the Owner's even contains
  the capability to (AISL-003 T1).

> **A Business GO can never authorize a Governance change, and a Governance
> change can never be approved by anyone but the Owner.** The GO you hold is
> scoped to the Plane you operate in.

### Approval Integrity (all approval types)

Every approval (Business GO, Governance GO, and any High-Risk approval) MUST bind
to the complete action payload. An approval is one-time and MUST NOT be replayed,
transferred, or applied to any other action. Every approval MUST have an expiry.
If the action payload changes in any way, the prior approval is immediately void
and the action MUST be re-approved. Technical mechanisms (nonce, payload hash,
expiry duration) are deferred to the implementation specification.

## 2. The Policy Layer (Owner decision 3) — a distinct enforcement layer

Between **Role** and **Tool** sits the **Policy Layer**. The full chain is:

```
  Plane  →  Role  →  Policy  →  Tool
  (Business vs      (who has   (extra gates:      (capability
   Governance —      access)    threshold,         finally
   authoritative,               dual-approval,     executes)
   evaluated first)             office-hours,
                                geo restriction,
                                maintenance-mode,
                                spending-limit)
```

- **Plane** decides Business vs Governance (authoritative — evaluated first;
  AISL-007).
- **Role** decides whether the actor has access at all.
- **Policy** applies **extra gating** to an otherwise-permitted action.
- **Tool** finally executes (only if all prior layers cleared).

> **All future thresholds, dual-approval rules, office-hours windows, geo
> restrictions, maintenance-mode switches, and spending limits belong to the
> Policy Layer** — not to Role, not to Plane, and never as a new plane.

Policy configuration itself (setting a threshold, a spending limit, a
maintenance-mode toggle) is a **Governance action** — Owner-only, via the
Governance GO. The Business Plane cannot edit its own gates.

## 3. High-Risk Business (Owner decision 2) — a POLICY, not a plane

**High-Risk Business stays IN the Business Plane.** It is a **Policy Layer** on
top of Business operations — **NOT a third plane.**

> **Explicit constraint for all future docs and implementation: High-Risk must
> NOT evolve into a separate plane.** There are exactly two planes (Business,
> Governance). High-Risk is a set of Policy gates inside the Business Plane.

High-Risk operations (illustrative): large payments, bulk deletion, staff
termination, sensitive data export, and other irreversible operations.

- **Mechanism:** threshold and/or dual-approval **gating** — e.g. a payment above
  an Owner-configured amount requires a second approver, or Owner co-sign.
- **It is a gate, NOT a prohibition of the Executive Director's GO.** The
  Executive Director still holds the Business GO for High-Risk items; the Policy
  Layer just adds a threshold/dual-approval condition before the tool executes.
- **Thresholds are Owner-configured.** Changing a threshold is a **Governance
  action** (Owner-only) — the Executive Director cannot raise their own limit.

**Dual Approval Independence.** The two approvers in any dual-approval MUST be
distinct identities. They MUST NOT share the same session. The same person MUST
NOT satisfy dual-approval by using two different roles. No single approver may
substitute for the second approval.

**Anti-Threshold-Splitting.** High-Risk thresholds MUST NOT be evaded by splitting
transactions, staggering timing, batching deletions, or batching exports. The
policy MUST be able to evaluate cumulative effect within a reasonable time window.
The specific window, amounts, and algorithm are deferred to the implementation
specification.

## 4. Worked ordering

1. Classify the command's **Plane**. Governance → Owner GO required, and the
   capability exists only in an Owner session. Business → continue.
2. Check **Role** access to the Business resource.
3. Apply **Policy** gates (High-Risk threshold, dual-approval, office-hours,
   spending-limit, maintenance-mode).
4. If all clear, the **Tool** executes under the appropriate **Business GO**.

## 5. Absolute redlines — override ALL roles, GOs, and thresholds

Some actions are **never** delegated to any role, GO, threshold, or automation:

- **TD Bank access is READ-ONLY** — no automated or delegated movement of funds.
- **Government filings are HUMAN-EXECUTED** — never auto-filed by Aroma or any
  role.

Absolute redlines sit above the entire chain: no Business GO, no Governance GO, no
threshold configuration, and no role can override them. They are the outermost
fail-closed boundary.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Plane-scoped GO (Business GO: Owner +
  ExecDir; Governance GO: Owner only); the Policy Layer (Plane→Role→Policy→Tool);
  High-Risk as a Policy inside the Business Plane (never a third plane); absolute
  redlines override everything.
- **v1.0 before-merge amendment — 2026-07-12.** Added Approval Integrity
  (A-01, payload-bound / one-time / expiring / re-approve-on-change), Dual Approval
  Independence (A-02, distinct identity + distinct session), and
  Anti-Threshold-Splitting (A-07, cumulative effect within a window). Additive; no
  existing clause changed. (Status remains DRAFT.)
