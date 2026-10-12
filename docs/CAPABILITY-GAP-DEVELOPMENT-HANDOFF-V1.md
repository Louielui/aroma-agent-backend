# Capability gap development handoff v1

This slice extends the existing gap workflow with one host-registered external
read profile: `seven_shifts`. It does not give a model arbitrary file access,
commands, credentials or privileges.

## Connected code paths

- A 7shifts clock-in/clock-out unmapped-read gap may propose a fixed development
  scope: `src/context/adapters/sevenShiftsRead.js`. `contextResult.js` is an
  immutable dependency. Failed authorisation or failed reads are not automatically
  classified as missing code.
- After gap-proposal approval, the existing committed-source task planner receives
  a bounded reader goal. The original request, provider/model and effort remain
  pinned for continuation. Payroll approval is outside the coding goal.
- The registered task uses existing protected acceptance tests, subscription
  workers, offline Sandbox execution, review, separate adoption approval and
  loaded-commit verification. Registering a scope does not execute a worker.
- Old v1 proposals remain hash-valid. An approved task awaiting scope registration
  can explicitly request a fresh v2 proposal. Its old approval is not transferred.
  Lost responses can recover the saved replacement without another paid call.
- The existing explicit read-only continuation still requires a completed
  matching work/adoption receipt and a verified new boot commit. Neither a test
  fixture nor a new repository HEAD supplies this proof for a real task.

## Bounded reader

The reader uses only GET on a fixed company time-punch endpoint. It enforces
company identity, a maximum 31-day UTC clock-in window, optional numeric employee
and location filters, at most three pages of 100 rows, safe error codes and
mid-read access rechecks. Tokens and wage/notes fields do not enter evidence or
development packages. Chinese and English source routing shares the same reader.

Clock-out can be null. An employee ID is not a verified employee name. A date
without a timezone is interpreted as a UTC day; dates without a specified range
use a disclosed recent seven-day window. Local-calendar-day queries and employee
name resolution need explicit follow-up work. Pagination or context truncation
cannot establish a complete staff list. Matching counts apply only to the query;
the wider source total is unknown.

Official endpoint reference:
[7shifts time punches](https://developers.7shifts.com/reference/gettimepunches).

## Live connection boundary

At implementation time the local Imagine connection has no dedicated
`SEVEN_SHIFTS_ACCESS_TOKEN`, `SEVEN_SHIFTS_COMPANY_ID` or
`CONTEXT_SEVEN_SHIFTS=on`. The existing master `READ_ACCESS=on` also applies.
No credentials are copied from Aroma System and no source switch is enabled by
this code delivery. Missing connection information is not repaired by a model.

The Owner must supply an authorised local connection before live clock-out
acceptance. Enter secrets only in the local protected configuration, never in
chat, test fixtures, screenshots, repository files or developer task packages.
`scripts/connections/configureSevenShiftsRead.ps1 -ExpectedCommit <loaded commit>`
provides local masked input, backs up the existing environment outside Git with
the same ACL, changes only the two connection values and per-source read switch,
then restarts and verifies the expected build. It neither creates external scopes
nor verifies source liveness; the subsequent real read is a separate check.

The reader and handoff are verified with injected transport and local workflow
tests. **Live 7shifts data, real paid worker remediation/adoption, employee names
and punch approval are not claimed by those tests.** Architecture remains partial
until a real source and original-goal continuation are separately verified.

No background retries, vendor fallback, runtime-model changes or business writes
are added.
