# Client publication and rollback error propagation: isolated repair

Status: candidate implementation. No deployment, replay of the failed promotion,
client publication, registry change or original work recovery is authorized by this
document. The actual installed service remains the PR119 merge; its client is old.

## Real evidence and offline reproduction

Promotion `594bb1ea-ed9b-4eba-b67a-7ca90592e00f` merged PR119 and loaded backend /
Bridge commit `9572759b3e1ec8fe69ecfd891df4e251e05c63ec`, but returned
`client_publication_failed`, followed by `rollback_failed`. The first private
packaged file exists, with no installation/publication completion receipt. Its
original child exit code and stderr were not retained; those historical details
remain unknown and are not fabricated by this repair.

The actual Windows PowerShell 5.1 packaging loop, executed against a private Git
fixture, fails at `Get-FileHash` with `CommandNotFoundException` after the first
copy. A read-only native-command probe confirms this host lacks that command,
while JSON conversion, Add-Type and file-management cmdlets are available. This
is a reproduced environmental failure consistent with the original partial
package, not a claim that missing historical stderr was recovered.

The installer now hashes file bytes directly with built-in .NET SHA256 and closes
both stream and hasher. Source Git-blob pins, fixed executable, origin, per-user
registration, managed client manifest and restoration boundaries remain unchanged.
It does not repair module paths, install software, change execution policy, grant
rights or make the repository/source path configurable.

The runtime verifier retains child exit code, timeout/signal and output byte
counts/hashes, plus one strictly validated installer stage/error marker. It stores
no raw stdout/stderr, credential, token or arbitrary exception text. The installer
emits only a fixed stage, closed reason/type/error-ID metadata and an optional
exact registered source name. Unrecognized or forged metadata stays unavailable.

## Existing rollback authority, preserved failure detail

The real workflow passed `client_publication_failed` unchanged to the existing
rollback adapter, which accepts only runtime-verification categories. Reproduction
from that immutable failed run rejects as `rollback_not_authorized` before network
or credential access. PR120 was created but not merged; no rollback occurred.

Only the four defined client-verification failures now use the existing
`runtime_verification_failed` category. Their original boundary and safe diagnostic
receipt remain attached. This applies to both immediate and legitimately pending
deployment verification. Unknown categories remain refused. Exact-source, PR/base,
Owner capability, expiry, idle and independent rollback read-back checks are not
removed or expanded. Known refusal reasons are retained; arbitrary thrown prose
is still discarded. Failed runs are not resumable inputs or relabelled success.

## Verification and remaining delivery gates

The new tests execute the actual packaging loop with all sixteen reviewed inputs
and the complete Windows preparation entry in an isolated Git repository/profile,
with registry access fenced. They compile the actual native hosts and check their
receipts, hashes and fixed extension origin. This is real local fixture execution,
not publication into the Owner's managed client or real HKCU acceptance.

Additional tests drive the real workflow and rollback adapter together through
each recognized client boundary, immediate/pending paths, unknown failures,
expired recovery and safe diagnostic redaction. Existing origin refusal, native
pipe, source-pin, permission, head-race and full-suite checks remain required.

Delivery requires a new complete SHA, native full-suite evidence, independent
Claude subscription review, a fresh exact-source readiness package and explicit
Owner recovery/deployment authority. Do not replay the old needs_attention run or
merge PR120 automatically. The original catalogue task and its additional two
helper attempts remain untouched; this repair does not activate or consume them.
