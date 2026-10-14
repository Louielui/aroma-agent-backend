# Shared read collection and grounded follow-ups v1

This tranche factors bounded cursor traversal into `src/context/readCollection.js`
and numeric selection into `src/context/numericSelection.js`. They are reusable
host-owned building blocks, not new model tools or permissions. The first actual
consumer is the existing configured-company GET-only 7shifts wage reader.

The caller fixes transport, row identity, projection, verification and budgets.
Untrusted rows supply no endpoint, method, credential, budget or executable action.
Traversal verifies authority before and after each page, rejects duplicate IDs
and repeated/malformed cursors, and proves exhaustion only from a null cursor.
Page and row limits are explicitly partial. Existing 7shifts limits remain three
pages per status, 300 users total, fixed API version, GET and redirect refusal.
Contacts are excluded from the host-projected report. Source roster exhaustion,
fully verified wage rows, selected membership and rendered coverage are separate.

Browser task follow-ups pass only the operation/status from saved server evidence,
alongside bounded prior discussion. A prior answer cannot authorize or specify a
read. The nearest completed read topic supports status selection and one explicit
numeric comparison: greater than, at least, below, at most or equal to. The host
parses exact cents from the current Owner question. A fresh read runs after
per-turn consent; the model cannot invent a threshold or override parsed status.
Unknown, compound, excessive-precision and unsupported numeric queries are not
silently treated as an unfiltered read. Unrelated or page-only discussion cannot
establish a wage antecedent; client-supplied central-chat history cannot do so.

Filtering matches any verified hourly role rate and retains full role rates for
the selected user. Weekly salary is not converted into hourly pay. Missing or
incompatible rates with no known match remain unresolved and visibly included;
their count is distinct from verified matches. No verified match is not proof of
no matching user when source or membership coverage is incomplete. Amounts use
the existing account units; currency remains unknown. Existing grouped answers,
collapsed inactive users and role details remain. Structured/raw report limits
and source/consent revocation continue to apply.

Synthetic regressions exercise two pages and exhaustion, budgets, duplicate IDs,
cursor loops, revoked authority, another numeric dataset, missing versus zero,
exact thresholds, server-saved scope and a changing wage between two task turns.
Real headless Edge verifies the existing tab-topic and grouped task-panel paths.
This is not authenticated external acceptance or general website parity.

The Chrome assets, native helper/profile, permissions, central brain, launcher,
rollback points, production database and unrelated services are unchanged.
Native operator follow-up planning still has its earlier documented limits.
General UI pagination and arbitrary websites are not newly admitted. Other
adapters can adopt the shared collectors only through their own scoped review.
