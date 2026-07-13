---
Status: COMPLETED
Classification: Governance Review
Authority: Non-authoritative review record
Related Constitution: AISL v1.0
Version: AISL v1.0 Review Pack v2
Related Branch: docs/aisl-v1.0 @ 7fbc14c
Related Documents: AISL-v1.0.md, AISL-001~AISL-009
Review Outcome: AISL v1.0 approved by Owner
Note: This is NOT part of the AISL constitution. It MUST NOT be treated as an authoritative permission source by any runtime, implementation, or agent. If it conflicts with the APPROVED AISL documents, the APPROVED AISL documents prevail. Evidence-based: every claim cites the actual file + section + verbatim quote or exact line number on disk.
Last-Updated: 2026-07-13
---

# AISL v1.0 — Owner Review Pack v2 (Evidence-Based)

This pack was produced by reading the ten actual AISL documents on branch
`docs/aisl-v1.0 @ 7fbc14c`. Every verdict below cites the real filename, section
heading, and verbatim line. Where something is absent, it is marked **NOT FOUND**
after searching all ten files — never assumed present.

## How to read this pack

For every point, three buckets are separated explicitly:

- **CONFIRMED FROM ACTUAL AISL TEXT** — quoted with file + line.
- **MISSING FROM ACTUAL AISL TEXT** — searched across all 10 files, not found; where it would belong is stated.
- **RECOMMENDED AMENDMENT** — what to add/change, and the timing: *before-merge*, *v1.1*, or *implementation-spec*.

---

## PART 1 — Crux Summary (the 11 STEP-4 integrity items)

This is the single most important table for the approval decision: the
**approval-integrity, audit-integrity, anti-splitting, and unclassified-data**
machinery is largely **NOT in the constitution text** — it is implementation-spec
material. The two-plane / role / GO / policy architecture, by contrast, is well
covered (Part 3).

| # | Integrity item | Verdict | Evidence / where-it-would-belong |
|---|---|---|---|
| 1 | Approval payload binding | **NOT FOUND** | no "payload"/"bind approval to proposal" in any file → belongs in AISL-005 + impl-spec |
| 2 | One-time approval / replay prevention | **NOT FOUND** | no "one-time/replay/nonce/single-use" → AISL-005 + impl-spec |
| 3 | Approval expiry | **NOT FOUND** | no "expiry/TTL/stale approval" → AISL-005 + impl-spec |
| 4 | Payload change requires re-approval | **NOT FOUND** | no "re-approval/re-confirm/payload change" → AISL-005 + impl-spec |
| 5 | Anti-transaction-splitting (cumulative window) | **NOT FOUND** | no "splitting/cumulative/rolling window" (the "splits by Plane" match at AISL-005:11 is unrelated) → AISL-005 High-Risk |
| 6 | Dual approval requires DISTINCT identity AND distinct session | **PARTIAL** | "requires a second approver, or Owner co-sign" (AISL-005:78; AISL-006:36) — but "distinct identity AND distinct session" is **NOT FOUND** |
| 7 | Audit append-only / immutable / non-bypass | **NOT FOUND** | "audit" appears ONLY as a readable business resource (AISL-002:41; AISL-003:23,55) — no immutability/append-only/non-bypass guarantee anywhere |
| 8 | Tool AND data classification is itself a Governance action | **PARTIAL** | TOOLS confirmed: AISL-003:60-64 "Adding or moving a tool is a Governance action … Owner-only … Tiering is not editable from the Business Plane." DATA-classification-as-a-Governance-action is **NOT explicitly stated** in AISL-004 |
| 9 | New/unclassified data defaults fail-closed (highest protection) | **NOT FOUND** | INV-11 fail-closed (AISL-007:77-81) is adjacent but generic; it does **not** say unclassified DATA defaults to highest protection |
| 10 | ED ✅ remains subject to Policy gating (✅ = may-initiate, not unconditional) | **PARTIAL** | gating-applies is confirmed (AISL-002:45-47; AISL-001:58-61) — but the ✅ legend (AISL-002:13) defines ✅ as "full authority" with **no** policy caveat; the explicit "✅ = may-initiate, not unconditional" wording is **NOT FOUND** |
| 11 | Absolute redlines override Owner, GO, threshold, all clauses | **CONFIRMED** | AISL-005:94 "override ALL roles, GOs, and thresholds"; :102-103 "no Business GO, no Governance GO, no threshold configuration, and no role can override them. They are the outermost"; INV-7 (AISL-007:56-59) |

**Crux tally: 1 CONFIRMED · 3 PARTIAL · 7 NOT FOUND.** The architecture is sound;
the **enforcement-integrity mechanics (items 1–5, 7, 9)** are absent from the text
and must be added (before-merge as principles, or as an implementation-spec that
the constitution references).

---

## PART 2 — Actual Invariants Review (AISL-007 as written)

The real invariants on disk are **INV-1 … INV-13** (verbatim titles, exact
numbering from `AISL-007-governance-invariants.md`):

| # | Verbatim title | Line |
|---|---|---|
| INV-1 | Plane is authoritative (Owner decision 4) | AISL-007:15 |
| INV-2 | The Policy Layer is a distinct layer | AISL-007:26 |
| INV-3 | GO is plane-scoped | AISL-007:33 |
| INV-4 | Executive Director operational autonomy | AISL-007:39 |
| INV-5 | High-Risk is gating, not prohibition — and never a third plane | AISL-007:45 |
| INV-6 | Thresholds are Governance-configured | AISL-007:51 |
| INV-7 | Absolute redlines override everything | AISL-007:56 |
| INV-8 | Two-Plane isolation is structural | AISL-007:61 |
| INV-9 | Compromise containment | AISL-007:66 |
| INV-10 | Enforcement is structural, not prompt-based | AISL-007:72 |
| INV-11 | Fail-closed everywhere | AISL-007:77 |
| INV-12 | Secrets are never output | AISL-007:83 |
| INV-13 | Confirm and the Governance GO are Owner-authorized where governance is concerned | AISL-007:88 |

**Conflicts:** none detected — the 13 are mutually consistent as written.

**Duplication / overlap (mild, not conflicting):**
- INV-1 (Plane before Role) and INV-2 (Policy Layer position) both encode the
  `Plane→Role→Policy→Tool` order (AISL-007:23-24, :28). Complementary.
- INV-8 (two-plane isolation structural), INV-9 (compromise containment) and
  INV-10 (enforcement structural) all rest on "structural absence." Coherent but
  overlapping.

**Missing (priority):** **no explicit precedence ORDER among invariants is
stated.** AISL-005:102-103 implies redlines are "outermost," but AISL-007 lists
INV-1..13 with no stated ranking for conflicts (e.g. does INV-7 redlines outrank
INV-3 GO in a clash?). → **Recommended amendment (before-merge):** add a one-line
precedence chain, e.g. *Absolute redlines (INV-7) > Owner/Governance-GO (INV-13/INV-3)
> Plane isolation (INV-8) > Policy (INV-2) > Role*.

**Missing (coverage):** there is no invariant for **approval integrity** (payload
binding/replay/expiry), **audit immutability**, **anti-transaction-splitting**,
**unclassified-data-fail-closed-to-highest**, or **dual-approval distinct
identity+session**. INV-11 (fail-closed) is the closest but generic. → these map
1:1 to the Part-1 NOT-FOUND items.

---

## PART 3 — Decision Register D-01 … D-18 (actual citations)

Each decision: file(s) + section, verbatim/line evidence, verdict.

### D-01 — Two-plane model
**CONFIRMED / COVERED.** `AISL-v1.0.md` §4 "The Two-Plane Model" (line 71); the
matrix precedence note `AISL-002:19-21` — "a resource's **Plane** is authoritative
and evaluated before role". Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-02 — Executive Director full-Business / zero-Governance
**CONFIRMED / COVERED.** `AISL-002:78` "**Executive Director = ✅ all Business
Plane · ❌ all Governance Plane.**"; `AISL-001:48` "**Full Business Plane
operational authority — including the Business GO.**" and `:53` "**ZERO Governance
Plane authority.**"; `AISL-003:39-41`; `AISL-004:42-43`. Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-03 — Plane-scoped GO
**CONFIRMED / COVERED.** `AISL-005:11` "It splits by **Plane**"; §1 Business GO
(`:15`) / Governance GO (`:24`); INV-3 (`AISL-007:33-37`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-04 — High-Risk as Policy, not a third plane
**CONFIRMED / COVERED.** `AISL-005:65` "## 3. High-Risk Business (Owner decision 2)
— a POLICY, not a plane"; `:70-71` "**must NOT evolve into a separate plane.**";
INV-5 (`AISL-007:45-49`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-05 — The Policy Layer
**CONFIRMED / COVERED.** `AISL-005:36` "## 2. The Policy Layer (Owner decision 3)
— a distinct enforcement layer"; the `Plane → Role → Policy → Tool` chain (`:38-52`);
INV-2 (`AISL-007:26-31`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-06 — INV-1 Plane authoritative
**CONFIRMED / COVERED.** `AISL-007:15` "## INV-1 — Plane is authoritative (Owner
decision 4)"; `:17-19` "**Every permission derives from Plane classification
BEFORE role evaluation … Never reverse-derive Plane from Role.**" Verdict:
**COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-07 — ED delete / Finance / HR / export scope
**PARTIALLY COVERED.** Finance/HR are ✅ for ED at the resource level
(`AISL-002:35-36`; `AISL-004:36,42`). Bulk deletion and sensitive export appear
**only as illustrative High-Risk examples** subject to gating (`AISL-005:75`
"large payments, bulk deletion, staff termination, sensitive data export"). There
is **no explicit ED-scoped rule** for delete/export beyond the example list.
Verdict: **PARTIALLY COVERED** (resource-level ✅ confirmed; delete/export only as
gated examples).

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-08 — Three-layer runtime
**CONFIRMED / COVERED.** `AISL-008` §1 Web Console (`:37`), §2 Desktop Agent
(`:45`, "**operations layer, not an authorization layer**" `:52`), §3 ChatGPT MCP
App (`:61`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-09 — Roadmap
**CONFIRMED / COVERED.** `AISL-009` "The sequence" (`:16`), steps 1–6
(`:18,23,29,35,41,48`): AISL → read-only connector → desktop agent → read loop →
GO-gated writes → UI last. Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-10 — Absolute redlines as system-level
**CONFIRMED / COVERED.** `AISL-005:94` "## 5. Absolute redlines — override ALL
roles, GOs, and thresholds"; `:102-103` "sit above the entire chain … outermost";
INV-7 (`AISL-007:56-59`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-11 — Approval integrity
**NOT COVERED.** There is no approval-integrity section. Payload binding, one-time/
replay, expiry, and payload-change→re-approval are all **NOT FOUND** (Part 1 items
1–4). The only related text is `AISL-005:78` "requires a second approver, or Owner
co-sign" — which is dual-approval, not integrity. Verdict: **NOT COVERED.** →
belongs in AISL-005 (principles) + implementation-spec.

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-12 — Threshold numbers
**NOT COVERED (by design).** No numeric thresholds anywhere; `AISL-005:78` uses "an
**Owner-configured amount**" and INV-6 (`AISL-007:51-54`) keeps thresholds
Owner-configured. Verdict: **NOT COVERED** — intentionally deferred to Policy
configuration, not the constitution. Recommend documenting that numbers live in
Policy config (implementation-spec), not here.

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-13 — Anti-splitting (of planes)
**CONFIRMED / COVERED** for **plane-splitting**: INV-5 (`AISL-007:45-49`)
"**High-Risk must never become a separate plane**"; `AISL-005:70-71`. **Caution:**
this is distinct from **transaction-splitting** (Part 1 item 5), which is **NOT
FOUND**. Verdict: **COVERED** (plane anti-splitting); transaction anti-splitting is
a separate gap.

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-14 — Dual-approval distinct approver
**PARTIALLY COVERED.** A second approver exists: `AISL-005:78` "a second approver,
or Owner co-sign"; `AISL-006:36` "a second approver or Owner co-sign". But
"**distinct identity AND distinct session**" is **NOT FOUND** (Part 1 item 6).
Verdict: **PARTIALLY COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-15 — Audit immutability + non-bypass
**NOT COVERED.** "audit" appears only as a readable business resource
(`AISL-002:41` "Business audit (read)"; `AISL-003:23,55`). No append-only,
immutability, tamper-evidence, or non-bypass guarantee exists anywhere (Part 1
item 7). Verdict: **NOT COVERED.** → new invariant + implementation-spec.

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-16 — Tool classification governance
**CONFIRMED / COVERED** for **tools**: `AISL-003:60-64` "## 5. Adding or moving a
tool is a Governance action … **Owner-only, via the Governance GO** … **Tiering is
not editable from the Business Plane.**" **Note:** the parallel rule for **data
classification** is not explicitly stated in AISL-004 (Part 1 item 8). Verdict:
**COVERED (tools)**; data-classification-as-a-Governance-action is a minor gap.

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-17 — Governance of modifying the AISL docs
**CONFIRMED / COVERED.** `AISL-007:11-13` "invalid **until this document is amended
by the Owner via the Governance GO**"; Amendment section `:95-99` "amended **only**
by the Owner via the Governance GO"; matrix "AISL documents ✅ Owner ❌ others"
(`AISL-002:56`); modify-AISL is a T1 tool (`AISL-003:20`). Verdict: **COVERED.**

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


### D-18 — Status DRAFT → APPROVED on merge
**PARTIALLY COVERED.** Every file carries `Status: DRAFT (awaiting Owner approval)`
(`:3`) and `Approved-by: (pending Louie)` (`:5`); `AISL-v1.0:112` "This set is
**DRAFT** until the Owner (Louie) approves it." But there is **no defined
transition mechanism** stating that *merge = APPROVED* or how/where `Status:` and
`Approved-by:` flip. Verdict: **PARTIALLY COVERED** (DRAFT state + "until Owner
approves" present; the DRAFT→APPROVED-on-merge process is undefined).

Owner Decision: [ ] Approve  [ ] Revise  [ ] Defer
Owner Notes:


---

## PART 4 — Recommended Amendments (bucketed by timing)

### Before-merge (constitution-level principles; small text additions)
- **Approval integrity (D-11 / items 1–4):** add a short AISL-005 subsection
  stating that an approval binds to a specific payload, is single-use, expires,
  and that any payload change voids it. (Principle now; mechanics in impl-spec.)
- **Dual-approval distinctness (D-14 / item 6):** amend `AISL-005:78` to require the
  second approver be a **distinct identity in a distinct session** from the initiator.
- **Audit immutability (D-15 / item 7):** add an invariant — the governance/decision
  audit log is **append-only, tamper-evident, and non-bypassable**.
- **Unclassified-data fail-closed (item 9):** extend INV-11 (or AISL-004) so **new/
  unclassified data defaults to the highest protection** (treated as Secrets/Governance
  until classified).
- **✅ legend caveat (item 10):** amend the `AISL-002:13` legend so ✅ reads
  "may-initiate — full authority **subject to the Policy Layer**", not unconditional.
- **Invariant precedence (Part 2):** add the explicit precedence chain for conflicts.
- **DRAFT→APPROVED transition (D-18):** define that Owner approval + merge flips
  `Status:` to APPROVED and sets `Approved-by:`.

### v1.1 (non-blocking clarifications)
- Data-classification-as-a-Governance-action (D-16 note / item 8) — add the AISL-004
  parallel to AISL-003 §5.
- ED delete/export (D-07) — state the explicit ED-scoped rule vs the example list.

### Implementation-spec (not constitution text)
- Anti-transaction-splitting cumulative-window algorithm (item 5 / D-13 caution).
- Numeric thresholds (D-12) — Policy configuration values.
- Concrete replay/expiry/nonce mechanics for approvals (items 2–3).

---

## PART 5 — Owner Decision Summary

| Decision | Verdict (actual text) | Owner: Approve / Revise / Defer |
|---|---|---|
| D-01 Two-plane model | COVERED | [ ] |
| D-02 ED Business/Governance | COVERED | [ ] |
| D-03 Plane-scoped GO | COVERED | [ ] |
| D-04 High-Risk not third plane | COVERED | [ ] |
| D-05 Policy Layer | COVERED | [ ] |
| D-06 INV-1 Plane authoritative | COVERED | [ ] |
| D-07 ED delete/Finance/HR/export | PARTIAL | [ ] |
| D-08 Three-layer runtime | COVERED | [ ] |
| D-09 Roadmap | COVERED | [ ] |
| D-10 Absolute redlines system-level | COVERED | [ ] |
| D-11 Approval integrity | NOT COVERED | [ ] |
| D-12 Threshold numbers | NOT COVERED (by design) | [ ] |
| D-13 Anti-splitting (planes) | COVERED | [ ] |
| D-14 Dual-approval distinct approver | PARTIAL | [ ] |
| D-15 Audit immutability + non-bypass | NOT COVERED | [ ] |
| D-16 Tool classification governance | COVERED (tools) | [ ] |
| D-17 Governance of modifying AISL | COVERED | [ ] |
| D-18 DRAFT→APPROVED on merge | PARTIAL | [ ] |

**Overall (D-01…D-18):** 13 COVERED · 2 PARTIAL (D-14, D-18) · 3 NOT COVERED
(D-11, D-12, D-15) — plus D-07 PARTIAL. **Integrity items (Part 1):** 1 CONFIRMED ·
3 PARTIAL · 7 NOT FOUND.

**Owner overall decision:**
Owner Decision: [ ] Approve as-is  [ ] Approve with before-merge amendments  [ ] Revise  [ ] Defer
Owner Notes:



## Changelog

- **v1.0 — initial draft — 2026-07-12.** Evidence-based v2 Owner Review Pack:
  every D-01–D-18 verdict and every Part-4 integrity item cited against the actual
  AISL text on `docs/aisl-v1.0 @ 7fbc14c`; three-bucket separation
  (confirmed/missing/recommended); actual INV-1..13 review with precedence gap;
  Owner sign-off fields per decision.
