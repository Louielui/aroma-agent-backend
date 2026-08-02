# Aroma Morning Briefing v0.1

Read-only Owner executive briefing, generated on demand from the same production read path
the chat lane uses. Not a restaurant operations briefing — see **Coverage** below.

## What generates the text

**Deterministic rules. There is no LLM in this path.** No prompt is built, no provider is
called, and the audit records `provider: 'none'`, `model: 'none'`. Every sentence is
assembled from source fields and fixed strings.

**The correct statement of what that buys, and it is narrower than it sounds:**

> There is no LLM generation, therefore no LLM hallucination surface. Deterministic rule
> errors, classification errors and presentation errors remain possible.

It must not be written up as "hallucination is structurally impossible". The class of error
that is excluded is one class. A wrong window boundary, a source mapped to the wrong scope,
a mis-worded template, or a section that reads as more certain than its evidence are all
still available, and all of them would be *our* mistake rather than a model's.

## Statement scope — decided by SOURCE, never by text

`src/coo/statementScope.js`. Each source may produce exactly one kind of claim:

| source | scope |
|---|---|
| drive · gmail · calendar · github · github:aroma-system | `source_record` |
| proposals · decision-recall | `owner_work_item` |
| `coverage:<source>` | `coverage_state` |
| aroma-system | `business_state` |

A `business_state` item can therefore only exist if it came from Aroma System, which has no
connector — so v0.1 cannot produce one, and the delivery validator enforces that rather
than trusting it.

`source_record` items are worded as **containment**: `gmail contains a record: "<title>"`.
They say what a source holds, never what is true of the business. The external title is
quoted, which is also what makes the vocabulary backstop precise — it scans only the
narrative this system wrote and ignores quoted material.

**An item is never hidden because its title contains "stock" or "sales".** That was the
earlier design and it was wrong: an email whose subject is "sales up 12%" is a real, citable
record the Owner wants. The danger was never the word; it was presenting it as operational
truth. The vocabulary scan is defence in depth only.

## The delivery gate

`src/coo/briefDelivery.js` → `validateBriefForDelivery(brief)`, called once in the router
**before** the response and **before** `contentHash`, so the hash attests to what was
actually delivered.

It checks id uniqueness, provenance on every fact, scope-matches-source, business_state
only from aroma-system, legal item shape, legal coverage tri-state, and citation integrity
**to a fixpoint** — removing a fact removes what was derived from it, and removing that
removes what was derived from *it*.

**It removes. It does not flag.** The Owner sees a count (`N 項因證據不足未有顯示`) and never
the withheld text. A validator throw is fail-closed: no payload is sent at all.

Audit outcomes: `ok` · `items_removed_before_delivery` · `delivery_validation_failed`.
The former `operational_claim_blocked` is gone — it named a block that never happened.

## Coverage

Data Coverage names **questions** as well as sources, because a question with no source at
all was previously invisible:

- `aroma-system` — unavailable: read-only connection not configured
- `deadlines` — unavailable: no source configured
- `awaiting-reply` — unavailable: no source configured

These are marked `permanentGap` and are deliberately **not** reported as daily Risks. A
standing gap repeated every morning buries the source that actually broke today, and
because Risks feeds Top Priorities it would fill all three slots forever.

Nothing about sales, stock, production, cost, purchasing or attendance may be inferred from
Gmail, Drive or GitHub.

## Privacy

The brief body exists for one response. Persisted audit is metadata only — a closed
allowlist, a redundant denylist, no nested structures, and a sha256 of the body.
Third-party text (subjects, summaries, filenames, PR titles) is never written to disk, in
either the delivered or the withheld set.

**Persistence is opt-in** (`createBriefStore({ persist: true })`). It used to default to on,
and tests that believed they held a throwaway store appended to the real audit file.

Errors: the browser receives a fixed code and no detail; the log line is scrubbed of URLs,
paths, addresses and opaque ids before it is written.

## Coverage errors are a fixed vocabulary

`src/coo/coverageError.js`. An adapter's message is written for developers and carries the
endpoint URL, the query, a secrets path, an account address or a bearer token. It is
projected to one of six codes — `configured_off`, `credential_unavailable`,
`permission_denied`, `timeout`, `read_failed`, `source_unavailable` — plus an optional
scrubbed, 80-character detail. The raw string is discarded at that line and exists nowhere
downstream: not in the response, not in the Risks text, not in a log, not in the audit
(whose `sourceStatuses` rows carry source/state/count only).

## Derived items may not dress as facts

An `inference` or `recommendation` is the system's own reasoning: it carries **no
provenance of its own** — its evidence is the facts it cites — and its scope may only be
`owner_work_item`. `business_state` is fact-only, and only from `aroma-system`, so a
recommendation can never reach it. A provenance `link` is accepted only as a parsing
**https** URL or `null`; `javascript:`, `data:`, `file:`, `http:` and unparseable strings
are removed before delivery.

## Audit store ACL

`C:\Aroma\BriefAudit\brief-audit.jsonl`, provisioned by
`scripts/coo/provision-brief-audit.ps1` on the same model as the conversation archive:
inheritance **broken**, and exactly `SYSTEM` + `BUILTIN\Administrators` + the Owner account.

**AromaOperator has no access.** The Computer Operator account drives a UI under a sealed
work order; it has no business reading what the Owner was briefed about, when, or how many
items were withheld. The provisioner verifies this by SID and exits non-zero if that
account appears.

**The runtime never creates this directory.** A directory created at runtime inherits its
parent's ACL, so the store would have quietly existed with whatever `C:\Aroma` grants — the
protection would have looked present while being absent, and nothing would have said so.
Provisioning is a **deployment prerequisite**; before the first write the store verifies
that the directory exists, that inheritance is broken, that SYSTEM, Administrators and the
Owner are present, and that AromaOperator is not. Any defect is a fixed refusal enum
(`audit_dir_not_provisioned`, `audit_acl_inheritance_not_broken`,
`audit_acl_operator_present`, …).

**An audit failure never costs the Owner the brief.** A missing directory, a wrong ACL, a
full disk or a failed fsync all yield HTTP 200 with the validated brief, `stored: false`
and a fixed `storeRefusal`. Only a *delivery validation* failure is fail-closed. The two
are deliberately opposite: one is about whether the answer is safe to show, the other about
whether the note about it was filed.

## Limits of v0.1

- Recent Activity is recency, not importance — it is named for what it computes.
- No rate limit; each press is a fresh fan-out to four external services.
- The route relies on `SameSite=Strict` for CSRF and does not add the `Origin` /
  `Sec-Fetch-Site` checks the Owner approval router uses.
