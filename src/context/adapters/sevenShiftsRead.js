'use strict'
const { makeContextResult } = require('../contextResult')
const SOURCE = 'seven_shifts', API = 'https://api.7shifts.com/v2', MAX_PAGES = 3, PAGE_SIZE = 100
const MAX_NAME_LOOKUPS = 50, NAME_TIMEOUT_MS = 1000, CLOCK_OUT_TIMEOUT_MS = 8000
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
function validateClockOutQuery (input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request')
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) throw Error('invalid_request')
    const keys = Reflect.ownKeys(input)
    if (keys.length !== 2 || keys.some(k => k !== 'timeMin' && k !== 'timeMax') ||
        !Object.hasOwn(input,'timeMin') || !Object.hasOwn(input,'timeMax')) throw Error('invalid_request')
    const {timeMin,timeMax} = input
    if (!instant(timeMin) || !instant(timeMax)) throw Error('invalid_request')
    const min = Date.parse(timeMin), max = Date.parse(timeMax)
    if (max <= min || max - min > 31 * 86400000) throw Error('invalid_request')
    return {timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString()}
  } catch (_) {
    throw Error('invalid_request')
  }
}
function cleanEmployeeNamePart (value) {
  if (typeof value !== 'string' || value.length > 200) return ''
  return value.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim()
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
  const listClockOuts = input => listNamedPunches(input, true)
  const listAttendance = input => listNamedPunches(input, false)
  const listShifts = input => listNamedPunches(input, false, true)
  async function listNamedPunches (input, clockOuts, shifts = false) {
    const query = validateClockOutQuery(input)
    let controller, timer, accessTimer
    try {
      const retrievedAt = clock()
      verify()
      const transport = fetchFn || globalThis.fetch
      const punches = [], ids = new Set(), cursors = new Set(), names = new Map()
      const min = Date.parse(query.timeMin), max = Date.parse(query.timeMax)
      const deadline = Date.now() + CLOCK_OUT_TIMEOUT_MS
      controller = new AbortController()
      let stopCode = null, cursor = null, complete = false, pages = 0
      const stop = code => {
        if (!controller.signal.aborted) {
          stopCode = code
          controller.abort()
        }
      }
      const check = () => {
        verify()
        if (stopCode && stopCode !== 'source_unavailable') throw Error(stopCode)
      }
      timer = setTimeout(() => stop('source_unavailable'),CLOCK_OUT_TIMEOUT_MS)
      // Detect revoked access even when a transport ignores its abort signal.
      accessTimer = setInterval(() => {
        try { verify() } catch (e) { stop(e.message) }
      },50)

      async function request (url, nameLookup) {
        check()
        if (controller.signal.aborted || Date.now() >= deadline) throw Error(stopCode || 'source_unavailable')
        const requestController = new AbortController()
        const onReadAbort = () => requestController.abort()
        controller.signal.addEventListener('abort',onReadAbort,{once:true})
        let onRequestAbort, nameTimer
        const aborted = new Promise((resolve,reject) => {
          onRequestAbort = () => reject(Error(stopCode || 'source_unavailable'))
          requestController.signal.addEventListener('abort',onRequestAbort,{once:true})
        })
        if (nameLookup) {
          nameTimer = setTimeout(() => requestController.abort(),Math.min(NAME_TIMEOUT_MS,Math.max(1,deadline - Date.now())))
        }
        const operation = async () => {
          const response = await transport(url.href,{method:'GET',redirect:'error',signal:requestController.signal,
            headers:{Authorization:'Bearer ' + token,accept:'application/json','x-api-version':shifts ? '2026-01-01' : '2025-03-01'}})
          check()
          if (requestController.signal.aborted) throw Error(stopCode || 'source_unavailable')
          if ([401,403].includes(response?.status)) throw Error('source_not_authorised')
          if (!response?.ok) {
            if (nameLookup) return null
            throw Error(response?.status === 429 ? 'source_rate_limited' : 'source_unavailable')
          }
          const value = await response.json()
          check()
          return value
        }
        try {
          // Race the whole fetch-and-JSON operation, not just an abort-aware fetch.
          const value = await Promise.race([operation(),aborted])
          check()
          if (requestController.signal.aborted || Date.now() >= deadline) throw Error(stopCode || 'source_unavailable')
          return value
        } catch (e) {
          check()
          throw e
        } finally {
          clearTimeout(nameTimer)
          controller.signal.removeEventListener('abort',onReadAbort)
          requestController.signal.removeEventListener('abort',onRequestAbort)
          requestController.abort()
        }
      }

      // Establish punch validity and pagination proof before optional enrichment.
      for (; pages < MAX_PAGES;) {
        check()
        const url = new URL(API + '/company/' + companyId + (shifts ? '/shifts' : '/time_punches'))
        const field = shifts ? 'start' : clockOuts ? 'clocked_out' : 'clocked_in'
        url.searchParams.set(field + '[gte]',query.timeMin); url.searchParams.set(field + '[lte]',query.timeMax)
        url.searchParams.set('limit',String(PAGE_SIZE)); url.searchParams.set('deleted','false')
        if (shifts) { url.searchParams.set('draft','false'); url.searchParams.set('consider_tz_in_ranges','true') }
        if (cursor) url.searchParams.set('cursor',cursor)
        const value = await request(url,false)
        check(); pages++
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.data) ||
            value.data.length > PAGE_SIZE || value.object && value.object !== (shifts ? 'shifts' : 'time_punches')) throw Error('invalid_source_response')
        for (const p of value.data) {
          if (shifts) {
            if (!p || typeof p !== 'object' || Array.isArray(p) || p.company_id !== companyId || !ID(p.id) || ids.has(p.id) ||
                !(ID(p.user_id) || p.user_id === null && (p.unassigned === true || p.open === true)) || !ID(p.location_id) ||
                !instant(p.start) || !instant(p.end) || Date.parse(p.end) <= Date.parse(p.start) ||
                Date.parse(p.start) < min || Date.parse(p.start) > max || p.draft !== false || p.deleted !== false || p.publish_status !== 'published') throw Error('invalid_source_response')
            ids.add(p.id)
            punches.push({companyId,userId:p.user_id,shiftId:p.id,locationId:p.location_id,start:p.start,end:p.end,
              unassigned:p.unassigned === true || p.open === true,published:true})
            continue
          }
          if (!p || typeof p !== 'object' || Array.isArray(p) || p.company_id !== companyId ||
              !ID(p.id) || !ID(p.user_id) || !instant(p.clocked_in) ||
              (clockOuts || p.clocked_out !== null) && !instant(p.clocked_out) ||
              p.deleted === true || ids.has(p.id) || Date.parse(p[field]) < min || Date.parse(p[field]) > max ||
              p.clocked_out !== null && Date.parse(p.clocked_out) < Date.parse(p.clocked_in) ||
              p.clocked_out === null && p.auto_clocked_out === true ||
              p.shift_id != null && !ID(p.shift_id) || p.location_id != null && !ID(p.location_id)) throw Error('invalid_source_response')
          ids.add(p.id)
          // Snapshot only the approved punch fields; never retain user profiles.
          punches.push({companyId,userId:p.user_id,punchId:p.id,clockedIn:p.clocked_in,clockedOut:p.clocked_out,
            shiftId:p.shift_id ?? null,locationId:p.location_id ?? null,
            approved:typeof p.approved === 'boolean' ? p.approved : null,
            autoClockedOut:typeof p.auto_clocked_out === 'boolean' ? p.auto_clocked_out : null})
        }
        const next = value.meta?.cursor?.next
        if (next === null) { complete = true; break }
        if (next === undefined) break
        if (typeof next !== 'string' || !next || next.length > 2000 || /[\x00-\x20\x7f]/.test(next) || cursors.has(next)) throw Error('invalid_source_response')
        cursors.add(next); cursor = next
      }

      const fatalNameErrors = ['read_access_disabled','connection_not_configured','source_access_changed','source_not_authorised','live_transport_not_allowed_in_tests']
      for (const p of punches) {
        check()
        if (p.userId === null) continue
        if (names.has(p.userId)) continue
        const name = {employeeName:null,nameState:'unavailable'}
        names.set(p.userId,name)
        if (names.size > MAX_NAME_LOOKUPS || controller.signal.aborted || Date.now() >= deadline) continue
        try {
          const url = new URL(API + '/company/' + companyId + '/users/' + p.userId)
          const value = await request(url,true)
          check()
          const user = value?.data
          if (!user || typeof user !== 'object' || Array.isArray(user) || user.id !== p.userId || user.company_id !== companyId) continue
          const employeeName = [cleanEmployeeNamePart(user.first_name),cleanEmployeeNamePart(user.last_name)].filter(Boolean).join(' ')
          if (employeeName && !employeeName.includes(token)) {
            name.employeeName = employeeName
            name.nameState = 'confirmed'
          }
        } catch (e) {
          check()
          if (fatalNameErrors.includes(e?.message)) throw e
          // Optional names may be unavailable; verified punches remain intact.
        }
      }
      check()
      const rows = punches.map(p => {
        const name = names.get(p.userId) || {employeeName:null,nameState:'unavailable'}
        const fields = {...p,employeeName:name.employeeName,nameState:name.nameState}
        return makeContextResult({source:SOURCE,sourceId:companyId + ':' + (shifts ? p.shiftId : p.punchId),
          title:name.employeeName || '7shifts employee ' + p.userId,entityType:shifts ? 'scheduled_shift' : 'time_punch',retrievedAt,
          originalDate:shifts ? p.start : clockOuts ? p.clockedOut : p.clockedIn,fields,content:JSON.stringify(fields),link:'https://app.7shifts.com/'})
      })
      check()
      return {results:rows,evidence:{source:SOURCE,trust:'live',entityType:shifts ? 'scheduled_shift' : 'time_punch',retrievedAt,
        completeness:complete ? 'complete' : 'partial',completeWithinScope:complete,
        queryScope:{companyId,field:shifts ? 'start' : clockOuts ? 'clocked_out' : 'clocked_in',window:query.timeMin + '..' + query.timeMax,filters:query,selection:shifts ? 'published_start_inclusive_utc' : clockOuts ? 'clocked_out_inclusive_utc' : 'clocked_in_inclusive_utc'},
        returnedRows:rows.length,matchingTotal:complete ? rows.length : null,sourceTotal:null,truncated:pages === MAX_PAGES && !complete,
        provenance:{source:SOURCE,endpoint:shifts ? 'GET /v2/company/{company_id}/shifts' : 'GET /v2/company/{company_id}/time_punches',apiVersion:shifts ? '2026-01-01' : '2025-03-01',pages,readOnly:true}}}
    } catch (e) {
      const safe = ['invalid_request','read_access_disabled','connection_not_configured','source_access_changed','source_not_authorised','source_rate_limited','invalid_source_response','live_transport_not_allowed_in_tests']
      throw Error(safe.includes(e?.message) ? e.message : 'source_unavailable')
    } finally {
      clearTimeout(timer)
      clearInterval(accessTimer)
      if (controller) controller.abort()
    }
  }
  return {source:SOURCE,methods:{listTimePunches,listClockOuts,listAttendance,listShifts},rowLimits:{listTimePunches:null,listClockOuts:null,listAttendance:null,listShifts:null},readTimeoutMs:9000}
}
module.exports = {SOURCE,MAX_PAGES,PAGE_SIZE,validateQuery,instant,createSevenShiftsReadAdapter}
