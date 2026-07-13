---
Version: 1.0
Status: APPROVED
Classification: Governance Data — Owner-only
Approved-by: Louie
Approval date: 2026-07-13
Last-Updated: 2026-07-12
---

# AISL-006 — Threat Model

AISL's threat model assumes the LLM is fallible and any single account may be
compromised. Enforcement is structural (AISL-v1.0 §2), so containment does not
depend on the model behaving.

## 1. Threat: Prompt Injection

- **Vector:** malicious instructions in observed content (web pages, documents,
  emails, tool results, file names) attempting to make Aroma act beyond its
  authorization.
- **Containment:** the injected instruction can only ask for capabilities the
  session already has. Governance tools/data are **absent** from non-Owner
  sessions (AISL-003/004), so an injection into an Executive Director or lower
  session **cannot** reach Governance actions — there is no tool to invoke.
  Observed content is data, never commands.

## 2. Threat: Executive Director Compromise (primary)

An attacker gains control of an **Executive Director** account (stolen session,
malware, coerced operator, or a model fully subverted by injection).

**What the attacker CAN do (bounded):**
- Business-Plane damage within Executive Director authority — e.g. create
  proposals, alter inventory/menu, direct ordinary purchasing.
- **Further limited on High-Risk** by Policy-Layer threshold/dual-approval gates
  (AISL-005 §3): large payments, bulk deletion, terminations, and sensitive
  exports require a second approver or Owner co-sign, so a lone compromised
  Executive Director cannot unilaterally execute them.
- **Bounded absolutely** by the redlines (AISL-005 §5): TD Bank stays read-only;
  government filings stay human-executed — regardless of the compromise.

**What the attacker CANNOT do (structural):**
- **Control or modify Aroma** — no prompt/memory/AISL/policy/permission tool in
  the session.
- **Build or alter an agent/connector/MCP/worker/workflow engine** — no T2 tool
  present.
- **Leak core architecture, source, or the permission model** — Governance Data
  is not projected into the session (AISL-004).
- **Clone Aroma** — the architecture/source/secrets needed to reproduce it are
  absent.
- **Read or exfiltrate secrets** — Secrets are ❌ for the Executive Director and
  their values are never output to any role (AISL-004 §4).
- **Elevate privilege / assign the Owner role / grant Governance authority** — no
  permission-model tool present; role assignment is Owner-only.
- **Issue a Governance GO** — the capability does not exist in the session.

**Why:** the Governance Plane is **structurally isolated** — its tools and data
are absent from the Executive Director session, not refused on request. There is
no capability to unlock, so a compromised account, a jailbreak, or a subverted
model cannot cross into Governance.

## 3. Threat: Malicious/Confused Model

- **Vector:** the LLM itself produces an unauthorized action.
- **Containment:** the model is the **last and least-trusted** layer (AISL-v1.0
  §3). It can only call tools present in the session and read data projected into
  it. Its worst case is bounded exactly as §2 — Business-Plane, gated on
  High-Risk, blocked from Governance and secrets.

## 4. Threat: Ungated Channel / New Autonomous Surface

- **Vector:** a new capability (e.g. a connector) accidentally becoming a path to
  execution or Governance.
- **Containment:** every new surface is built to the **read-only allowlist /
  structural-absence** principle. The Phase-2 connector (AISL-008) exposes only
  five read tools, holds no secret, and has no code path to a write or Governance
  action — it cannot re-breach the execution gate (B2-9) because it cannot reach
  confirm/claim/dispatch at all.

## 5. Threat: Secret Exposure

- **Vector:** a token/key surfaced into a session, log, or response.
- **Containment:** secrets are held locally, injected in place, and **never
  output** to any role (AISL-004 §4); a fail-closed check refuses privileged
  operation when a secret is unconfigured rather than falling back to a default.

## 6. Residual risk & assumptions

- **Compromised OWNER** is outside structural containment by design — the Owner is
  the root of trust. Owner credential hygiene, secret custody, and out-of-band
  approval discipline are the mitigations. (NEEDS-VERIFICATION: Owner-session MFA
  and secret-store hardening — operational, not covered by these docs.)
- The runtime/deployment carrying these guarantees (desktop agent, connector,
  ingress) must be implemented to conform to AISL before the guarantees hold —
  the documents specify; implementation must comply.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Threat set incl. Executive Director
  Compromise: bounded Business damage (gated on High-Risk, capped by redlines),
  structurally blocked from Governance, secrets, cloning, elevation, and the
  Governance GO via plane isolation.
- **v1.0 APPROVED — 2026-07-13.** Before-merge amendments A-01~A-10 applied; Owner approval reference: GO，Merge AISL v1.0 並轉 APPROVED — 2026-07-13
