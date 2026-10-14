# Browser read tasks v1

The side panel and central chat share `src/intake/readTask.js`. The captured central brain selects a closed read operation from the Owner's goal. There is currently one company task: `seven_shifts.employee_wages`. General answers and page interpretation remain available. This is a bounded read-task entrance, not a general live-browser operator.

The default **Task** mode sends no page snapshot and does not query tabs or inject a script. Current-page and selected-text modes retain the toolbar activeTab grant, fresh-document validation and source binding. A task-only native request contains exactly the Owner question/request UUID on prepare, and job UUID/consent on read. No route, company, shell command or browser action can be supplied. The native host remains fixed to one extension origin and one authenticated loopback route; the Chrome permission manifest is unchanged.

Preparation discloses the captured model, available company ID, employee names/status/current wages/assigned roles, prior conversation and egress scope. It makes no model or company calls. The first read consumes consent before dispatch. Status, restore, repeated dispatch and restart do not repeat inference. Legacy prepared records never gain company-read authority. Cancellation and access revocation are checked around reads and before saving a result.

## Registered wage read

Uses existing `READ_ACCESS`, `CONTEXT_SEVEN_SHIFTS`, provider-sharing policy, configured company ID and access token. It never activates a flag, changes credentials or gains an API permission. Missing connection/permission stays unavailable.

GET-only paths on `https://api.7shifts.com/v2/company/{configured_company}`:

- `/labor_settings`: only wage-based-role enablement.
- `/users`: explicit active/inactive scope; 100 users per page, at most three pages per status and 300 users total. All scope includes management and inactive accounts and is labelled accordingly.
- `/users/{verified_user_id}/wages`: current wage records; no use of profile `hourly_wage` defaults.
- `/users/{verified_user_id}/role_assignments`: current roles when role-based wages are enabled.

Each response is bounded to 500 KB, with a five-second request timeout and 75-second overall budget inside the existing 110-second browser job deadline. Four bounded workers retrieve wages. The final roster page requests only the remaining capacity. An internal reader deadline retains already verified rows and marks unfinished wages unavailable, with incomplete coverage and an explicit timeout reason. Owner cancellation or revoked source access discards partial results. Redirects, changed company/token, malformed or repeated cursors, invalid IDs and cross-company rows fail closed. Profile contact, address, birthday and token fields never enter retained results. No payroll approval, pay change, time-punch change or Aroma System database path exists.

The October 13 live acceptance exposed the prior 25-second budget: 28 active and 161 inactive users required per-user wage and role requests. A read-only reproduction reached 155 successful wage responses and 152 role responses before that deadline, then discarded the result. The API returned HTTP 200; this was a transport budget defect, not evidence of missing API permission. Safe failure codes now remain in the saved task evidence and visible answer; raw upstream errors and credentials do not.

The same account's role-assignment response omits `company_id`, despite that field appearing in the reference example. Binding comes from the fixed configured-company endpoint and the already verified company user ID. An absent role-level company field is accepted; any supplied company field must match exactly. Foreign company rows, invalid role IDs and duplicate roles remain rejected.

A missing or contradictory rate for one assigned role no longer erases other verified roles for that employee. The missing role retains a null rate and is visibly unavailable; it is never rendered as zero. The result remains incomplete until every scoped role is verified.

Deterministic wage details use at most 120 KB of JSON-encoded text, inside the unchanged 195 KB native result budget. Generated answers keep their existing 30,000-character limit. Rendering reserves space for metadata/footer and stops only between whole employee rows. Any omitted rows are explicitly counted, the output is marked incomplete, and the evidence distinguishes measured source coverage from rendered coverage. A real 189-user read produced 51,006 characters, which exceeded the old generated-answer limit despite fitting the native frame.

Latest effective current wages are resolved according to the official guide. Weekly salary stays weekly; no invented hourly conversion. Role-based rates include only verified assigned roles. Missing, denied, future-only or contradictory rates stay unknown, never zero. Currency is not inferred. A partial roster or missing name/rate is visibly incomplete. The report is rendered from measured rows, not generated amounts. The model plans the read; its selected/actual identity remains distinguished in the UI.

## Evidence and acceptance

Failure tests cover scope/permission changes, refusal of arbitrary operations, page instructions not granting wage authority, audit failure, pagination, zero vs missing, role/salary interpretation, source substitution, cancel/recovery and unchanged native bounds. Real headless Edge exercises the side-panel assets with a synthetic company/transport and a real backend service; this does not prove real account API access.

Live acceptance remains: install the exact reviewed extension/native package; from a schedule page enter "List all employee hourly wages" in Task mode; consent once for that turn; verify all scoped roster rows, role rates, missing/denied rows, source/time and unchanged business data. Follow up for active employees only. Verify no Chrome page grant is needed for Task mode, page modes still require it, and opening/restoring never repeats reads. Keep the previous immutable package and rollback point.

The worktree-hosted deployment controller must set `NODE_PATH` to the existing runtime's `node_modules`. Isolated tests supply their own dependency root. Without this controller setting, runtime probes can fail to resolve `dotenv` even while the actual backend and bridge are healthy. A failed deployment retains its forward rollback and measured read-back; a renewed promotion must bind fresh exact-commit evidence.

Primary API specifications: [List Users](https://developers.7shifts.com/reference/listuserslist), [List User Wages](https://developers.7shifts.com/reference/getuserwages), [Read Employee Wage Data](https://developers.7shifts.com/docs/read-employee-wage-data), [Labor Settings](https://developers.7shifts.com/reference/retrievecompanylaborsettings), [Role Assignments](https://developers.7shifts.com/reference/getroleassignments).

## Wage answer presentation

Shared cursor/coverage and grounded numeric follow-ups are documented in
[READ-COLLECTION-FOLLOWUPS-V1.md](READ-COLLECTION-FOLLOWUPS-V1.md). The existing
Task mode is the adoption path; Chrome assets and per-turn consent are unchanged.

The Owner requested grouping employees by hourly rate. The default answer groups active users sharing the same verified rate, merging repeated equal role rates without changing any amount. Different role rates remain separate combinations; weekly salary stays weekly. Zero source rates are explicitly marked for confirmation, and missing role rates remain unknown. Employee IDs retain separate users even when names match. There is no name-based exclusion or assumption that a zero account is not an employee.

For an all-users read, inactive users are retained in an initially collapsed list, with their count visible. The full bounded role detail and company/source/model metadata are also initially collapsed. The plain central-chat answer contains the same grouped primary summary and states that the inactive rows are outside that summary. An explicitly inactive-only read shows inactive users as the primary group. Read scope, credentials, API operations, paid model planning and per-turn consent are unchanged.

The structured summary and detail text share the existing 120 KB JSON result budget. Rendering accounts for any omitted summary or detail rows; the source and output completeness witnesses remain distinct. Saved results retain the presentation, while follow-up history carries only the bounded summary, not another copy of all details. Opening a disclosure or restoring the answer performs no new model or company read. Older saved answers without presentation retain their original text; no stored business/read history is rewritten.

Real headless Edge exercises grouping, equal-rate merge, zero and missing values, collapsed inactive/role/model sections, text-only rendering of hostile names, restore without extra reads, and narrow layouts. Fixtures are synthetic and are not new live API acceptance.
