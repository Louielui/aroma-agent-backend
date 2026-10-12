# Subscription account quota evidence v1

This slice adds on-demand read-only account evidence to the existing usage source,
not a scheduler, billing estimator, model dispatcher or Action Gateway.

## Connected path

Owner bridge `/subscription-metadata` → official Codex app-server read RPCs →
`xiangxiang_operations.readInvestigation` usage section → structured investigation
and bilingual source-bound cost answer. The existing read authorization remains
required. Empty-body, authenticated, origin-rejecting bridge reads run independently
of inference with a separate bounded single-flight transport. No turn, thread,
reset-credit consumption, login mutation or paid fallback is invoked.

`account/read` with `refreshToken:false` verifies ChatGPT subscription authentication
before and after collection; an account change withholds the snapshots. Only an
allowlist of quota windows, credit balance, aggregate summary and up to 60 daily
buckets is returned. Account identity, email, thread usage, credentials and raw
provider errors are not exposed. Prefer the per-limit map over the legacy bucket.
Missing and expired windows have unknown remaining percentage. Partial or unsupported
activity reads do not erase quota evidence, and missing legacy files do not erase
official account data. Preserve read timestamps, omission counts and provider-day
timezone uncertainty. Conflicting same-time snapshots are withheld.

## Scope and limits

Quota percentages and provider credit balance are account snapshots, not money,
credits spent or Xiangxiang-only usage. Lifetime and daily tokens overlap; do not
sum them or add local invocation/session counters. Per-job charge attribution and
account-to-invocation identity are unknown. Billing remains unconnected.

Claude Code documents interactive `/usage`, including subscription bars and locally
estimated session cost. This slice has no verified supported noninteractive quota
source for Claude. It reports the automated source unconnected and does not scrape
private endpoints, read OAuth files, send `/usage` as a model prompt, or confuse
local dollar estimates with subscription billing. Existing Claude invocation token
receipts remain independent evidence.

## Validation

Before implementation the closed subscription route regression failed with HTTP
404. Controlled tests cover authenticated concurrent reads during inference,
exhausted quota, API authentication rejection, account switches, partial-source
failure, zero versus missing values, expired windows, bounded and contradictory
daily records, adapter fallback and source-bound bilingual answers. Runtime
acceptance reads the official account APIs without dispatching a model, then checks
the loaded backend/bridge commit and architecture entry separately.

Official references (checked 2026-10-09):
- https://learn.chatgpt.com/docs/app-server — account/rateLimits/read and account/usage/read
- https://code.claude.com/docs/en/cli-reference — supported CLI commands
- https://code.claude.com/docs/en/costs — interactive usage and estimated cost boundaries
