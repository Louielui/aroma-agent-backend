# Morning Briefing v0.1 — TECHNICALLY VALIDATED / PRODUCT NO-GO

**Owner decision, 2026-08-02.** The branch is preserved, not merged and not deployed.
Nothing here is deleted: the code, the tests and the canary evidence stand as a working
component library for whatever comes next.

## Status

| | |
|---|---|
| Branch | `feat/morning-briefing-v0.1-clean` @ `425e81a` (pushed) |
| Merge | **NO** |
| Deploy | **NO** |
| Technical verdict | **VALIDATED** — every condition of the Owner-UI canary passed |
| Product verdict | **NO-GO** — see below |

## Why NO-GO, in one sentence

**What was built is a Source Activity Log, not an Executive Briefing — and better
presentation cannot fix that, because the data on hand does not support decision value.**

The canary is the evidence. A real generation against real Gmail, Drive, Calendar and
GitHub produced: `today: 0`, `recentActivity: 5`, `risks: 1`, `topPriorities: 2`,
`decisionsNeeded: 1`. The five "recent activity" items were correctly cited, correctly
dated and correctly scoped — and they were a list of things that had recently existed in
four inboxes. The one genuinely decision-shaped item came from the internal proposal store,
not from any external source.

That is not a rendering problem. Ten of the coverage rows report on sources; the restaurant
itself is not among them, because Aroma System has no read connection. A briefing whose
subject is the Owner's business cannot be assembled from four systems that do not contain
the business.

**This is a scope conclusion, not a failure.** The build did what it was asked, honestly
enough to make its own limits visible — which is how the limit was found.

## Canary evidence (2026-08-02, real credentials)

- 4 audit records: 3 non-interactive probes + 1 Owner press. The Owner's press produced
  **exactly one** brief, with `decisionsNeeded: 1` — the pending proposal appeared.
- Privacy: **closed-set proof** over all four records — every string in the audit file
  belongs to a fixed vocabulary (ids, ISO timestamps, source names, state enums, section
  names, a sha256). Zero source-derived text on disk.
- Conversation Archive: 10 records / 3910 bytes before and after. Unchanged.
- Coverage errors: fixed codes only, no raw adapter message reached the response.
- Links: 9 provenance links, all https or null.
- Connector: 9 calls, all read-shaped.
- Production 8090: pid 51872 throughout, never restarted.
- Staging 8091: stopped, port free, process gone, worktree removed.

## Components worth reusing

These are the parts that earned their keep, and the reason this branch is kept rather than
deleted:

| Component | Where | Why it survives the product decision |
|---|---|---|
| **Connector read path** | `src/context/*` (+ the additive `items` return) | Four real read-only sources, three-state honesty, per-source fail-soft. Proven live. |
| **Provenance model** | `morningBriefing.js` · `statementScope.js` | fact / inference / recommendation with citations, and scope decided by SOURCE rather than by text. The single most transferable idea here. |
| **Delivery validation** | `briefDelivery.js` | One gate that REMOVES rather than flags, with a citation cascade to a fixpoint and fail-closed on validator error. |
| **Audit store** | `briefStore.js` + `provision-brief-audit.ps1` | Metadata-only allowlist, closed-set-provable, own ACL with AromaOperator excluded, provisioning verified at runtime rather than created by it. |
| **Owner UI gating** | `briefingRouter.js` + `app.js` mount | Existing owner session, no second password, no HUB_TOKEN, browser cannot steer a read. |
| **Proposal reader** | `resolveProposalFilePath` + `defaultListProposals` | One path rule shared with the Proposal Store, with the three read outcomes kept distinct. |

## Components to discard

- **The six-section briefing shape itself** (`today / recentActivity / risks /
  topPriorities / decisionsNeeded`). It was designed around an executive summary that the
  available data cannot fill.
- **`buildTopPriorities`** — ranking derived from what happened to be readable is
  ranking-shaped, not ranking.
- **The unsourced-question coverage rows** (`deadlines`, `awaiting-reply`) — honest, but
  they exist to announce that the product's core questions have no source. That is a
  statement about the product, not a feature of it.

## Preconditions any successor must solve first

1. **A read connection to the thing being briefed.** Aroma System is the subject and is
   unreadable. Nothing downstream is worth building until that is decided.
2. **A GitHub PAT that can see the repository in question.** `github:aroma-system` returned
   `permission_denied` throughout — safe degradation working exactly as designed, and a
   hard blocker for anything that needs to know the state of that codebase.
3. **A decision record the Owner has actually confirmed.** The proposal store holds one
   pending item; Decision Recall is live and empty. Neither is yet a decision memory.

## Test baseline at closure

- `origin/main`: 1108 total / 1101 pass / 3 known environmental fail
- branch `425e81a`: 1193 total / 1186 pass / the same 3
- `recovery.store.test.js` flaked once under parallel load on an earlier run; passes alone
  and on re-runs. **Not claimed as fixed** — recorded in the test-reliability backlog.
