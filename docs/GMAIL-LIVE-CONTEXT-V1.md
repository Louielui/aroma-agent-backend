# Gmail Live Context v1

The Owner can read the current personal mailbox and independently authorized
administrative shared mailbox through the Tool Gateway. This closes the fifth
source type in the Owner read-only Live Context flow; it does not complete Memory,
member access, arbitrary worker dispatch or any write-capable connector.

## Contract and scope

- `gmail.owner_mail` is private; `gmail.admin_mail` is company data constrained to
  the registered administrative source. Both require the Owner role.
- `list` accepts today, unread or a bounded inbox list. Today uses Winnipeg civil
  boundaries, including DST, expressed as epoch seconds for Gmail search.
- `search` accepts a literal keyword, subject or sender phrase (80 characters).
  Arbitrary Gmail operators, account identifiers, URLs and pagination tokens are
  not caller inputs. Searches and lists read at most one page of ten inbox IDs and
  metadata in two bounded waves. Sent-only mail, Spam and Trash are outside lists.
- `get` reads a validated message ID from the selected authorized mailbox, including
  messages outside the inbox. Inline MIME text is decoded; HTML becomes text,
  executable content is removed and tracking URLs are never fetched. Attachments
  are not fetched. UTF-8 content is capped at 16 KB and truncation is retained in
  the Context Pack. Partial/unavailable bodies and attachment exclusions are shown.
- `readMetadata` verifies the selected profile and returns provider profile counts.
  Missing counts/dates remain unknown. Source date is Gmail `internalDate`; the
  sender's Date header is separately retained without promoting it to source truth.
- No next page earns exhausted-query coverage; a next page means incomplete.
  `resultSizeEstimate` remains explicitly estimated and never becomes sourceTotal.
  Completeness applies to the query, not all mailbox history or an immutable snapshot;
  ranking completeness is not claimed. Empty/malformed provider responses cannot
  manufacture a zero result.

## Authority and privacy

Each retrieval checks the read flags, Owner/source access, metadata-only credential
revision, token's actual Gmail scopes and `users.getProfile` identity. Gmail write
scopes are rejected even alongside readonly. Scope leases are checked after I/O
and before cached chat results are delivered. Profile/SDK/token objects remain in
closures; only fixed `me` profile, message list and message get methods are exposed.
Administrative retrieval uses a separate grant reader that does not run consent
write probes or expose watch/send methods. The existing service credential ACL is
unchanged; real administrative acceptance runs through the local service account.

Mail answers are transient and marked sourceBound. Saved conversations receive a
neutral receipt, not original text; no mail content enters the general memory
journal or later ordinary model history. Existing source-bound administrative
Memory ingestion/recall remains independent. Audit contains tool, scope/resource,
time, status and count, without query, body, sender, secret or message ID.

The Owner-only page is `/gmail-context`; POST reads use
`/api/v1/live-context/gmail` with same-origin checks and the closed four-operation
contract. The sidebar and architecture checklist include the new flow. Writes,
Ivy/member Live Context, attachments and automatic mail actions are not connected.

## Source references

- [Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
  defines IDs, pagination and estimated counts.
- [Gmail get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
  defines metadata/full formats.
- [Filtering](https://developers.google.com/workspace/gmail/api/guides/filtering)
  requires epoch seconds for accurate non-PST boundaries.
- [Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
  defines read-only and write grants.

Acceptance evidence is stored in the delivery workspace outputs: candidate Owner
reads, new-boot Owner/admin HTTP and chat, browser rendering, full suite and Memory
continuity. No paid model call, source write, forced memory retry or backup is part
of this delivery.
