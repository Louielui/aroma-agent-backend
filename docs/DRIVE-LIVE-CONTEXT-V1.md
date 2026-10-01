# C3: Owner Drive Live Context

The shared Tool Gateway now serves `drive.company_files` as private Knowledge,
alongside the existing public GitHub Truth lane. The registered company source is
the Aroma Base shared-drive root. No caller can select another credential, source,
drive corpus, URL, fields, query expression or HTTP operation.

## Authority and provenance

The frozen reader exposes identity, metadata, list and bounded text GET reads only.
SDK and OAuth objects remain inside its closure. Each operation requires the
Owner session, source read switches, current registered company grant, unchanged
credential metadata, actual Google Owner identity and a measured read-only Drive
scope. Broader Drive write grants fail closed. This release requests no new scope.

The source lease checks before and after reads and after the Gateway audit. Google
file metadata must prove the registered drive and an ancestor path to its root;
foreign, trashed, missing-parent and cyclic paths are refused. Shortcuts are not
dereferenced and are counted as exclusions. Member/Ivy sessions cannot use this
Owner credential or these routes. Existing member metadata access is preserved.

Each Context Pack includes source IDs/links, retrieval time, original modified
date (unknown remains null), file version, sensitivity, Owner scope, data-only trust
and measured coverage. Audit retains tool/result/count metadata without queries,
file IDs, document titles, credentials or original bodies. Private results have no
shared cache. Rate limits apply backoff without retry loops.

## Four fixed operations

* `list({folderId?})`: root or validated folder, first 25 children.
* `search({query})`: literal, escaped fullText phrase in the fixed drive corpus,
  first 25 matches. Provider pagination and incomplete search remain visible.
* `readMetadata({fileId?})`: source metadata only, with no body download.
* `get({fileId})`: Google Docs text/plain export or original UTF-8 plain text,
  Markdown, CSV or JSON, up to 16,000 bytes. Google must confirm download access
  and a source version; metadata/version/ancestry are rechecked after download.

Text is a projection, not a representation of all document content. Images,
comments and layout are excluded, and document-tab coverage is unverified. A
complete projection does not establish complete document coverage. Prefixes and
unsupported formats are labelled. PDFs, Sheets, Slides, binaries, shortcuts,
revision history, complete indexing and departmental Live Context are pending.

## Owner workflow and acceptance

`/drive-context` is linked from the sidebar, architecture and GitHub progress page.
Page opening performs no source read. Owner can browse folders, search keywords,
read supported text and open originals. Failed reads clear previous private output.
Chat commands `list company files` and `search company files: <keywords>` (and their
Traditional Chinese equivalents) return measured metadata with citations. This
workflow performs zero model/worker calls and does not send document bodies to a
model or index them. Existing conversation capture still applies to chat replies.

Candidate source acceptance on 2026-10-01 read 17 root children, seven SOP search
results, source metadata and 927 bytes of an actual Google Docs export. The Owner
identity, readonly scope, source version, scoped Knowledge output and body-free
audit passed. Local proof: `outputs/drive-context-candidate-source-proof.json` in
the development workspace. Loaded HTTP/UI/architecture acceptance and exact
bootCommit must be verified separately after delivery.

Official API references: [list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
[get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get),
[export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export),
[scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[document tabs](https://developers.google.com/workspace/docs/api/how-tos/tabs).

Next sources remain Aroma System, Calendar and Gmail. Existing mail memory and
background completion are preserved; C3 does not declare memory acceptance complete.
