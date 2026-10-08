# Investigation cross-scenario acceptance

Scope: Owner-authorized, read-only investigation. These checks do not approve or execute changes.

| Scenario | Expected path | Evidence boundary |
| --- | --- | --- |
| Fresh cost enquiry with one operations source | Fixed source-bound answer can skip the unused main answer call | A sampled model invocation proves a model result and token report, not a provider charge. Billing remains unconfirmed without billing evidence. |
| Fresh failed-development-task enquiry | Fixed answer can skip the unused main answer call only for one unambiguous failed work record | The reason is historical; repair in the loaded version remains unverified without a same-failure regression. |
| Fresh, single-source background inventory | Fixed live-receipt summary can skip unused main answer and semantic-review calls if record identities are unique | Current process observations are dated and bounded, not a complete inventory or proof that every configured job is running. Ambiguous rows, mixed sources and follow-ups retain review. |
| Mixed-source question with a required authorised Gmail, Drive, Calendar or GitHub fact | Read that source-level sample in the same turn and retain main answer and semantic review | The additional source, count and failure state are saved. Only scalar-bound, reviewed supplementary claims may appear. A bounded sample cannot prove global absence. |
| Mixed-source question with an enriching or unauthorised source | Main answer call is retained; no new source read is granted | Fixed operations findings disclose that other named sources are outside their evidence. Goal Gate does not automatically read enriching sources. |
| Follow-up about the same failed record | Fresh authorized read and same-record comparison; no direct-answer skip | A changed status or a different successful run never proves repair of the original failure. |
| Unavailable or ambiguous source | No direct-answer skip | Preserve explicit gaps and avoid substituting an unrelated record. |

The focused tests exercise the production intake path with controlled source and model fixtures, including a failed Gmail read. On the loaded `63bacc6590fe570485a84b18dea3635b54618a93` version, a live Owner background-work enquiry returned in 36,427 ms, saved receipt `46a98f5d-7f59-4c91-84cc-1a3f5ebc1f79`, used eight source references and skipped the main answer call. The earlier same-question run took 109,147 ms. Both are single timed requests, not a representative latency benchmark.

On loaded `34134a7595bc9ea3b09df9bfe4351fa8530a2769`, an explicit local-operations-plus-vendor-email cost question passed the mail-only intent gate in the route test. Separate live Owner source reads confirmed that Gmail, Drive, Calendar and GitHub connectors returned bounded records. The formal combined enquiry stopped before investigation with HTTP 503 because the selected Claude subscription login was unavailable; it produced no saved investigation run. After subscription sign-in, repeat that exact mixed-source enquiry and inspect the answer, source boundaries, evidence grades and saved receipt. Separate connector availability is not same-turn cross-source acceptance.

After Claude subscription sign-in, loaded `7c25952def784da56cd210cf0fafd0ab44fd1719` completed the same mixed-source Owner enquiry in 88,337 ms and saved investigation receipt `72e803a2-c4ea-42c5-8df3-d2e91575cdfd`. Local configuration and schedules were readable; work, history, execution and usage were partial; Gmail was sampled with four records; billing remained unconnected. Claude semantic review accepted one exact-source limitation, withheld five unsupported or invalid-grade claims, and did not assert a charge. This proves the bounded same-turn read and durable receipt, not that vendor email caused a charge. The first answer also incorrectly said other named sources were absent because an unresolved enriching fact had no operation; that presentation guard is corrected in the subsequent source-bound findings change.

Loaded `9be04bf82e2628ee0f2aca9ffe5718465160f193` repeated the enquiry in 111,280 ms, saved receipt `0bfd4fc0-f1c7-49a6-8ed6-b791dcd05692`, and no longer said the sampled Gmail source was absent. Its Gmail read was a recent-items fallback after the question search returned no matches, so the four messages did not establish relevance. The next comparison step records that selection, counts sampled local calls and usage-bearing invocations, and admits only exact request/invocation ID mentions as possible leads. A mail text mention remains untrusted and never proves billing or causation; no match in a bounded sample cannot clear other records. Focused tests cover shared IDs, fallback without IDs, substring false matches, failed reads and the actual Owner intake path.

Loaded `66ffc10f13fdcec79d2711e12c73be1df775095b` passed that exact Owner enquiry in 95,684 ms and saved receipt `2c80b134-aad2-4e11-80ea-f4f2483ed069`. The saved comparison reported four Gmail recent-fallback messages, 24 sampled local bridge invocations, 23 with measured usage, zero shared request/invocation IDs and `billingConfirmed:false`. The answer explicitly described the fallback and sample limit and did not attribute charges. This confirms the comparison is wired into the live read-only path, while provider billing and actual cost attribution remain unconnected.

The subsequent provider-cost mail profile changes only a required, authorised Gmail read in an Owner cost investigation. It searches a fixed AI-provider and billing/credit vocabulary over two years, takes at most four message metadata/snippet rows, and does not replace zero matches with unrelated recent mail. Ordinary Gmail questions retain the general question-keyword query and labelled recency fallback. Search hits are candidates, not authenticated bills or charge proof; a zero-result sample is not global absence. Focused tests cover the query, zero-match behavior, Owner intake routing and comparison selection. Live mailbox relevance must be verified separately.

Loaded `83d21336385b2bb2dec3bc1314fdb5c7e2d6412b` completed the exact mixed-source Owner enquiry in 125,712 ms; saved receipt `115c50e9-18a1-4864-bb09-3c7d04607fdb` recorded four cost-profile Gmail candidates without recency fallback, 24 local invocations (23 with measured usage), no shared ID and `billingConfirmed:false`. One subject said “Aroma Bistro is out of credits”; two other samples were scheduling/product messages. This confirms that the search can retrieve a relevant lead while still producing noisy candidates. The initial live reply reported the sample count and billing gap, but did not call out that subject. A following change surfaces only cost-bearing subjects with message identity/date as possible leads, never as charge proof.

Loaded `53a60ce5b34027837af1756c66a3a3ea4403f4f7` repeated the exact enquiry in 117,494 ms; saved receipt `0033a257-661a-4ed4-8a45-19c96309e0cb` contained four targeted Gmail candidates without fallback and 24 local invocations (23 with measured usage). The saved comparison included the dated “Aroma Bistro is out of credits” message as a `possible` lead with `provesCharge:false`; the Owner reply displayed its subject and message ID while preserving the unconnected billing gap and no-charge-proof wording. The search remains a bounded, partially connected investigation feature, not a billing integration or exhaustive mailbox audit.


## Bounded enriching-source continuation (2026-10-08)

Owner local investigations now execute required reads first, then one continuation
round when the evidence report has gaps or contradictions. The server intersects
the judged plan's enriching Gmail/Drive/Calendar/GitHub sources with the active
provider's existing read permissions. At most two additional sources are read;
already-attempted sources are skipped. No additional planning model call, repeated
source read or automatic retry is introduced. Follow-up keyword misses do not
fall back to unrelated recent entries.

The saved report contains `followupReads` with the trigger, original gap sections,
selected sources, skip reasons and actual outcomes. Required and follow-up evidence
accumulate rather than overwrite each other. Empty searches, unavailable sources,
unauthorised sources and sources omitted by the bound remain distinguishable.
A sample or successful supplementary read does not resolve billing, causality or
same-failure verification gaps by itself. The final answer and archive include the
bounded follow-up receipt. Polling shows the actual source being checked and a
separate zero-match message in Chinese and English.

Validation: 161 targeted tests passed, including cost/mail, failed development/GitHub,
and local email-follow-up/mail failure followed by Drive. Browser tests cover the
real polling UI at desktop Chinese and mobile English widths, zero-match transition,
no page errors and no horizontal overflow. These are controlled connector fixtures,
not proof of live provider access. Live acceptance is recorded separately at delivery.

Scope remains partial: this continuation belongs to Owner local investigations
that include `xiangxiang_operations`; standalone email enquiries retain their
existing route. It does not introduce management actions, an unlimited research
loop, global mailbox coverage, billing integration or same-failure runtime verification.
