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

## Amendment

These invariants may be amended **only** by the Owner via the Governance GO, with
the change recorded in git history (this document's Changelog). No Business-Plane
actor and no automation may amend them.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Thirteen invariants, headlined by INV-1
  (Plane authoritative, evaluated before Role) and INV-2 (the Policy Layer as a
  distinct layer in Plane→Role→Policy→Tool).
