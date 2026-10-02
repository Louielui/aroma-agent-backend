# Mail subscription backoff correction

Read-only observations on 2026-10-02 found an eligible original reaching its
third semantic attempt at 05:01:35Z, while the next analysis turn recorded the
subscription limit at 05:01:45Z. Its body, source hash and Owner decisions were
intact. The semantic failure only recorded `memory_unavailable`; that old failure
does not prove its individual underlying cause. The expired shared deadline did
not prevent semantic extraction from racing the next analysis quota check.

The production mail-memory construction supplies the analyzer's subscription
preflight to semantic indexing. It reads the fixed local bridge status with a
ten-second client deadline, without sending mail text or starting a model task.
After a shared deadline expires, preflight must succeed before a provider read
or extraction. A provider unavailable/rate-limit result rechecks status to
distinguish a newly exhausted subscription from an actual source/provider failure.

An exact `subscription_limit_reached` or `subscription_login_required` status
persists a one-hour source-bound operational deadline. Unknown status errors
fail closed for five minutes as `subscription_unavailable`. Only that operational
checkpoint changes: the original, source retry budget and Owner decision remain
intact. The next ordinary turn rechecks status when due. Local policy eligibility
classification still proceeds without subscription/model calls.

New analysis failures persist the exact allowlisted subscription code and a
one-hour deadline; other failures retain `analysis_unavailable`. This records
future evidence without inventing the cause of old failures. Existing exhausted,
archived and test records are neither reset nor forcibly retried. Genuine provider
failures with a ready subscription retain the existing bounded retry policy.

This correction does not complete the semantic backlog or six-layer acceptance.
Named-mail provider/source matching, natural-language semantic recall and final
acceptance remain pending. Normal daily backups and their deadline are unchanged.
