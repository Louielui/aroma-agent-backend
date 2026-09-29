# Company access foundation

Local rollout: set XIANGXIANG_COMPANY_ACCESS=1 and restart. The switch enables
the member workspace and a default Owner gate over legacy and future routes.
Only the health endpoint and state/cookie-protected Google callbacks bypass that
gate. Owner login already has its own authentication routes. Member routes are
handled before the boundary, with separate sessions; service tokens and Owner
cookies do not establish a member identity. The listener remains loopback-only.

## Current surfaces

- /company-access: Owner-only registry, grant/revoke, suspension, source probes,
  and the most recent 500 access changes. Probes use the existing Owner Google
  credential, verify the account and root metadata, and never claim member access.
- /member: independent Google sign-in and a metadata-only Drive browser. Twenty-five
  entries per listing, explicit truncation, no recursive ingestion or shortcut following.
- /api/v1/member/files: source grant, current Google access and parent ancestry
  checks for both listings and direct file IDs. A request finishing after a registry
  revision changes is rejected. Responses are not cached.

Registered sources are Aroma Base (0AJApVuax7MarUk9PVA) and its Admin folder
(1iYHY8Muo3K3HSPON5Uu0C8cNgOITei8C), discovered read-only on 2026-09-29.
The separate administrative mailbox has no address or credential yet.
Louie may read the two registered Drive sources; Ivy is granted Admin Drive only.
No other members are inferred from Drive sharing. Folder shortcuts are excluded.
The app grant restricts Xiangxiang; it does not remove existing Google permissions.
Opening a Google Drive link leaves Xiangxiang and Google applies its own permissions.

## Identity and credentials

Only the two registered emails can bind a verified Google subject. Google verifies
the ID token signature, issuer, audience and expiry; the flow verifies nonce, state,
browser cookie, PKCE, Workspace domain and verified email. A bound subject cannot
be replaced by another subject claiming the same email. Subject IDs, not display
names or request-supplied roles, identify sessions.

The existing OAuth application configuration is reused, but the Owner refresh token
is never read by the member flow. Web clients must register this exact callback:
http://127.0.0.1:8090/company/oauth/callback
Installed clients must support Google's loopback redirect. Configuration failure
leaves the flow unavailable; no credential or provider error is echoed.
Starting member sign-in revokes the current browser's Owner session to avoid carrying
Owner authority into a member session. Member consent requests openid, email and
drive.readonly only. Tokens stay in memory
for at most one hour and are lost on logout, expiry or restart. There is no durable
member token vault, remote sign-in, Gmail delegation or mailbox consent yet.

Source of identity verification guidance:
https://developers.google.com/identity/openid-connect/openid-connect
https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## Memory boundary and remaining acceptance

Existing chat, memory, briefing and operator endpoints remain Owner-only.
The member gateway has an all-source reference checker; empty, denied, missing or
revoked references fail closed. It is tested for future derived-record consumers.
It is NOT connected to Hindsight or member chat. No shared memory bank is created.
Connecting those consumers requires retaining every source reference and rechecking
each source on every retrieval, including direct IDs, search, citations and summaries.

Automated acceptance uses injected Google clients and temporary stores. Real Owner
and Ivy sign-in, independent source reads, Google-side revocation, and remote-device
operation remain pending. Do not describe those as connected based on fixture tests.
The registry is a single-process atomic JSON store in resolveDataDir(), not the
restaurant database. Multi-process hosting needs transactional storage and session
coordination before rollout.

Rollback: revert the delivery commit and restart the local service; remove the rollout
environment setting only as part of that rollback. Retain the access registry for audit.
Do not disable the Owner boundary while continuing to expose member routes.
