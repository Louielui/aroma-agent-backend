# Department workspaces v1

Owner requested business department navigation on 2026-10-10. The existing daily
menu now presents HR, Purchasing, Operations, Accounting and Marketing, followed
by shared briefing, documents, calendar and mail tools. Development, management
and settings retain their existing destinations.

Departments are presentation and durable conversation scopes, not permissions or
capability namespaces. Existing topic IDs and stored membership remain unchanged.
Four closed IDs are added: `hr`, `purchasing`, `accounting`, `marketing`.
Operations continues using `operations`; no history is bulk migrated.

HR offers explicit-date clock-out query preparation through the existing composer.
No date is preselected. The requested civil date is in America/Winnipeg. Preparing
does not send, invoke a model or read employee data, and cannot replace an existing
draft or a pending request. Sending follows existing topic membership, model
selection and the permission-checked bounded 7shifts reader. Results retain the
existing durable conversation/table path. No new adapter or write authority exists.

Each department reuses persisted manual follow-ups, last conversation restoration
and central-or-custom topic model selection. Email and other department history
remain separate. Purchasing, Accounting and Marketing dedicated data tools are
explicitly unconnected; HR lateness, overtime analysis and recruiting are future
work. Manual follow-ups do not schedule jobs or send messages.

Acceptance: disposable-store isolation/legacy compatibility/model resolution;
actual bilingual desktop/mobile browser date preparation, draft protection,
explicit send with the selected model, saved result restoration, note persistence,
keyboard focus and overflow checks. Tests intercept provider traffic and do not
consume subscription usage or write operational data. Architecture inventory marks
this release partial because department-specific data capabilities remain bounded.
