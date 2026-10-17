# U2-B: bounded grounded result synthesis (offline opt-in)

Baseline U2-A: `70b41c5abb02a989cef8733b59e2230e10a26df3`, tree
`9ff6b1397f839a37a6c6c0e9c571588029b77518`. U2-A is OFFLINE ACCEPTED;
production remains unchanged and BLOCKED. All previous U1/Option B historical
UNKNOWN / NOT PASS evidence and deferred acceptance states are preserved.

## Reused integration

`createSelectionTaskRunner` accepts host-only `synthesizeResults:true`; the default
remains the exact U2-A selection/read behavior. U1 Task/Goal/attempt identity,
consent, Context Services, Tool Gateway, validators, Run Timeline and source
leases are unchanged. There is no new route, registry, planner, memory or worker.

After the existing selector and authorized reads, one bounded synthesis stage
drafts at most six atomic natural-language statements. It reuses
`investigation/semanticAnswer`'s scalar reference catalog, closed claim schema,
exact binding and one semantic-review call. The stage therefore makes at most
two model calls (draft + verification); neither can request another read or
replan. Selection is still the existing single model call. The reviewer is a
separate invocation, not an independent model or a mathematical entailment proof.
Actual independent code review remains Claude Sonnet 5.5.

Provider access requires existing selection sharing plus a distinct trusted-host
`synthesisSharing:true` decision for sending retrieved business content. The
same principal, surface, conversation, source revision, cancellation and leases
are checked before and after both model calls and before rendering. Native or
browser credentials cannot supply this host state. No production host binding is
mounted; subscription inference is restricted to synthetic disposable fixtures.

## Evidence and epistemic rules

Packs are bounded BEFORE sharing with the synthesis model. Packs over 36,000
serialized bytes become explicit receipts and cannot support business facts.
Metadata-only reads, missing/long content, unavailable reads and unattempted
reads do not become source content. There is no silent text-prefix truncation.
The existing catalog limits six rows per source and 320 characters per scalar;
an additional 12,000-byte report budget preserves native frame headroom.
Omissions are explicit, with source completeness distinct from presentation loss.

Only the exact projected catalog can support a statement. Server-owned `S1/r1`
references map to original source IDs, original pack hashes, retrieval time,
scope, coverage and values in task evidence. Exact referenced values and numbers
are checked by the existing binder; unsupported/contradicted/uncertain wording
is withheld by the existing semantic reviewer. Verified binding proves what the
source returned, not the truth of the source or the semantic correctness of a
model paraphrase. The final answer discloses this limit.

Source observations, unestablished interpretation/recommendation, missing
information and partial coverage are visibly distinguished. All record claims
are retrieval-snapshot observations (supported/historical), never live guarantees.
Conflicts must cite both sides and cannot be silently reconciled. Documents are
untrusted data, never instructions or approval. Unsupported numbers, names,
records, meetings, transactions and goal-completion claims are not authorized.
Both original-source coverage and catalog omissions remain in persisted evidence.

Model/format/review failures provide an explicit no-supported-answer response,
without presenting the draft. Authentication, lease, cancellation or durable
audit failure aborts the attempt; no source content or answer is released after
revocation. There are no automatic retries or fallback providers. Completed
attempts and successful synthesis leave `goalCompleted:false`.

## Demonstration and acceptance

`node scripts/u2/synthesis-demo.cjs <fresh-directory> <absolute-codex-executable>`
runs the real subscription model with tools, hooks, MCP, apps and memory disabled,
credits forbidden, and isolated data/artifact roots. Existing synthetic adapters
exercise actual Context Services and gateways. The nine cases cover A-H,
including separate partial and unavailable cases. Expectations exist only in
the evaluator. No semantic failure is retried within a run.

Structural checks are not product acceptance: inspect the actual Owner answers,
the exact scalar citations, the conflict and payment-unknown conclusions, and
the withheld content. An independent Claude review must receive both source code
and the actual per-case answers/evidence. Contract tests use simulated model
responses and are explicitly not proof of semantic quality.

Remaining limits: a small synthetic evaluation is not general semantic reliability;
the model reviewer can be wrong or correlated with the draft; long/large content
is deliberately omitted; unsupported calculations and broader multi-step goals
are outside this slice. Real host authorization, source reachability and safe
production migration require separate approval. No U3 autonomy, live actions,
Gmail send, Calendar writes, background automation or Option B changes are added.
