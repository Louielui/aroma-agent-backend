# AI delegation-list acceptance entry

This is an inert proposal, not activation, deployment consent, or real-model
acceptance. It extends the existing Action Gateway / atomic Action Store / Bridge
usage boundary. No new provider, route, credential or accounting store is added.

The proposed root is `c31f97a9-f3d5-4510-a04f-ec257a843747`: one turn, at most six
helper reservations including failures, retries and child work, zero websites,
Claude Opus 5.5 / Medium through the existing subscription only. The goal is to
measure the deployed answer to “Which AIs can you delegate work to?” rather than
execute a delegated job. Automatic memory is paused only in an approved shared
acceptance window, then its previous setting is restored.

Both historical roots remain paused and byte-preserved:

- `f1d1f674-3820-4619-85ed-3b8fdeb01e98`
- `6181f0ad-90d7-4c89-9886-39671ce75a05`

The existing authenticated Owner operation remains
`usage_acceptance_activate`, with exactly `op`, `rootId`, and `predecessorHash`.
For this root, the last field is the existing contract `hash()` of the ordered
array `[{rootId: latencyId, hash: hash(latencyRecord)},
{rootId: arbitrationId, hash: hash(arbitrationRecord)}]`. Each parent must exist,
be paused, retain its original profile and have no unresolved reservation,
entered unfinished turn or unfinished child. Parent and new-root locks use the
same historical order. All reads of an existing new root revalidate its bound
parent records; drift fails closed rather than falling back to another ledger.

Installation creates no ledger. Resident backend and Bridge keep the historical
selection until the explicit Owner activation passes the existing idle witness.
Thereafter they resolve the same durable new root on each call. The old operation
and single-parent hash for the earlier independent acceptance remain compatible;
neither old root is closed, resumed, reset or credited by this addition. Repeated
activation, changed root/limits/model, missing scope and API fallback are refused.
The normal `usage_activate` and repository usage-extension operations cannot
reopen or extend this acceptance. Restart does not refund reservations.

Offline tests exercise the real Bridge, Action Gateway, resident selector and
intake route with local provider substitutes. They check failed attempts,
parallel child work, independent Node hosts, restart, persistence failure,
parent drift and lock contention. The seventh helper and first website are
refused before the substitute provider is invoked. These are accounting and
entry tests, not proof of real model classification, list accuracy, UI quality,
provider availability or latency.

After full-commit independent review and exact-version deployment approval,
technical checks must first verify the installed source and that no new ledger
exists. Only separately approved acceptance may activate the fixed new root.
The single question uses the saved two-message greeting history; the previous
failed answer and the host's expected answers are not supplied to the model.
Record raw prompts, authorized tool results, raw outputs, guard transformations,
final payload and actual visible UI. Time send-to-visible completion and observed
server/provider phases without summing overlapping intervals. Keep unknowns
explicit; one successful answer cannot establish general latency or complete
delegation functionality. Stop on the first substantive or unknown failure.
