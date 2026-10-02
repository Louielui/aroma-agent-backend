# General memory reads with large source-bound mailboxes

The Owner operations endpoint exceeded its 30-second acceptance deadline on
2026-10-01 after historical mail capture grew beyond 14,000 originals. Service
health and the fixed source/Owner-decision continuity checks remained healthy.
The failure occurred while waiting for `/api/v1/memory/operations`, not during
backup file verification.

The general Gateway previously called `store.all()` and discarded source-bound
mail only after transporting all records through 200-row offset pages. General
lists and status now use `general_page`: PostgreSQL excludes the literal
`admin_mail_` source prefix before transport. The first read fixes the maximum
sequence; later pages keep that cutoff and advance a keyset cursor. Each response
contains at most 2,000 records and has an 8 MiB byte budget. Oversized single rows
and malformed/leaking/stalled responses fail rather than produce false emptiness.

Owner-only status and existing per-scope list authorization remain in the Gateway.
Injected older stores keep their existing fallback; runtime canonical data has no
file or in-memory fallback. The separate mailbox reader, index policy, original
bodies, historical cutoff, Owner decisions, retries and backup schedule are not
mutated by this read path. No model call or index retain is needed for status.

Tests cover actual list/status values, source leakage rejection, cursor integrity,
fixed cutoffs under concurrent inserts, Unicode and byte-bounded PostgreSQL pages.
Runtime performance and acceptance are measured separately from those tests.
