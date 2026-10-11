# Evidence-linked department follow-ups v1

HR is the first adapter for the existing topic-workspace tracking list. New attendance
and schedule-comparison turns retain a bounded structured candidate snapshot alongside
the exact saved reply. Older text-only reports are not reverse-parsed into evidence:
the Owner must explicitly issue a fresh query.

## Owner flow

Open **Prepare follow-up items** on a report, or ask to prepare a follow-up list from
the latest report in that conversation. Preparation is read-only and model-free.
Select candidates in the bounded dialog, review their snapshot, then confirm saving.
No checkbox is selected by default. The existing tracking panel retains editable
next steps and revision-checked todo / doing / done states. Source details stay
collapsed until requested. A fresh-query button prepares a dated draft without
overwriting another draft or automatically dispatching it.

## Evidence and persistence

- Candidate evidence includes company, employee, scheduled shift and punch IDs,
  original timestamps, association grade, findings, query day, Winnipeg timezone,
  retrieval time and complete/partial scope. Absence and current working status
  remain UNKNOWN; the UI never labels these records confirmed violations.
- The server resolves selected keys from the saved conversation report. Browser
  titles, grades, evidence or commands are not accepted as canonical data.
- Stable identities bind provider, report kind, company, date, employee and scheduled
  shift (or unmatched / attendance punch). Repeated reports of that same identity
  reuse the saved note without changing its next step, state or source snapshot.
  Different employees assigned to the same shift are separate identities.
- Updating a task does not refresh evidence. A new report is a separate snapshot;
  old evidence remains dated, and tasks are never automatically resolved or reopened.
- A failed latest report attempt cannot select an older successful report as if
  the fresh read succeeded. Explicit older report buttons still expose dated evidence.
- Batch saving is atomic, bounded to 100 selected items and the existing 100-note
  workspace capacity. Missing and unreadable sources produce distinct errors.
- Existing email and manual notes remain compatible. New evidence sources cannot
  enter via the manual note endpoint or another department.

## Scope and verification

Shared snapshot, selection and persistence mechanics can support another registered
department adapter later. Only HR is connected now. No new connectors, dependencies,
background jobs, employee messages, punch modifications, payroll operations or
management permissions are added.

Tests use isolated temporary data, real HTTP route handlers and Chromium desktop /
mobile pages in Chinese and English. They verify no pre-confirmation write, exact
source restoration, unknowns and partial scope, stale-read handling, identity reuse,
optimistic state updates, atomic capacity refusal, forged sources, cross-origin /
cross-topic refusal, safe employee-name rendering and explicit draft-only refresh.
