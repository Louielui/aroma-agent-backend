# Catalogue provider failure: isolated recovery

Historical receipt for candidate `24ff4f217f415042f026efa02e8b400e35e96d27`.
The subsequent same-work recovery infrastructure candidate separates the copy
change from deployment; see `SAME-WORK-CODING-RECOVERY-20261101.md`. Its new source
must receive a new independent review; the review of this earlier commit is not
reused. The earlier copy candidate and acceptance evidence remain preserved.

Work run: `ceb79374-ecc1-4ae0-be42-290bb72e63da`.
Existing task and unchanged allowance root: `bce88bcd-5660-43b5-b418-02c13e40e62e`.
Baseline source: `226fbd6518b3128d2154c5c99ac7b87a97e6bce3`.
No merge, deployment, business writes, API fallback, new allowance or failed-run replay is authorized by this investigation.

## Measured failure and uncertainty

The registered catalogue is 549,766 UTF-8 bytes / 427,068 JavaScript characters.
The old coding schema explicitly required complete replacement contents, while
the Codex client accepts at most 100,000 completion characters. This is an
intrinsic incompatibility, independent of available subscription allowance.
The coding timeout is 480,000 ms. The failed provider wait was 111,844 ms;
elapsed time does not establish a 120-second timeout or exhausted quota.

The original client discarded stderr, exit code and signal, and flattened
transport timeout, process exit, malformed RPC and the 4 MiB cumulative stdout
limit into the same `subscription_unavailable` error. No original safe diagnostic
was persisted. Retained CLI metadata confirms streaming activity, but cannot
establish which branch terminated this attempt. The exact original termination
cause and exit code remain UNKNOWN; no historical error is invented.

A metadata-only subscription check found authenticated ChatGPT subscription,
primary used 38%, credits disabled, no reported rate/spend-control stop. It sent
no model turn and consumed no helper. This is current readiness, not a recovery
of the missing original diagnostic.

## Isolated changes

- Large editable sources use bounded exact replacements, bound to the current
  SHA256, unique anchors, allowed paths and existing file/package limits. Small
  and moderate files retain their prior replacement schema (80,000 serialized
  source characters leaves envelope/summary room under the 100,000 cap).
  No output or timeout cap grows. The first full-suite run caught an overly
  aggressive 40,000 threshold changing the existing moderate CSS fixture
  contract; the threshold was corrected rather than weakening that fixture.
- Repair uses the current candidate hash and preserves original before evidence,
  protected tests and all prior attempts.
- Transport errors retain a closed reason classification, byte counts, finite
  bounds and available exit code/signal. Provider bodies, credentials and raw
  stderr are not persisted. Public failure codes remain compatible.
- Oversized code-review packets omit only identical outer text and duplicate
  candidate bodies, retaining all final differing text, complete context lines,
  source hashes and measured tests. Review scope is explicit. Packets still too
  large are refused; this is not whole-file line review.
- The catalogue candidate changes only the bilingual `work.scope` sentence to
  use the actual work-order receipt as model/effort authority.

## Evidence and delivery limits

The catalogue candidate was produced by deterministic host edits, NOT by a
completed GPT coding receipt. The original protected test is unchanged:
`ca4e80d09ed2d53c778c30c491527dfac77bdd163e4e69674e93cc410ad64ff3`.
Its original four tests pass in the real offline Windows Sandbox; baseline was
previously measured at three failures. All bytes outside the `work.scope` line
are unchanged. Sandbox evidence hash:
`feff7c19c3e36f6a73dac9dd351b792ceabe9c93c5f9f35bd9f7ac46c04e3435`.
Original full review packet: 2,230,278 bytes; compact candidate packet: 9,231 bytes.

The failed task has no supported same-ID post-approval resume endpoint. Its
approved nonce cannot be replayed, `renew` applies only before approval, and
preparing again returns the existing task. No task/approval/usage record is
rewritten and no replacement task or service instance is used to evade this.
Native retry is therefore blocked on a separately reviewed recovery/delivery
path, not on an assumed quota failure. A normal coding plus independent review
needs at least two helpers, with additional repair/review charged separately.
Use only the unchanged original allowance after checking its actual balance.

Deployment remains separately approved. Preserve the existing launcher overlay.
Desktop/mobile actual-pixel acceptance and a real native resumed coding receipt
remain outstanding. Passing deterministic tests does not close the original job.

Private evidence is under
`C:/Users/louis/Documents/Codex/local-candidates/catalogue-provider-recovery-20261101`.
Exact tested commit, independent review and PR status are recorded by the normal
repository workflow; no old promotion run is replayed or relabelled.
