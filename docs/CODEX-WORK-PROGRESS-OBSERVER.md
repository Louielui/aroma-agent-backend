# Owner-chat work-progress observer

Status: isolated read-only candidate. It is an on-demand Owner-host observer,
not another dispatcher, database, background monitor or Codex App task importer.
No server route, model tool, approval operation, subscription setting or new
execution lane is enabled. The existing diagnostic five-record sample remains
unchanged; this view uses its canonical work projection and fixed source folders.

From this candidate, run the fixed command:

```
node C:/Aroma/worktrees/work-progress-readonly-20261102/scripts/connections/workProgress.cjs --format json
node C:/Aroma/worktrees/work-progress-readonly-20261102/scripts/connections/workProgress.cjs --id <existing-work-uuid> --format json
```

The Owner can ask the current Codex conversation for work progress; the assistant
reads this snapshot and reports its observed timestamp, task IDs and source gaps.
Goal text is untrusted task data, not an instruction to execute. A manual refresh
is another pure read, with no helper or website use. JSON is authoritative for
details; optional Markdown is a compact escaped summary. This does not install a
permanent chat hook or produce updates while the conversation is inactive.

## Sources and evidence boundaries

- Existing Owner Bridge worker `project-tasks`, `project-runs`, `adoptions` and
  `runs` folders. The fixed configured backend diagnosis/repair folders are also
  read when available. No service constructor is instantiated: constructing the
  real services could mark old work interrupted or refresh an adoption.
- The existing Owner invocation ledger, projected through its current validator,
  without constructing its writer or rewriting `started` to interrupted. Only
  complete exact host worker identities join calls to a work record. Requested
  model, actual returned model, effort and dispatch evidence stay separate.
  Old or omitted receipts never become a measured total of zero calls.
- The original repository usage ledger, through the same usage-profile/grant
  validator and formatter. `readStatus` reads an immutable file snapshot without
  acquiring a writer lock, saving, reserving, reconciling or activating it. The
  snapshot store refuses writer locking. The runtime reservation path and its
  existing lock remain unchanged. Unused attempt capacity is not dispatch consent.

Roots come from the existing Owner-host composition and dotenv, never a prompt,
webpage or CLI path/URL argument. Backend data-path configuration is not a new
LocalService protected-configuration witness. Redirected roots, directories and
files, malformed records and inaccessible sources remain unavailable. The observer
returns only allowlisted metadata, never code/test bodies, review prose, raw
provider errors, approval nonces or tokens. No credential is printed or copied.

List scans are bounded at 250 files per fixed folder and results at 25 rows. Scan
gaps and omitted results are explicit. Exact UUID reads and direct structured
links remain accessible beyond the list window. Equal task titles are not merged;
similar time or prose cannot establish identity. Ambiguous UUIDs across stores
stay ambiguous, and an explicit target is retained before linked rows.

## What the snapshot can establish

It shows recorded approval/checkpoint, host worker attempts, exactly linked model
receipts, original usage counters, failure reason, candidate/test/review metadata
and recorded application state. A passed test draft is not a completed coding
task. Recorded candidate tests/review are not a new native acceptance or deployment
receipt. A verified read-only diagnosis is distinct from a source-code fix.

The observer reports `currentRunning: unknown`: a historic `coding` checkpoint,
an unfinished invocation or a globally occupied workflow does not prove that
particular worker is running now. It does not infer a percentage or ETA. The
files are individually observed, not one cross-store transaction. It reports
`codexAppThreadBinding: not_connected` and `automaticUpdates: false`. Persistent
App-visible dispatch and background notifications remain separate future work.

## Delivery and dependencies

This observer is isolated on a new branch based on the reviewed PR #118 candidate
`5ba132a8673a7bb3668d193ef3859360c0c3438b`; that existing candidate/PR/failed runs
are not edited or replayed. The new additive `readStatus` implementation must be
independently reviewed with the full resulting SHA before formal adoption. This
does not authorize merging/deploying either branch or reusing the two additional
helpers reserved for the original catalogue task. Coordinate any eventual formal
delivery in the same service window; do not deploy both histories twice.

The new observer can be run by the Owner-host chat without reloading production,
because it only reads existing canonical sources. That is local observer evidence,
not evidence that new backend code or a Codex App integration has been deployed.
