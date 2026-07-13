'use strict'

/**
 * projectionEndpoint.js — Phase 2 Gate 1 (MCP connector). The read-only projection
 * CORE that ties together classification, safe summary, opaque result-id minting,
 * and the append-only audit contract. Transport-agnostic: `project(ctx)` is the
 * unit-testable core; the app.js route registration + startup fail-fast + the real
 * durable audit writer land in a later slice (time-sequence A).
 *
 * Fail-closed ordering:
 *   1. identity + binding-context gate (BACKEND_READ_IDENTITY) → else READ_IDENTITY_DENIED, no data.
 *   2. read-only source via buildReturnReadyList (synthetic in tests).
 *   3. per item: classify → non-SAFE (UNCLASSIFIED/SENSITIVE) → SUPPRESS entirely
 *      (absent from output, counted, no existence/status/id) + durable SUPPRESSION audit;
 *      SAFE → buildSafeSummary → not ok → SUPPRESS likewise; ok → mint connectorResultId, store binding.
 *   4. BEFORE returning: durable ACCESS_AUDIT per staged item.
 *   5. any audit append failure (AuditUnavailableError) anywhere → whole response DENIED
 *      (AUDIT_UNAVAILABLE), never partial data.
 *
 * Fixed top-level codes: OK · READ_IDENTITY_DENIED · AUDIT_UNAVAILABLE · SOURCE_ERROR.
 */

const crypto = require('node:crypto')
const { classify, CLASSIFICATION_POLICY_VERSION } = require('./classificationPolicy')
const { buildSafeSummary } = require('./connectorSafeSummary')
const { mint } = require('./connectorResultId')
const { AuditUnavailableError } = require('./auditSink')

const CODES = {
  OK: 'OK',
  READ_IDENTITY_DENIED: 'READ_IDENTITY_DENIED',
  AUDIT_UNAVAILABLE: 'AUDIT_UNAVAILABLE',
  SOURCE_ERROR: 'SOURCE_ERROR' // fail-closed for an unexpected source read failure (no data)
}

const isNonEmpty = (s) => typeof s === 'string' && s !== ''

/**
 * @param {{ buildReturnReadyList: function, artifactStore?, proposalStore?, auditSink,
 *   resultIdStore, readBackendReadIdentity: ()=>string|null, egressPolicyVersion?: string,
 *   classificationPolicyVersion?: string, now?: ()=>number, rng?: (n:number)=>Buffer,
 *   backendAuditIdentity?: string }} deps
 * @returns {{ project: function, CODES: object }}
 */
function createProjectionEndpoint (deps = {}) {
  const {
    buildReturnReadyList, artifactStore, proposalStore,
    auditSink, resultIdStore, readBackendReadIdentity,
    egressPolicyVersion = 'egr-1',
    classificationPolicyVersion = CLASSIFICATION_POLICY_VERSION,
    now, rng, backendAuditIdentity = 'backend_audit_writer'
  } = deps

  if (typeof buildReturnReadyList !== 'function') throw new TypeError('createProjectionEndpoint requires buildReturnReadyList')
  if (!auditSink || typeof auditSink.append !== 'function') throw new TypeError('createProjectionEndpoint requires auditSink.append')
  if (!resultIdStore || typeof resultIdStore.set !== 'function') throw new TypeError('createProjectionEndpoint requires resultIdStore.set')
  if (typeof readBackendReadIdentity !== 'function') throw new TypeError('createProjectionEndpoint requires readBackendReadIdentity')

  const clockNow = typeof now === 'function' ? now : () => Date.now()
  const random = typeof rng === 'function' ? rng : (n) => crypto.randomBytes(n)
  const newCorrelationId = () => 'corr_' + Buffer.from(random(9)).toString('base64url')

  /**
   * @param {{ presentedReadIdentity, principal, app, window, filters?, correlationId? }} ctx
   * @returns {{ ok: boolean, code: string, items?: Array<{connectorResultId,summary}>, suppressedCount?: number }}
   */
  function project (ctx = {}) {
    const correlationId = isNonEmpty(ctx.correlationId) ? ctx.correlationId : newCorrelationId()
    const bestEffortAudit = (entry) => { try { auditSink.append(entry) } catch (_) { /* denial path returns no data regardless */ } }

    // 1. identity + binding-context gate (fail-closed). The read identity AND the
    //    mint-binding context (principal/app/window) must all be present & correct.
    const expected = readBackendReadIdentity()
    if (!isNonEmpty(expected) || ctx.presentedReadIdentity !== expected ||
        !isNonEmpty(ctx.principal) || !isNonEmpty(ctx.app) || !isNonEmpty(ctx.window)) {
      bestEffortAudit({
        authenticatedIdentity: backendAuditIdentity, eventType: 'ERROR', correlationId,
        principal: isNonEmpty(ctx.principal) ? ctx.principal : null, app: isNonEmpty(ctx.app) ? ctx.app : null,
        outcome: 'DENY', detail: { reason: 'read identity or binding context denied' }
      })
      return { ok: false, code: CODES.READ_IDENTITY_DENIED }
    }

    // 2. read-only source
    let source
    try { source = buildReturnReadyList({ artifactStore, proposalStore, filters: ctx.filters }) } catch (_) { return { ok: false, code: CODES.SOURCE_ERROR } }
    const items = source && Array.isArray(source.items) ? source.items : []

    const staged = []
    let suppressedCount = 0
    try {
      for (const item of items) {
        const cls = classify(item)
        if (cls.classification !== 'SAFE_NON_SENSITIVE') {
          suppressedCount++
          auditSink.append({ authenticatedIdentity: backendAuditIdentity, eventType: 'SUPPRESSION', correlationId, principal: ctx.principal, app: ctx.app, outcome: 'SUPPRESSED', detail: { reason: cls.classification } })
          continue
        }
        const sum = buildSafeSummary(item, { allowedFields: cls.allowedFields })
        if (!sum.ok) {
          suppressedCount++
          auditSink.append({ authenticatedIdentity: backendAuditIdentity, eventType: 'SUPPRESSION', correlationId, principal: ctx.principal, app: ctx.app, outcome: 'SUPPRESSED', detail: { reason: 'summary_' + sum.code } })
          continue
        }
        const { id, record } = mint({ principal: ctx.principal, app: ctx.app, window: ctx.window, egressPolicyVersion, classificationPolicyVersion, now: clockNow(), rng: random })
        resultIdStore.set(id, record)
        staged.push({ connectorResultId: id, summary: sum.summary })
      }

      // 4. durable ACCESS_AUDIT BEFORE any data leaves
      for (const s of staged) {
        auditSink.append({ authenticatedIdentity: backendAuditIdentity, eventType: 'ACCESS_AUDIT', correlationId, principal: ctx.principal, app: ctx.app, outcome: 'ALLOW', detail: { connectorResultId: s.connectorResultId } })
      }
    } catch (e) {
      // 5. any audit failure → whole response DENIED, never partial data.
      if (e instanceof AuditUnavailableError) return { ok: false, code: CODES.AUDIT_UNAVAILABLE }
      return { ok: false, code: CODES.SOURCE_ERROR }
    }

    return { ok: true, code: CODES.OK, items: staged, suppressedCount }
  }

  return { project, CODES }
}

module.exports = { createProjectionEndpoint, CODES }
