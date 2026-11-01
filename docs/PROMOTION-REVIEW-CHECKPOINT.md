# Native promotion review checkpoint

This is an isolated control candidate, not deployment authority. It extends the
existing coordinator/workflow/CLI and keeps Policy, sealed Owner decisions, Audit,
host checks, runtime verification and rollback unchanged. No evidence importer,
pass-file input, new model endpoint or second promotion system is added.

## Problem

The application candidate `2f2b7e31e8620b92af8d68fc17c57b1a36ba69d6` has genuine
full-suite and subscription-review receipts, but they were executed separately
from a native coordinator run. The exact-commit Owner entry accepts only native
source-run evidence. Copying these receipts into an invented PASS run would not
follow that protocol. Existing failed runs are not rewritten or replayed.

## Prepare, then explicitly review the same run

`tranche.cjs prepare-review --files <accepted paths> --message <description>` uses
the ordinary native preparation: preflight/preservation, staged-tree validation,
full isolated suite, exact commit, remote preservation and PR. It records
`awaiting_review` and returns **before** subscription metadata/completion, host
checks, merge or deployment. The native source run therefore has its real test
and commit history without pre-spending a constrained review allowance.

The existing `resume --id <same run UUID>` can explicitly resume that pending
review only. It re-reads the actual full TAP and verifies counts/hash/tree, clean
exact HEAD, published branch and PR head/base, current remote main, running
baseline and original launcher overlays. Drift refuses before a review call.

It persists `reviewing` before dispatch. A successful real review is stored by the
existing review adapter and the run ends at `reviewed_hold`. It never publishes
checks, merges, deploys or reports `complete`. A failure, finding, cancellation,
crash or uncertain dispatch requires inspection rather than automatic replay.
`needs_attention` is still not a valid resumed initial state. Idle polling does
not automatically resume `awaiting_review`. Process locking prevents competing
CLI processes from consuming the same pending review.

Once the complete new SHA is independently reviewed, the unchanged existing
`approvePromotion.cjs inspect` / `approve` path can verify that native source run,
fresh SHA-bound readiness and the three distinct Owner decisions. The accepted
source is carried into a new authorized promotion run without rerunning spent
test/review effects. Review Hold does not waive a security-scope decision or grant
any authority. Ordinary `finish` behavior is unchanged.

## Evidence and limits

Deterministic lifecycle tests cover preparation without review calls, explicit
same-run review, no earlier-stage replay, Hold after review, source drift, failed
review, concurrent resume, replay and restart while reviewing. A real temporary
Git fixture tests exact committed-source and TAP/path tampering rejection. These
are offline fixtures, not a subscription review or live deployment.

For the current work, the reviewed application source remains preserved in the
original branch/PR. This control change creates a new complete candidate SHA and
needs its own independent review; the earlier PASS cannot review it. The original
task and protected catalogue package remain unchanged. The last helper is not
spent during preparation and the eight-call profile is not expanded.

Current minimum future calls are one complete control-candidate review plus one
original coding attempt and one result text review. One helper remains, so the
overall shortfall is two before any retry/pixel review. No quota extension or
replacement allowance is implemented here.

The existing successful backup/isolated-restore proof can be reused only while
valid and after its actual manifest, restored bytes and formal memory baselines
are revalidated and rebound to the new full SHA. Scope exception, Hold release,
deployment consent and any model-usage decision remain separate. No service,
client, HKCU, memory, credential or ACL change is performed by preparation.
