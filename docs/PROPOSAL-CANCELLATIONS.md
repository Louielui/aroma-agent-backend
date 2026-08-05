# Proposal cancellations — the record of WHY

The proposal store records `status`, `cancelledBy` and the timestamps. **It has no field for
a reason.** So a proposal cancelled for housekeeping and one cancelled because the Owner
changed his mind look identical in the record, forever.

That is the same shape as the defect this file's first entry is about — the record and the
reality disagreeing — so until the store carries a reason, cancellations that were not the
Owner's own decision are written here, by id, on the day they happen.

**Rule:** if you cancel a proposal that the Owner did not personally decide to cancel, add a
row. If the store ever gains a reason field, move these into it and delete this file.

---

## 2026-08-05 — three proposals cancelled as residue of the reject-button defect

**Owner instruction, verbatim:** 「Cancel all three pending proposals with a note recording
why: they are residue from the reject-button defect fixed in 9da8f4c, not decisions I ever
made.」

| id | created | age when cancelled |
|---|---|---|
| `prop_ff16fe5e` | 2026-07-24T02:40:02Z | 12 days |
| `prop_98fdac70` | 2026-08-03T02:30:28Z | 2 days |
| `prop_105231fd` | 2026-08-03T02:45:29Z | 2 days |

**Why they existed.** The 拒絕 button on the Owner decision card disabled three controls and
printed 「你拒絕了這張工作單。甚麼都沒有執行。」 — and called nothing. No request, no
`cancelProposal`, no audit line. The sealed Work Order and its nonce expired on their own
after `APPROVAL_TTL_MS`; the PROPOSAL stayed pending forever. Every rejection the Owner made
left one behind.

**These are not decisions the Owner made.** He rejected each of them. The system simply never
recorded that he had.

**How they were cancelled.** Through the governed route,
`POST /api/v1/proposals/:id/cancel`, service-token guarded, `cancelledBy` server-supplied —
never by touching the store. All three returned 200 `status=cancelled cancelledBy=louie`.
Verified afterwards: **0 pending**, 3 cancelled, 4 confirmed.

**The defect itself** was fixed in `9da8f4c`: `POST /api/v1/owner/reject` now consumes the
nonce, loads the sealed record, cancels the proposal that record names, and writes an audit
line — and the button waits for the server before claiming anything.

**What is still missing, recorded rather than left implicit.** `approvalAudit` in `app.js` is
an in-memory array capped at 500 entries plus a `console.log` line to the launcher's log. It
is not durable storage, and the artifact store's kinds (`tasks`, `results`, `agent-audit`,
`computer-audit`) have no place for a proposal-lifecycle record. So the audit trail for an
approval decision survives only as long as the log file does. That is a real gap and it is
larger than this cleanup.
