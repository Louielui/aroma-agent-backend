'use strict'

/**
 * _serviceTokenFixture.js — TEST-ONLY explicit service token (B2-15).
 *
 * This is the ONLY place the former dev-stub literal lives now. Production code
 * has no built-in token (auth.js fails closed when HUB_TOKEN is unset). Tests
 * import this value and inject it EXPLICITLY via createApp({ serviceToken }),
 * so the expected token is always a deliberate test decision — never a hidden
 * fallback baked into the server.
 *
 * NOT a secret: it guards nothing real. It must never be imported by any file
 * under src/ that is not a *.test.js (the production path must stay token-free).
 */

// The historical dev-stub value, retained ONLY so existing tests that hardcoded
// it keep matching without churn. Its meaning is now "an explicit test token".
const TEST_SERVICE_TOKEN = 'svc-token-aroma-os'

module.exports = { TEST_SERVICE_TOKEN }
