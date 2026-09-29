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
The administrative mailbox is adm@aromabistro741.com. Separate consent and inbox
metadata preview passed live acceptance on 2026-09-29: the Owner completed Google
consent and the UI read ten inbox message summaries from the verified mailbox.
Louie may read both Drive sources; Ivy may read Admin Drive. Both are granted the
administrative mailbox once its independent source authorization is completed.
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
member token vault, remote sign-in or Gmail delegation. Mailbox source consent is
independent of human member sessions.

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

Automated acceptance uses injected Google clients and temporary stores. Owner login
and Aroma Base listings have screenshot evidence. Administrative mailbox consent
and a ten-message inbox preview passed live acceptance on 2026-09-29. Ivy login,
Google-side revocation and remote-device operation remain pending.
The registry is a single-process atomic JSON store in resolveDataDir(), not the
restaurant database. Multi-process hosting needs transactional storage and session
coordination before rollout.

Rollback: revert the delivery commit and restart the local service; remove the rollout
environment setting only as part of that rollback. Retain the access registry for audit.
Do not disable the Owner boundary while continuing to expose member routes.

## Administrative mailbox

The Owner starts consent at /company-access. The callback is
http://127.0.0.1:8090/company/mail/callback. Only openid, email and gmail.readonly
are requested. Nonce, PKCE, cookie-bound state, verified Workspace identity and
Gmail getProfile must all match the registered mailbox before a grant is saved.
The refresh token has a dedicated file, separate from the Owner Google token and
from the operational registry. Prepare its directory with the elevated
scripts/service/prepareAdminMailboxStore.ps1 script. The fixed directory under
C:\ProgramData\AromaXiangXiang\admin-mail-secrets grants access only to SYSTEM,
LOCAL SERVICE and Administrators. Consent startup probes service write access
before sending the user to Google.

The source credential authorizes the shared mailbox. Human access additionally
requires an authenticated Owner or a verified member session with the admin-mail
grant. Suspending a member or revoking that grant blocks subsequent reads.
Every preview verifies the current Gmail profile, then reads at most ten INBOX
messages as metadata and snippets. No full bodies, attachments, sends, deletes or
read-state changes are exposed. Responses use no-store and render content as text.
This preview is not wired into chat, background ingestion or Hindsight.

Source status is a last-verification result, not continuous health monitoring.
Provider errors mark the source failed. Disconnect invalidates pending callbacks,
marks the source disconnected and deletes only its local credential. Google-side
consent can be revoked separately through the user's Google account.

Google documentation:
https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
https://developers.google.com/workspace/gmail/api/auth/web-server
