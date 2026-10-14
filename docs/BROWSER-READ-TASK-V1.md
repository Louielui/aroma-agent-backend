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

Each response is bounded to 500 KB, with a five-second request timeout and 25-second overall budget. Four bounded workers retrieve wages. Redirects, changed company/token, malformed or repeated cursors, invalid IDs and cross-company rows fail closed. Profile contact, address, birthday and token fields never enter retained results. No payroll approval, pay change, time-punch change or Aroma System database path exists.

Latest effective current wages are resolved according to the official guide. Weekly salary stays weekly; no invented hourly conversion. Role-based rates include only verified assigned roles. Missing, denied, future-only or contradictory rates stay unknown, never zero. Currency is not inferred. A partial roster or missing name/rate is visibly incomplete. The report is rendered from measured rows, not generated amounts. The model plans the read; its selected/actual identity remains distinguished in the UI.

## Evidence and acceptance

Failure tests cover scope/permission changes, refusal of arbitrary operations, page instructions not granting wage authority, audit failure, pagination, zero vs missing, role/salary interpretation, source substitution, cancel/recovery and unchanged native bounds. Real headless Edge exercises the side-panel assets with a synthetic company/transport and a real backend service; this does not prove real account API access.

Live acceptance remains: install the exact reviewed extension/native package; from a schedule page enter "List all employee hourly wages" in Task mode; consent once for that turn; verify all scoped roster rows, role rates, missing/denied rows, source/time and unchanged business data. Follow up for active employees only. Verify no Chrome page grant is needed for Task mode, page modes still require it, and opening/restoring never repeats reads. Keep the previous immutable package and rollback point.

The worktree-hosted deployment controller must set `NODE_PATH` to the existing runtime's `node_modules`. Isolated tests supply their own dependency root. Without this controller setting, runtime probes can fail to resolve `dotenv` even while the actual backend and bridge are healthy. A failed deployment retains its forward rollback and measured read-back; a renewed promotion must bind fresh exact-commit evidence.

Primary API specifications: [List Users](https://developers.7shifts.com/reference/listuserslist), [List User Wages](https://developers.7shifts.com/reference/getuserwages), [Read Employee Wage Data](https://developers.7shifts.com/docs/read-employee-wage-data), [Labor Settings](https://developers.7shifts.com/reference/retrievecompanylaborsettings), [Role Assignments](https://developers.7shifts.com/reference/getroleassignments).
