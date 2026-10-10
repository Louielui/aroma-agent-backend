'use strict'
const { makeContextResult } = require('../contextResult')
const SOURCE = 'seven_shifts', API = 'https://api.7shifts.com/v2', MAX_PAGES = 3, PAGE_SIZE = 100
const ID = n => Number.isSafeInteger(n) && n > 0
const instant = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) return false
  // Date.parse normalises impossible dates such as February 30; reject them.
  const local = new Date(s.replace(/(?:Z|[+-]\d{2}:\d{2})$/, 'Z'))
  return local.toISOString().slice(0,19) === s.slice(0,19)
}
function validateQuery (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['timeMin','timeMax','userId','locationId'].includes(k)) ||
      !instant(input.timeMin) || !instant(input.timeMax) || Date.parse(input.timeMax) <= Date.parse(input.timeMin) || Date.parse(input.timeMax) - Date.parse(input.timeMin) > 31 * 86400000 ||
      ['userId','locationId'].some(k => Object.hasOwn(input,k) && !ID(input[k]))) throw Error('invalid_request')
  return {timeMin:new Date(input.timeMin).toISOString(),timeMax:new Date(input.timeMax).toISOString(),
    ...(input.userId ? {userId:input.userId} : {}),...(input.locationId ? {locationId:input.locationId} : {})}
}
// One fixed company and GET-only endpoint; tokens never enter source packages,
// prompts, context rows, logs or development jobs. A registered module is not
// evidence that a connection or permission has been granted.
function createSevenShiftsReadAdapter ({env = process.env, fetchFn, clock = () => new Date().toISOString()} = {}) {
  const companyId = Number(env.SEVEN_SHIFTS_COMPANY_ID), token = env.SEVEN_SHIFTS_ACCESS_TOKEN
  const verify = () => {
    if (env.READ_ACCESS !== 'on' || env.CONTEXT_SEVEN_SHIFTS !== 'on') throw Error('read_access_disabled')
    if (!ID(companyId) || typeof token !== 'string' || !token.trim()) throw Error('connection_not_configured')
    if (Number(env.SEVEN_SHIFTS_COMPANY_ID) !== companyId || env.SEVEN_SHIFTS_ACCESS_TOKEN !== token) throw Error('source_access_changed')
    if (!fetchFn && process.env.NODE_TEST_CONTEXT) throw Error('live_transport_not_allowed_in_tests')
  }
  async function listTimePunches (input) {
    const retrievedAt = clock(), query = validateQuery(input)
    try {
      verify()
      const rows = [], ids = new Set(), cursors = new Set(), transport = fetchFn || globalThis.fetch
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
      let cursor = null, complete = false, pages = 0
      try {
        for (; pages < MAX_PAGES;) {
          verify()
          const url = new URL(API + '/company/' + companyId + '/time_punches')
          url.searchParams.set('clocked_in[gte]',query.timeMin); url.searchParams.set('clocked_in[lte]',query.timeMax)
          url.searchParams.set('limit',String(PAGE_SIZE)); url.searchParams.set('deleted','false')
          if (query.userId) url.searchParams.set('user_id',String(query.userId))
          if (query.locationId) url.searchParams.set('location_id',String(query.locationId))
          if (cursor) url.searchParams.set('cursor',cursor)
          const response = await transport(url.href,{method:'GET',redirect:'error',signal:controller.signal,
            headers:{Authorization:'Bearer ' + token,accept:'application/json','x-api-version':'2025-03-01'}})
          verify()
          if (!response?.ok) throw Error([401,403].includes(response?.status) ? 'source_not_authorised' : response?.status === 429 ? 'source_rate_limited' : 'source_unavailable')
          const value = await response.json(); verify(); pages++
          if (!value || !Array.isArray(value.data) || value.data.length > PAGE_SIZE || value.object && value.object !== 'time_punches') throw Error('invalid_source_response')
          for (const p of value.data) {
            if (!p || p.company_id !== companyId || !ID(p.id) || !ID(p.user_id) || !instant(p.clocked_in) ||
                p.clocked_out !== null && !instant(p.clocked_out) || p.deleted === true || ids.has(p.id) ||
                Date.parse(p.clocked_in) < Date.parse(query.timeMin) || Date.parse(p.clocked_in) > Date.parse(query.timeMax) ||
                query.userId && p.user_id !== query.userId || query.locationId && p.location_id !== query.locationId) throw Error('invalid_source_response')
            ids.add(p.id)
            const fields = {companyId,userId:p.user_id,punchId:p.id,clockedIn:p.clocked_in,clockedOut:p.clocked_out,
              approved:typeof p.approved === 'boolean' ? p.approved : null,autoClockedOut:typeof p.auto_clocked_out === 'boolean' ? p.auto_clocked_out : null,
              locationId:ID(p.location_id) ? p.location_id : null}
            rows.push(makeContextResult({source:SOURCE,sourceId:companyId + ':' + p.id,title:'7shifts employee ' + p.user_id,
              entityType:'time_punch',retrievedAt,originalDate:instant(p.modified) ? p.modified : p.clocked_in,fields,
              content:JSON.stringify(fields),link:'https://app.7shifts.com/'}))
          }
          const next = value.meta?.cursor?.next
          if (next === null) { complete = true; break }
          if (next === undefined) break // Missing pagination proof is unknown, never complete.
          if (typeof next !== 'string' || !next || next.length > 2000 || /[\x00-\x1f]/.test(next) || cursors.has(next)) throw Error('invalid_source_response')
          cursors.add(next); cursor = next
        }
      } finally { clearTimeout(timer) }
      return {results:rows,evidence:{source:SOURCE,trust:'live',entityType:'time_punch',retrievedAt,completeness:complete ? 'complete' : 'partial',completeWithinScope:complete,queryScope:{companyId,field:'clocked_in',window:query.timeMin + '..' + query.timeMax,filters:query,selection:'clocked_in_inclusive_utc'},
        returnedRows:rows.length,matchingTotal:complete ? rows.length : null,sourceTotal:null,truncated:pages === MAX_PAGES && !complete,
        provenance:{source:SOURCE,endpoint:'GET /v2/company/{company_id}/time_punches',apiVersion:'2025-03-01',pages,readOnly:true}}}
    } catch (e) {
      const safe = ['read_access_disabled','connection_not_configured','source_access_changed','source_not_authorised','source_rate_limited','invalid_source_response','live_transport_not_allowed_in_tests']
      // Follow the shared connector's throw contract; it supplies the unavailable
      // envelope. Only allowlisted error codes can cross this boundary.
      throw Error(safe.includes(e.message) ? e.message : 'source_unavailable')
    }
  }
  return {source:SOURCE,methods:{listTimePunches},rowLimits:{listTimePunches:null},readTimeoutMs:9000}
}
module.exports = {SOURCE,MAX_PAGES,PAGE_SIZE,validateQuery,createSevenShiftsReadAdapter}
