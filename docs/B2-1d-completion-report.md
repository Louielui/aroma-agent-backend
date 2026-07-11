# B2-1d — Result Read Endpoint — Completion Report

**Feature:** Read-only retrieval of a confirmed proposal's execution result, shaped for a future frontend.
**Branch:** `feature/b2-1-worker-invocation` (continues on the B2-1 slice)
**Head:** `37d7071`
**Built on:** B2-1 MVP, frozen at `9ac3325`.
**Status:** Complete. Default suite green, worker invocation / paid E2E / governance untouched.

---

## 1. Objective

Give Aroma the smallest **safe, read-only** path to retrieve a completed Execution's result,
structured for a future frontend to display — sourced entirely from the **existing Artifact Store**,
with no new competing store, no worker invocation, no paid model calls, and no governance change.

---

## 2. Delivery (2 commits)

| SHA | Summary |
|---|---|
| `d167045` | Read model — allowlist projection + robust, malformed-safe finders (+ 6 unit tests) |
| `37d7071` | `GET /proposals/:id/result` endpoint wiring, additive (+ 7 HTTP tests) |

### Files
- **New:** `src/api/executionResultView.js`, `src/api/executionResultView.test.js`,
  `src/api/executionResults.http.test.js`.
- **Changed (additive only):** `src/app.js` — share one artifact store between the write-trigger
  and the read endpoint; add the route in `createAromaRouter`.
- **Frozen — 0 changed lines (git-verified):** `src/workers/claudeWorker.js`,
  `src/workers/runWorkerInBackground.js`, `src/workers/claudeWorker.e2e.test.js`,
  `src/coo/proposal.js`, `src/run/store.js`, `src/store/artifactStore.js`.

---

## 3. Endpoint

```
GET /proposals/:proposalId/result
```

- **Read-only, no service token** — consistent with the existing open read routes
  (`GET /proposals`, `GET /runs`). See §7 boundary note.
- **Keyed by proposalId** — the id the frontend already holds (it confirmed the proposal). The
  internal `taskId`/`resultId` are never required from the caller.
- **Source of truth** — the existing `.aroma/tasks` (Execution) + `.aroma/results` (Result)
  artifacts, plus the live Proposal when available. No data is duplicated into a new store.

### Response contract (allowlist projection)

```json
{
  "proposalId": "...",
  "executionId": "task_..." | null,
  "status": "pending" | "running" | "succeeded" | "failed",
  "ok": true | false | null,
  "worker": "claude",
  "provider": "anthropic-claude",
  "startedAt": "<execution.createdAt>" | null,
  "finishedAt": "<result.createdAt>" | null,
  "elapsedMs": <int> | null,
  "exitCode": <int> | null,
  "resultSummary": "<worker output text>" | null,
  "cost": <number> | null,
  "error": "<message>" | null,
  "relay": { "toUser": 0, "fromUser": 0, "manual": 0 },
  "proposal": { "id": "...", "status": "confirmed", "confirmedBy": "...", "confirmedAt": "..." }
}
```

**Excluded by construction (never returned):** the prompt (`task`), sandbox filesystem paths (on
both records), and any other artifact field not named above.

### Error / status model

| Situation | Response |
|---|---|
| Malformed / traversal id | **400** — validated *before* the store is touched |
| Unknown proposalId (no execution and no live proposal) | **404** |
| Proposal exists, no execution yet | **200** `status: pending` |
| Execution exists, no result yet | **200** `status: running` |
| Completed | **200** `status: succeeded` / `failed` |
| A matching artifact is unreadable/corrupt | **500** controlled, generic message (no path/internals) |

---

## 4. Safety properties

### Allowlist projection (not denylist)
`buildResultView` constructs the response from an **explicit set of named fields**; the raw artifact
is never spread and keys are never deleted. A future field added to an artifact (another prompt,
another path) therefore **cannot leak**. Proven by a poisoned-artifact unit test: artifacts carrying
`task`/`sandbox`/`secret`/`apiKey` sentinels produce a response containing none of them, with keys
exactly the 15 allowlisted.

### Traversal / arbitrary-path impossible
- `proposalId` is validated against `^[A-Za-z0-9_-]{1,64}$` → else **400**, before any store access.
- The artifact store never joins an id into a path — it matches by
  `readdir().endsWith('-<id>.json')` — so even a traversal id cannot escape. Defense-in-depth: a
  "landmine" store (throws on any access) is never reached for an invalid id (test-proven).

### Robust reads
Finders scan a kind directory and parse each file defensively; a malformed file is counted, never
thrown. If the answer could only be in a malformed file, the caller returns a **controlled 500** with
a generic, path-free message — never a crash, never a leak.

### No paid call
The endpoint performs zero worker invocation. Tests inject a runner that throws if ever run; reads
never touch it.

---

## 5. Traceability preserved

```
GET /proposals/:proposalId/result
  proposalId → Execution Artifact (durable, .aroma/tasks)
                 └─ taskId → Result Artifact (.aroma/results)
  proposalId → Proposal (live, in-memory)      [confirmation provenance]
```

Provenance (`confirmedBy` / `confirmedAt` / `status`) prefers the **live Proposal**; when the
in-memory proposal has been cleared (e.g. after a restart) it falls back to the durable
**Execution snapshot** (`execution.approval`), so provenance survives a restart. Tests assert the
returned `confirmedBy`/`confirmedAt` equal the real linked proposal's values.

---

## 6. Tests

- **View unit (`executionResultView.test.js`, 6):** id validation (traversal), **allowlist poison
  proof**, status distinctions, elapsed + provenance fallback, live-proposal precedence, robust
  malformed scanning.
- **HTTP (`executionResults.http.test.js`, 7):** success + full chain + real `confirmedBy/At` +
  no-leak; failed result readable; unknown → 404; pending/running; missing result file safe;
  malformed → controlled 500 (no path leak); traversal/malformed id → 400 with the store never
  touched.
- **Whole repo:** 168 pass · 1 skipped (the paid E2E, still gated) · 0 fail.

---

## 7. Recorded boundaries & decisions

1. **`worker` / `provider` are Config-layer static labels.** This MVP registers a single worker as
   claude; the returned `"claude"` / `"anthropic-claude"` are configuration values, **not**
   runtime-queried — the Config/Runtime split is not violated.
2. **Open-read boundary.** The result endpoint is open-read, consistent with existing read routes.
   Result data (exit code, cost, error) is more sensitive than a proposal, so **token-gating is a
   separate future decision** if these results ever carry sensitive info.

---

## 8. Known, accepted behaviours (design, not defects)

1. **1:1 assumption.** One confirm → one execution → one result; the finders return the first match.
   Multiple executions per proposal (retries) would need a disambiguator — future.
2. **Conservative malformed handling.** Any unreadable *result* file makes a not-yet-found lookup
   return **500** rather than a possibly-misleading `running`. Safe, but one corrupt file affects
   pending reads until cleaned.

---

## 9. Rollback

Pure additive read path. Revert the two commits (`37d7071`, `d167045`) — nothing else changes; no
data migration. The endpoint reads existing artifacts only, so removing it leaves the write side
(B2-1) fully intact.

---

## 10. Out of scope (unchanged)

No frontend, no containment/policy, no worker invocation change, no governance change, no auth
addition, no result list/index endpoint, no `.aroma/` retention policy. `main` / `aroma-system`
untouched; nothing pushed.
