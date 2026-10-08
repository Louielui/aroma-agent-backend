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

The focused tests exercise the production intake path with controlled source and model fixtures, including a failed Gmail read. On the loaded `63bacc6590fe570485a84b18dea3635b54618a93` version, a live Owner background-work enquiry returned in 36,427 ms, saved receipt `46a98f5d-7f59-4c91-84cc-1a3f5ebc1f79`, used eight source references and skipped the main answer call. The earlier same-question run took 109,147 ms. Both are single timed requests, not a representative latency benchmark. The additional Gmail, Drive, Calendar and GitHub paths remain fixture-tested rather than live connector-verified.
