# HR attendance investigation v1

Owner authorized the missing-clock-out investigation slice on 2026-10-10.
The existing department workspace offers a second explicit-date prepare button;
preparation preserves existing drafts and never sends or reads automatically.
Natural Chinese and English requests use the same fixed read/report path.

The scope is punches whose **clock-in** falls in one America/Winnipeg calendar
day. Relative today/yesterday dates resolve once, at read time; stored replies
retain the absolute day and retrieval timestamp. Civil midnights include DST.
Employees without a clock-in in that scope cannot be investigated from this data.

`listAttendance({timeMin,timeMax})` shares the bounded named-punch transport with
the existing clock-out report: fixed company, fixed GET time_punches and
users/{numeric ID}, 3 pages of 100, 50 optional name reads, 8-second read budget,
permission rechecks and abort races. No profiles, wages, arbitrary URL, token,
write operation, scheduled job or additional external permission is exposed.
Only a terminal null pagination cursor proves scope completeness.

Evidence rules:

- A null clock-out confirms only an unclosed record in the read snapshot.
- Historical unclosed records are missing-clock-out CANDIDATEs, not confirmed
  employee omissions. Current-day unclosed records remain UNKNOWN.
- Whether someone is currently working is UNKNOWN without scheduled end times
  and/or employee confirmation. No hours threshold is invented.
- A closed overnight shift is a confirmed clock-out, not a missing punch.
- Auto clock-out confirms the recorded timestamp, not a manual employee punch.
- Missing names, incomplete pagination and unavailable sources remain visible.
- No records is not proof that nobody worked or that all staff punched correctly.

The real authenticated intake uses existing same-origin, topic membership and
request-conflict guards. It saves a source-bound Markdown report and performs
zero model calls. Request replay returns its original snapshot after access
rechecks; a new request ID refreshes the source. Recommendations require human
verification and never send messages or modify punches/payroll.

Acceptance includes transport fixtures (GET/projection/revocation/pagination),
classification, DST, malformed/future dates, real HTTP request idempotence and
bilingual desktop/mobile assembled-page preparation/rendering/history isolation.
Architecture remains partial: schedules, verified actual working state, missed
clock-in discovery, lateness and overtime are not connected.

Primary source contract: https://developers.7shifts.com/reference/gettimepunches
and https://developers.7shifts.com/reference/getuser.
