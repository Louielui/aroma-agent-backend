# Usage evidence registration under bounded contention

## Retained failure and limits of attribution

The PR158 acceptance returned HTTP 409 usage_busy after all three subscription helpers succeeded. The retained route guard computed an answer without withheld claims, but its evidence file had no ledger reference and no final turn-output receipt existed. The original OS error and competing lock-holder identity were not retained. A particular background process, exhausted quota or failed model is therefore not an established cause.

The existing store collapsed both lock contention and filesystem errors into target_locked; the usage layer then collapsed acquisition failure into usage_busy. Evidence capture wrote its file before obtaining the ledger lock. A cross-process holder of a copied ledger reproduces exactly that orphan-file and missing-reference boundary with the saved real guard input. This is offline diagnostic evidence, not a replay or successful completion of the stopped live run.

## Candidate behavior

- Keep the existing ordered predecessor/current-root exclusive hard-link locks. Wait at most 250 milliseconds for genuine EEXIST contention using a monotonic clock; release every partially acquired lock before waiting. Never steal, delete stale locks or change process ownership. The internal constructor accepts only an integer 0 through 1000 milliseconds; no HTTP input, profile or grant sets it.
- Retry only acquisition before loading state or invoking a callback. Revalidate scope, paused state, predecessor hashes and quota under the acquired lock. Never retry a mutation, provider send or uncertain evidence save.
- Create and register an evidence file only after obtaining the same existing lock and checking scope. Return a receipt only after ledger persistence. A failed save can still leave an unbound diagnostic file; it is preserved and never reported as a successful receipt.
- Retain bounded sanitized lock diagnostics in the existing evidence directory: public status, phase, root/request identity, errno classification, observed holder PID and elapsed acquisition time. They are explicitly unbound and confer no success or authorization. No raw OS messages, credentials or paths are recorded. If diagnostic storage also fails, report diagnosticSaved=false.
- Persistent contention remains usage_busy. Other acquisition and registration failures remain fail-closed usage_audit_unavailable. Unknown errno remains UNKNOWN. Existing evidence guards, dispatch reservations, restart persistence and pre-send caps remain active.

## Verification

Saved private input is replayed only against temporary copies of all seven paused ledgers. The original code reproduces usage_busy with an orphan file; the candidate binds exactly one hash-checked guard receipt and preserves the original answer. All seven live files remain byte-identical; no model is called. Private input is retained in the local delivery directory and is not committed.

New executable regressions cover real-host transient contention, bounded persistent contention, sanitized access failure, non-replayed save failure, scope becoming paused during acquisition, internal wait bounds, and native intake guard/turn-output registration. Existing parallel reservation, Bridge, restart, predecessor and quota tests remain required. Three older extended-contention fixtures explicitly set internal lockWaitMs=0 solely to keep their 151 outer retry observations within the original test deadline; their independent default-deadline and real cap-attainment checks remain intact.

## Delivery boundary

This candidate adds no profile, allowance, dependency, ACL, credential or business operation. Seven existing acceptance ledgers remain paused and unchanged. Tests and independent review precede a separate exact-SHA Owner deployment decision. No real acceptance is resumed by this change; production success and successful reply latency remain unverified until separately authorized and measured.
