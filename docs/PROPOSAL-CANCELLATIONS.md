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

---

## 2026-08-05 — one proposal cancelled as residue of a stale browser tab

**Owner instruction, verbatim:** 「it is residue from the stale-tab session where the reject
never reached the server, not a decision I made. Same treatment as the three from before.」

| id | created | cancelled |
|---|---|---|
| `prop_fed3ca71` | 2026-08-05T17:11:45Z | 2026-08-05, same day |

**Why it existed — a different cause from the four above.** The reject button had already
been fixed to call the server (`9da8f4c`), and the running process was serving the fixed
code. But `demoHtml.js` inlines `app.js` **at require() time**, and the Owner's browser tab
had been loaded before that restart. Sealing a Work Order still worked, because that path was
unchanged; the reject handler in his tab was the old one that called nothing.

So: he rejected the card, the screen said so, and nothing reached the server. The proposal
stayed pending and no `approval.rejected` event was written. Confirmed at the time from the
store and the log — only `approval.sealed` was present.

**Cancelled through the governed route**, `POST /api/v1/proposals/:id/cancel`, service-token
guarded, `cancelledBy` server-supplied. Returned 200 `status=cancelled cancelledBy=louie`.
Afterwards: **0 pending**, 5 cancelled, 4 confirmed.

### The operational trap this exposed, which is not fixed

**A client change requires a hard reload, and nothing tells the Owner that.** The demo page
sends `Cache-Control: no-cache`, and the assets are inlined at require() time, so a restart
updates what the SERVER would send — but a tab already open keeps running the old script
indefinitely. Every path that did not change keeps working, which is what makes it
convincing: the card sealed, the button appeared, only the fixed behaviour was missing.

Not fixed, deliberately, and not proposed as part of this cleanup. A version stamp the page
compares against the server would close it. Raised with the Owner; no decision yet.

---

## 2026-08-05 — one proposal cancelled as residue of the deterministic-entrance test

**Owner instruction, verbatim:** 「Clear prop_80897e17 through the governed route with a note
— it is residue from the deterministic entrance test, not a decision.」

| id | created | cancelled |
|---|---|---|
| `prop_80897e17` | 2026-08-05T18:41:13Z | 2026-08-05T20:55:07Z |

**Why it existed.** It is the proposal raised by the FIRST successful firing of the
deterministic entrance (`source: deterministic_entry`, decision `dec_6cca1056`, task
`task_c5ac815d`). The purpose of that turn was to prove the entrance fired at all and to read
back which path had produced it — not to make a change. The proposal was correct output from
a working path; it was never a decision to modify a file.

Distinct from the five before it: those existed because a reject **failed to reach the
server**. This one exists because a **test succeeded** and nothing followed it.

**Cancelled through the governed route**, `POST /api/v1/proposals/:id/cancel`, service-token
guarded, `cancelledBy` server-supplied. Returned 200 `status=cancelled cancelledBy=louie`.
Afterwards: **0 pending**, 7 cancelled, 4 confirmed.

**Worth noting for the entrance itself.** A deterministic entrance that works leaves a
pending proposal behind every time it is exercised. That is correct behaviour — a proposal
awaiting a decision is exactly what it should produce — but it means **proving the path
costs a cleanup each time**, and the cleanup is manual. Not a defect; recorded so the next
person exercising it is not surprised by residue.
