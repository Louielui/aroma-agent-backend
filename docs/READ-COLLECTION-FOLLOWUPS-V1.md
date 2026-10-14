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
incompatible rates with no known match remain unresolved and are retained in a
labelled, initially collapsed list. Only verified matching active users reach
the primary table; an inactive-only scope uses verified inactive users instead.
For all-users scope, inactive matches and unresolved users retain explicit row
labels in the secondary list. Their count is distinct from verified matches.
No verified match is not proof of
no matching user when source or membership coverage is incomplete. Amounts use
the existing account units; currency remains unknown. Existing grouped answers,
collapsed inactive users and role details remain. Structured/raw report limits
and source/consent revocation continue to apply.

Synthetic regressions exercise two pages and exhaustion, budgets, duplicate IDs,
cursor loops, revoked authority, another numeric dataset, missing versus zero,
exact thresholds, server-saved scope and a changing wage between two task turns.
Real headless Edge verifies the existing tab-topic and grouped task-panel paths.
This is not authenticated external acceptance or general website parity.

Live Chrome acceptance on 2026-10-14 read all 28 active company users. Thirteen
full wage rows were verified and fifteen were incomplete. The next saved-topic
question, `Who is above 20?`, refreshed the source, parsed `gt 2000`, measured one
known match and fourteen unresolved memberships, and retained all selected output.
The original rendering mixed those fifteen rows in one primary table. This
tranche separates the known match from the unresolved list using the existing
presentation contract; it does not change source evidence or Chrome assets.
These observed counts are one account snapshot, not a general completeness claim.

## Successful-source gaps versus failed reads

A subsequent read on 2026-10-14 measured 58 successful GET responses and the
same 28-user roster, with 13 full wage rows and 15 incomplete rows. Thirteen
users had assigned roles without corresponding current wage objects; two had
no assigned roles. This was not a transport timeout, API denial or pagination
failure. A bounded manual web comparison observed zero values for absent API
role records on multiple profiles, but the web host later rate-limited access.
That comparison is partial and is not a new runtime source or a basis for
turning absent API values into zero. No real employee values are test fixtures.

The existing reader now projects fixed gap reasons from validated source
facts: absent role records, no assigned roles, no effective wages or conflicting
current wages. Successful values, explicit API zeros, null values, current-wage
selection and numeric membership retain their prior semantics. The coverage
report counts reasons across the original source roster, including records
excluded by a numeric query. The existing summary and collapsed details explain
these reasons in the Owner language, separately from permission denial, rate
limit, malformed data and timeout. Older saved reports without reasons remain
honest unknowns and are not rewritten or replayed. Reaching this boundary does
not admit automated employee-profile traversal or new browser permissions.

The interpretation of wage types, effective dates, role-based settings and
assigned roles follows [7shifts' wage-read guide](https://developers.7shifts.com/docs/read-employee-wage-data).
The guide does not establish that an absent role wage is an API zero. Automated
read recovery is therefore not authorized to fill missing wage records.

The Chrome assets, native helper/profile, permissions, central brain, launcher,
rollback points, production database and unrelated services are unchanged.
Native operator follow-up planning still has its earlier documented limits.
General UI pagination and arbitrary websites are not newly admitted. Other
adapters can adopt the shared collectors only through their own scoped review.
