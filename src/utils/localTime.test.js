'use strict'

/**
 * localTime.test.js — ONE source of truth for the Owner's local time.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 * Two places needed local time and neither asked anybody:
 *
 *   src/lab/conversationRecall.js:77   timeZone: 'America/Winnipeg'   ← hardcoded literal
 *   src/context/readContext.js         local.setHours(0,0,0,0)        ← the PROCESS's OS zone
 *
 * They agree today because the machine happens to be set to America/Winnipeg. That is a
 * coincidence of configuration, not a contract: move the process to a VPS in another zone
 * and the archive would render one clock while 「今日有咩安排」 asked about a different day —
 * silently, with nothing failing.
 *
 * ── THE RULE THE OWNER SET ───────────────────────────────────────────────────
 * "Never fall back to the OS timezone implicitly." An unknown IANA name must FAIL LOUDLY at
 * read time, not degrade to UTC and not degrade to whatever the machine is set to. A wrong
 * clock that works is worse than a clock that stops, because only one of them is visible.
 *
 * MISSING is not MALFORMED, and the two are tested separately: no field yet is the ordinary
 * first-run state and yields the default; a field that is present and wrong is a mistake and
 * throws.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const lt = require('./localTime')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

/** A settings root nobody else owns. */
function root (settings) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-tz-'))
  if (settings !== undefined) fs.writeFileSync(path.join(d, SETTINGS_FILE), typeof settings === 'string' ? settings : JSON.stringify(settings), 'utf8')
  return d
}

/* ═══ 1. THE DEFAULT, AND WHAT "MISSING" MEANS ═════════════════════════════ */

test('*** no settings file at all → the default, not an error ***', () => {
  assert.equal(lt.resolveTimeZone({ root: root() }), 'America/Winnipeg')
  assert.equal(lt.DEFAULT_TIMEZONE, 'America/Winnipeg')
})

test('a settings file with no timezone field → the default', () => {
  assert.equal(lt.resolveTimeZone({ root: root({ schemaVersion: 1, style: '', preferences: '', flags: {} }) }), 'America/Winnipeg')
})

test('*** a valid IANA name is used as written ***', () => {
  for (const tz of ['Asia/Tokyo', 'Europe/London', 'UTC', 'America/Toronto']) {
    assert.equal(lt.resolveTimeZone({ root: root({ timezone: tz }) }), tz, tz)
  }
})

/* ═══ 2. LOUD ON MALFORMED — NEVER UTC, NEVER THE OS ZONE ══════════════════ */

test('*** an unknown IANA name THROWS — it does not become UTC or the OS zone ***', () => {
  for (const bad of ['Mars/Olympus', 'America/Winnipegg', 'PST', 'GMT+5', 'Winnipeg']) {
    assert.throws(() => lt.resolveTimeZone({ root: root({ timezone: bad }) }),
      /timezone/i, 'must fail loudly: ' + bad)
  }
})

test('*** a present-but-not-a-string timezone THROWS ***', () => {
  for (const bad of [42, true, {}, [], '']) {
    assert.throws(() => lt.resolveTimeZone({ root: root({ timezone: bad }) }), /timezone/i, JSON.stringify(bad))
  }
})

test('*** null is CLEARED, not malformed — it is how the schema spells "not set" ***', () => {
  // emptySettings() returns `timezone: null`, and saving null is how the Owner returns to
  // the default. An earlier draft of these tests had null in the throwing list above and
  // this behaviour in the save section — two of my own tests asserting opposite things. The
  // schema decides: null is an absence.
  assert.equal(lt.resolveTimeZone({ root: root({ timezone: null }) }), lt.DEFAULT_TIMEZONE)
})

test('*** an UNREADABLE settings file THROWS — it is not "no settings yet" ***', () => {
  // The distinction this codebase has now made three times: ENOENT is an absence, a corrupt
  // file is a failure, and collapsing the second into the first is how an unknown gets
  // answered as a fact. ownerSettings.load() deliberately swallows both; the timezone read
  // must not.
  const d = root('{ this is not json')
  assert.throws(() => lt.resolveTimeZone({ root: d }), /settings/i)
})

test('the error names the bad value so it can be fixed without a debugger', () => {
  const e = (() => { try { lt.resolveTimeZone({ root: root({ timezone: 'Mars/Olympus' }) }) } catch (err) { return err } })()
  assert.ok(e && e.message.includes('Mars/Olympus'), 'got: ' + (e && e.message))
})

/* ═══ 3. IT IS ACTUALLY THE CONFIGURED ZONE, NOT THE MACHINE'S ═════════════ */

const OS_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

test('*** startOfLocalDay follows the SETTING, not the operating system ***', () => {
  // The machine is America/Winnipeg. Configure Asia/Tokyo and the day must start at a
  // different instant — if this passes with the old setHours() implementation, the test is
  // not measuring what it claims.
  const at = '2026-07-15T18:00:00Z'
  const tokyo = lt.startOfLocalDay(at, { root: root({ timezone: 'Asia/Tokyo' }) })
  const winnipeg = lt.startOfLocalDay(at, { root: root({ timezone: 'America/Winnipeg' }) })
  assert.notEqual(tokyo.toISOString(), winnipeg.toISOString(), 'two zones must not produce one instant')
  // 2026-07-15 18:00Z is 2026-07-16 03:00 in Tokyo (UTC+9) → the day started 2026-07-15T15:00Z.
  assert.equal(tokyo.toISOString(), '2026-07-15T15:00:00.000Z')
})

test('*** DST is honoured, not assumed ***', () => {
  const r = root({ timezone: 'America/Winnipeg' })
  // CDT (UTC-5) in July: local midnight is 05:00Z.
  assert.equal(lt.startOfLocalDay('2026-07-15T18:00:00Z', { root: r }).toISOString(), '2026-07-15T05:00:00.000Z')
  // CST (UTC-6) in January: local midnight is 06:00Z.
  assert.equal(lt.startOfLocalDay('2026-01-15T18:00:00Z', { root: r }).toISOString(), '2026-01-15T06:00:00.000Z')
})

test('formatLocal renders in the configured zone', () => {
  const at = '2026-07-15T18:00:00Z'
  assert.equal(lt.formatLocal(at, { root: root({ timezone: 'Asia/Tokyo' }) }), '2026-07-16 03:00')
  assert.equal(lt.formatLocal(at, { root: root({ timezone: 'America/Winnipeg' }) }), '2026-07-15 13:00')
})

test('a malformed timezone makes startOfLocalDay and formatLocal throw too', () => {
  const r = root({ timezone: 'Mars/Olympus' })
  assert.throws(() => lt.startOfLocalDay('2026-07-15T18:00:00Z', { root: r }), /timezone/i)
  assert.throws(() => lt.formatLocal('2026-07-15T18:00:00Z', { root: r }), /timezone/i)
})

/* ═══ 4. NO IMPLICIT OS FALLBACK ANYWHERE ═════════════════════════════════ */

/** Source with comments removed. Scanning raw text matches the defect NAMED in a comment. */
function codeOf (p) {
  return fs.readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
}

test('*** the module never reads the OS zone as a fallback ***', () => {
  // COMMENT-STRIPPED. The first version scanned raw text and failed on this file's own
  // header, which quotes `local.setHours(0, 0, 0, 0)` as the thing being replaced —
  // measuring the spelling instead of the behaviour, the same trap as the sidebar round.
  const src = codeOf(path.join(__dirname, 'localTime.js'))
  assert.equal(/resolvedOptions\(\)\.timeZone/.test(src), false, 'no OS-zone read')
  assert.equal(/setHours\s*\(/.test(src), false, 'no OS-local date arithmetic')
  // A catch that returns a zone instead of rethrowing would reintroduce the silent default.
  assert.equal(/catch[^}]*return\s+['"]UTC['"]/.test(src), false, 'never silently UTC')
})

test('*** the two old implementations are gone ***', () => {
  const recall = codeOf(path.join(__dirname, '..', 'lab', 'conversationRecall.js'))
  assert.equal(/timeZone:\s*'America\/Winnipeg'/.test(recall), false, 'the hardcoded literal is removed')
  assert.ok(/require\(.*localTime.*\)/.test(recall), 'and it reads the single source')

  const rc = codeOf(path.join(__dirname, '..', 'context', 'readContext.js'))
  assert.equal(/setHours\s*\(/.test(rc), false, 'the OS-dependent midnight is removed')
  assert.ok(/require\(.*localTime.*\)/.test(rc), 'and it reads the single source')
})

test('*** an abbreviation that RESOLVES is still rejected ***', () => {
  // Intl accepts 'PST' and maps it to America/Los_Angeles. Accepting it would give a
  // Winnipeg restaurant a two-hour error that never announces itself.
  assert.equal(lt.isValidZone('PST'), false, 'PST resolves in Intl but is not a zone name')
  assert.equal(lt.isValidZone('EST'), false)
  assert.equal(lt.isValidZone('UTC'), true, 'UTC is the one legitimate slash-free name')
  assert.equal(lt.isValidZone('America/Winnipeg'), true)
})

test('sanity: the machine really is America/Winnipeg, so the tests above prove a difference', () => {
  // EARN THE ZERO. If the host were already Asia/Tokyo, the "follows the setting" test would
  // pass without proving anything. Stated rather than assumed.
  assert.equal(OS_ZONE, 'America/Winnipeg', 'host zone changed — re-read the tests above before trusting them')
})

/* ═══ 5. THE SAVE PATH REFUSES WHAT THE READ PATH WOULD THROW ON ══════════ */

const settings = require('../persona/ownerSettings')

test('*** saving a bad timezone is refused, all-or-nothing ***', () => {
  const d = root()
  const before = settings.load({ root: d })
  const r = settings.save({ style: 'ok', timezone: 'Mars/Olympus' }, { root: d })
  assert.equal(r.ok, false)
  assert.equal(r.field, 'timezone')
  assert.ok(r.detail.includes('Mars/Olympus'), 'the Owner is told which value: ' + r.detail)
  // ALL-OR-NOTHING: the valid style must not have been written either.
  assert.equal(settings.load({ root: d }).style, before.style, 'nothing was saved')
})

test('an abbreviation is refused at save time too, with the reason', () => {
  const r = settings.save({ timezone: 'CST' }, { root: root() })
  assert.equal(r.ok, false)
  assert.ok(/ambiguous/i.test(r.detail), 'says WHY, not just no: ' + r.detail)
})

test('*** a valid timezone saves and is then what localTime reads ***', () => {
  const d = root()
  assert.equal(settings.save({ timezone: 'Asia/Tokyo' }, { root: d }).ok, true)
  assert.equal(lt.resolveTimeZone({ root: d }), 'Asia/Tokyo', 'the write and the read agree')
})

test('null or empty clears the field back to the default', () => {
  const d = root()
  settings.save({ timezone: 'Asia/Tokyo' }, { root: d })
  assert.equal(settings.save({ timezone: null }, { root: d }).ok, true)
  assert.equal(lt.resolveTimeZone({ root: d }), lt.DEFAULT_TIMEZONE)
})

test('an existing settings file without the field keeps working untouched', () => {
  // Nobody's saved settings gain a timezone by upgrade; they get the default until set.
  const d = root({ schemaVersion: 1, style: '簡短啲', preferences: '', flags: {} })
  assert.equal(lt.resolveTimeZone({ root: d }), lt.DEFAULT_TIMEZONE)
  assert.equal(settings.load({ root: d }).style, '簡短啲', 'and the rest is unchanged')
})

test('*** midnight is exactly midnight — no millisecond remainder ***', () => {
  // startOfLocalDay(new Date()) returned 05:00:00.748Z: partsIn resolves to the second, so
  // an input carrying milliseconds folded them into the computed offset. Caught by running
  // it against the live clock rather than against tidy fixtures — every test above used an
  // ISO string ending in .000 and passed straight over it.
  const r = root({ timezone: 'America/Winnipeg' })
  for (const ms of [0, 1, 748, 999]) {
    const d = new Date(Date.UTC(2026, 6, 15, 18, 30, 20, ms))
    const start = lt.startOfLocalDay(d, { root: r })
    assert.equal(start.getUTCMilliseconds(), 0, 'ms=' + ms + ' leaked: ' + start.toISOString())
    assert.equal(start.toISOString(), '2026-07-15T05:00:00.000Z', 'ms=' + ms)
  }
  assert.equal(lt.startOfLocalDay(new Date(), { root: r }).getUTCMilliseconds(), 0, 'and against the live clock')
})
