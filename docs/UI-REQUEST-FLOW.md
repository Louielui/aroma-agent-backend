# Navigation request flow

The Owner's request `我想把頂端的功能由右上搬到左上` previously missed the
local development dialogue. It entered ordinary chat, which described an
unregistered proposal as awaiting approval. A follow-up could then ask for a file
path rather than prepare the discussed change.

The host now recognizes everyday navigation nouns in Chinese, English and mixed
requests, while the subscription model interprets intent. A clear requested UI
change creates a source-backed plan with the existing confirmation card. A first
request never authorizes coding. Confirmation of the completed, unchanged plan
uses the existing sealed, single-use development chain.

An unregistered discussion may resume from the immediately preceding user and
assistant turns in the server transcript. Recovery supplies planning context only;
it excludes existing jobs and stale sealed contexts. Assistant prose cannot approve
execution. Refinements to a completed plan regenerate the plan before development.

The fixed editable profiles, Owner identity, plan hash, current source verification,
review gates and separate adoption approval remain in force. This does not connect
arbitrary projects or guarantee universal language understanding.

`requestFlow.test.js` exercises the exact failed request, initial requirements,
legacy discussion recovery and refusal boundaries. `confirmedExecution.test.js`
uses the real HTTP router, planner, registry and development services with controlled
providers to verify one confirmed chain and no execution before confirmation.
Actual subscription acceptance and runtime version evidence are recorded separately
in the local delivery checkpoint.
