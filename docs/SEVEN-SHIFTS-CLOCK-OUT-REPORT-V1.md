# 7shifts clock-out report and real remediation acceptance

Owner scope: employee names, Winnipeg local dates, all bounded clock-out results,
and a genuine gap → approved development → adoption → original-read continuation.
Business punch writes and payroll actions remain excluded.

The host report handler resolves explicit dates, today and yesterday in
America/Winnipeg. Calendar midnights are resolved independently at both ends,
including 23/25-hour DST days. The original local date is sealed into the gap
receipt so a later continuation does not reinterpret yesterday.

The fixed adapter contract is `methods.listClockOuts({timeMin,timeMax})` with
inclusive UTC clock-out bounds. It uses only company-bound GET time_punches and
GET users/{numeric user ID}, reusing the approved dedicated connection. Names
must be projected without contact, wage or other unrelated user fields. A missing
name must not discard a verified punch. No arbitrary URL or command is accepted.

The report bypasses the four-row model-context preview and renders every retrieved
row within the adapter's finite page budget. Only a terminal null cursor establishes
scope completeness; incomplete pagination and unresolved names remain visible.
This is a clock-out-date report, not a claim that every employee worked or clocked
out. Overnight shifts are selected by the time of clock-out, not clock-in.

The acceptance reviewer now recognises the exact existing 7shifts source package.
The scope remains one editable reader plus the immutable contextResult dependency.
Old v1/v2 proposal seals and work receipts remain readable; the new v3 report
proposal separately describes the fixed name-read endpoint and adapter contract.
The host query/report wiring is not evidence of worker-developed code or a loaded
adoption. Those claims require actual planner, test, worker, review and adoption
receipts. No fixture or directly implemented code may stand in for them.

An Owner-requested replan after a failed login remains attached to the original
gap. Continuation follows only saved replacement links retaining the conversation,
scope, model, effort and sealed requests. Cycles or a changed goal are rejected;
the replacement still requires its own exact coding approval and loaded proof.

Rejected planning responses remain non-executable. The model schema now exposes
the existing eight-item and text limits, and the planner records only the failing
contract field, never the rejected model content. Citation spans and quotes still
require independent source validation. This fixes the diagnostic gap; it does not
establish why an older discarded response was rejected or prove reader acceptance.

The actual bounded coding worker produced the reader patch, six protected tests
passed in Windows offline Sandbox, and independent Claude review passed. Adoption
re-ran the same six tests and loaded commit efeac99a11c8cef7ef90582620512e547f701d1c.
Original-request live acceptance is still pending.

The live handoff exposed a separate host defect: adoption records belong to the
Owner bridge, while continuation read a backend-local adoption directory. Loaded
verification now reads the bridge's authoritative adoption list and its fixed
committed-source endpoint. A later host-only commit may resume only when fresh
current-boot evidence proves every approved reader and protected dependency hash
is unchanged. A rollback, source drift, incomplete tests, stale packet, unavailable
bridge or revoked access cannot enable continuation; no receipt is manufactured.

References:
- [List Time Punches](https://developers.7shifts.com/reference/gettimepunches)
- [Retrieve User](https://developers.7shifts.com/reference/getuser)
- [Pagination](https://developers.7shifts.com/reference/pagination)
