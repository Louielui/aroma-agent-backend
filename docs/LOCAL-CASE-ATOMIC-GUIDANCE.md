# Atomic case cells and exact-source baseline references

The retained native PR190 sample accepted its source card, sent one Qwen3.5 9B
draft and stopped at `case_plan_expression`. Two maximum-input cells contained
`Number.MAX_SAFE_INTEGER,` with a trailing comma. Separate raw-data comparison
found 20 missing stock refusals and one missing duration refusal, including a
string input changed to the valid number 2, and an incorrect maximum-duration
expectation. No review, test-version approval, coding or guest followed. Original
input/output envelopes and hashes remain in `case-atomic-native-v1.json`; the
original false counts and their later exact-tuple correction stay in host evidence.

The isolated candidate changes generation input and its advertised schema only:

- An expression-cell pattern excludes a dangling comma/semicolon. The existing
  parser remains authoritative and unchanged. Quoted commas and commas inside
  allowed arrays/objects remain eligible; no strip/trim repair is added.
- Explicit guidance separates complete expression cells from JSON separators,
  string inputs from numbers, and old exact expectations from new-format examples.
- For the existing source-hash-bound example profile only, `referenceCases`
  expands the already-audited 52 baseline cases into drafting INPUT: method,
  full argument tuple, exact expected expression and permitted alternatives.
  It contains only 35 stock and 17 old-duration cases. It supplies neither new
  function cases nor an implementation or verdict. Unknown/changed source fails
  closed; unrelated profiles receive no reference catalogue.

This makes source references explicit; it does not prove the model independently
derived the baseline. The model must still return every case in its own response.
Neither rendering nor review imports missing cases from these references. Missing,
conflicting, ill-typed or malformed returned cases still fail. All existing new
function examples, required probes, full semantic review, immutable test/source
hashes, personal version cards and Sandbox RED/GREEN remain mandatory. The full
prepared packet and native raw input must be retained so later acceptance can
prove which reference data was actually provided.

Offline replay keeps the original bad response rejected, proves source-bound input
references and schema restrictions, and tests complete independent synthetic
case data without relabelling it as native output. A temporary-store integration
uses a transport double: one mocked send, raw evidence retained, root paused,
zero review/cloud/guest. It is not new real inference or OS isolation acceptance.

No expression grammar, renderer admission, baseline validator, review validator,
provider, permission, output limit, shared budget, approval or cloud prohibition
is relaxed. Fresh Qwen adherence, accurate new test generation, review quality,
speed improvement and successful coding have NOT been revalidated. This source
remains isolated and requires exact-source tests/review and separate deployment
approval. Automatic memory and all 24 roots stay paused and byte-identical;
48 old task files and original evidence are unchanged. No new runtime allowance,
work/card, guest, deployment or cloud fallback is authorized.

The first full validation retained an unchanged WSL/GitHub refusal-probe failure;
its unchanged isolated rerun passed. A second same-tree full run retained a
different WSL clone `ETIMEDOUT` and a memory callback count of 17 instead of 18.
The callback's original refusal branch was not recorded and remains UNKNOWN;
passing the unchanged test alone does not establish that historical cause.

Owner separately authorized test-only diagnostics and resource isolation. The
memory callback fixture now isolates both default data/artifact directories as
well as its already-private budget/evidence, restores its environment and closes
the server before cleanup. On failure its native TAP retains bounded HTTP codes,
attempt/dispatch/state counts and closed lock-failure categories, without signed
headers, SDK credentials, memory contents, raw OS errors or paths. No callback is
retried or refunded. The original 18 successes, three cap refusals, 18 dispatches,
post-finish rejection and all deadlines remain. Production usage, Bridge and
memory mechanisms are unchanged; test isolation is not a claimed production fix.
Both failed full runs remain immutable. Final acceptance requires a complete
passing run on this changed tree and independent exact-source review.

Owner additionally approved WSL test-only diagnostics and necessary isolation.
The fixed distro's fixture lock formerly depended on each run's artifact root.
A cross-process regression with two different artifact roots measured an overlap;
the test-only lock now shares one temporary location, retains the same wait limit,
refuses stale/unknown ownership, and never deletes another owner. No historical
timeout is attributed to that defect without direct evidence.

The workspace live test wraps the actual exact WSL runner with an observer that
forwards the original argv/options and original result/exception unchanged. It
records clone timing, deadline, exit/timeout and closed transport-error categories,
plus output byte counts; raw arguments, paths, stderr and credentials are omitted.
There are no retries, subprocess/config/environment changes, new skips, assertion
changes or production runner edits. Six fixture checks passed, including a real
bounded child timeout and the cross-process lock regression. The actual unchanged
clone/replacement security assertion then passed once in 39.782 seconds with this
observer and lock. This does not identify the historical transport cause or prove
all transport stable. The complete exact-source suite remains a separate gate.
