---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-007 — Governance Invariants

The constitutional, non-negotiable rules of the Aroma Runtime. Any future
document, design, or implementation that contradicts an invariant is **invalid**
until this document is amended by the Owner via the Governance GO.

## INV-1 — Plane is authoritative (Owner decision 4)

> **Every permission derives from Plane classification BEFORE role evaluation.
> Always evaluate Business-vs-Governance Plane FIRST, THEN role. Never
> reverse-derive Plane from Role.**

A command is first classified as Business or Governance. Only then is role
considered. It is forbidden to infer a command's plane from the actor's role (that
would let a powerful role pull an action into the "wrong" plane). Plane → then
Role → then Policy → then Tool.

## INV-2 — The Policy Layer is a distinct layer

Enforcement order is **Plane → Role → Policy → Tool** (AISL-005 §2). Thresholds,
dual-approval, office-hours, geo restriction, maintenance-mode, and spending
limits are **Policy**, applied after Role and before Tool. They are never merged
into Role and never made a plane.

## INV-3 — GO is plane-scoped

The **Business GO** (Owner + Executive Director) approves only Business
operations. The **Governance GO** (Owner only) approves any modification to Aroma
itself. A Business GO can never authorize a Governance change.

## INV-4 — Executive Director operational autonomy

The Executive Director holds **full Business-Plane authority including the
Business GO**, and can run the business without the Owner in the loop for ordinary
Business operations.

## INV-5 — High-Risk is gating, not prohibition — and never a third plane

High-Risk Business operations are **gated** (threshold / dual-approval) inside the
Business Plane; the Executive Director's GO is **not** removed for them.
**High-Risk must never become a separate plane** — there are exactly two planes.

## INV-6 — Thresholds are Governance-configured

All Policy thresholds/limits are set by the **Owner** via the Governance GO. No
Business-Plane actor may change a gate that constrains them.

## INV-7 — Absolute redlines override everything

TD Bank stays **read-only**; government filings stay **human-executed**. No role,
GO, threshold, or automation can override an absolute redline.

## INV-8 — Two-Plane isolation is structural

Governance-Plane tools and data are **absent** from non-Owner sessions, not
present-and-refused. The Owner is the only actor in both planes.

## INV-9 — Compromise containment

A compromised non-Owner account is confined to its plane and gates (AISL-006). It
cannot cross into Governance, secrets, cloning, elevation, or the Governance GO,
because those capabilities are not present to abuse.

## INV-10 — Enforcement is structural, not prompt-based

Authorization is enforced by tool/data allowlists (structural absence), never by
instructions asking the model to refuse. The LLM is the last, least-trusted layer.

## INV-11 — Fail-closed everywhere

Unknown tool, invalid identifier, invalid/absent authentication, untrusted origin,
missing configuration, or any uncertainty → **refuse all**. Never default open,
never guess.

## INV-12 — Secrets are never output

No role — including the Owner — receives a secret value as output. The Owner may
see **status only**. Secrets are held locally and used in place.

## INV-13 — Confirm and the Governance GO are Owner-authorized where governance is concerned

Execution authorization (Confirm / claim / dispatch — B2-9 and successors) remains
gated; any change to the governance of execution, or any Governance action, is
**Owner-only** via the Governance GO. Automation may prepare and surface, never
self-authorize a Governance change.

## INV-14 — Approval Integrity

Approvals bind payload, are one-time, expire, and re-approve on change. Every
approval (Business GO, Governance GO, and any High-Risk approval) binds to the
complete action payload; is single-use and MUST NOT be replayed, transferred, or
reused; MUST have an expiry; and is immediately void — requiring re-approval — if
the action payload changes in any way. (See AISL-005, "Approval Integrity".)

## INV-15 — Audit Immutability

The audit log is append-only. Historical audit records MUST NOT be deleted,
modified, overwritten, concealed, or reordered by any role, including the Owner and
all Governance Roles. No permission, Governance GO, maintenance operation, or
administrative function may authorize rewriting historical audit records. Any
correction, annotation, reversal, or superseding decision MUST be recorded as a new
appended entry that references the original record; the original record remains
intact. All GO decisions, approvals, policy evaluations, tool executions, failures,
and attempted bypasses MUST be traceable. Storage and cryptographic mechanisms are
deferred to the implementation specification.

## INV-16 — Non-Bypass Enforcement

No operation may bypass the Plane → Role → Policy → Tool → Data → LLM enforcement
chain. This applies uniformly to UI, Desktop Agent, MCP, worker, direct API, and
background jobs. No operation may skip the chain because it originates from an
internal service or an Owner session.

## INV-17 — Classification Integrity

Plane classification is a Governance action; unclassified items are fail-closed
(never presumed Business). New tools, data types, resources, and actions MUST NOT
enter any Business Plane allowlist before an Owner-approved classification is
complete; an unclassified, unclear, or insufficiently-evidenced item is refused by
default and MUST NOT be presumed Business from its source, name, purpose, caller's
role, or hosting service; adding/modifying/reclassifying requires an Owner
Governance GO. (See AISL-003 §6 and AISL-004 §6.)

## Invariant Priority

When invariants conflict, the higher-priority invariant prevails, in this order:

1. **Absolute Redlines** (INV-7)
2. **Fail-Closed** (INV-11)
3. **Plane Is Authoritative** (INV-1)
4. **Policy Gating** (INV-2)
5. **Role Authority** (INV-4)

## Amendment

These invariants may be amended **only** by the Owner via the Governance GO, with
the change recorded in git history (this document's Changelog). No Business-Plane
actor and no automation may amend them.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Thirteen invariants, headlined by INV-1
  (Plane authoritative, evaluated before Role) and INV-2 (the Policy Layer as a
  distinct layer in Plane→Role→Policy→Tool).
- **v1.0 before-merge amendment — 2026-07-12.** Appended four formal invariants —
  INV-14 Approval Integrity (A-01), INV-15 Audit Immutability (A-03), INV-16
  Non-Bypass Enforcement (A-04), INV-17 Classification Integrity (A-05) — bringing
  the set to seventeen (INV-1..INV-17, consecutive; INV-1..13 unchanged). Added the
  Invariant Priority section (A-08): Absolute Redlines > Fail-Closed > Plane Is
  Authoritative > Policy Gating > Role Authority. Additive; no existing invariant
  changed. (Status remains DRAFT.)
