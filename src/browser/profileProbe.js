'use strict'

/**
 * profileProbe.js — L2's fence, and the profile-lock check folded into it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PROBE IS THE FENCE, SO A PROBE THAT HAS NEVER FAILED IS NOT EVIDENCE.
 *
 * Both checks here must be **demonstrated failing** on a throwaway profile before either is
 * trusted. A check that has only ever returned 「clean」 is indistinguishable from one that
 * returns 「clean」 unconditionally — `basis` with two unreachable values, `count: 43`, and the
 * hardcoded `stable: true` that made `REFUSAL.UNSTABLE` unreachable. Three already.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY IT RUNS BEFORE EVERY SESSION, NOT ONCE ──────────────────────────────
 * > **Owner: 「the person most likely to dismantle L2 is me, at the moment I am least paying
 * > attention.」**
 *
 * He finishes a payment in her profile. Chrome offers to save the card. If it saves, 「no
 * payment method」 silently stops being true — and nothing else in the system would notice.
 *
 * ── AND THE MESSAGE POINTS AT THE PAYMENT, NOT AT A TABLE ───────────────────
 * > **Owner: 「the probe's message should point at my payment, not at a database table, or I
 * > will not understand what it caught.」**
 *
 * `findings[].saying` is written for him. The table name is kept as `where`, for whoever has
 * to fix it, and never as the headline.
 *
 * ── NO DEPENDENCY ───────────────────────────────────────────────────────────
 * `node:sqlite` is built into Node 24. Chrome's `Web Data` is a plain SQLite file.
 */

const fs = require('node:fs')
const path = require('node:path')

const STATE = Object.freeze({
  CLEAN: 'CLEAN',
  FOUND: 'PAYMENT_METHOD_PRESENT',
  NO_DATABASE: 'NO_DATABASE_YET',
  UNREADABLE: 'UNREADABLE'
})

/** Chrome's payment stores. `saying` is the sentence the Owner reads. */
const TABLES = [
  { table: 'credit_cards', saying: 'a card saved in this browser profile' },
  { table: 'masked_credit_cards', saying: 'a Google Pay card synced into this profile' },
  { table: 'server_card_metadata', saying: 'a server-side card linked to this profile' },
  { table: 'payments_customer_data', saying: 'a Google payments account linked to this profile' },
  { table: 'local_stored_cvc', saying: 'a stored security code (CVC)' }
]

function webDataPaths (userDataDir) {
  return [
    path.join(userDataDir, 'Default', 'Web Data'),
    path.join(userDataDir, 'Web Data')
  ]
}

/**
 * @returns {{state:string, clean:boolean, findings:Array, checked:Array, saying:string}}
 */
function probePaymentMethods (userDataDir) {
  const file = webDataPaths(userDataDir).find((p) => fs.existsSync(p))
  if (!file) {
    // ⚠ NOT 「clean」. HR-5: absent stays absent. A profile Chrome has never written has no
    // database, which is a different claim from 「we looked and there is nothing」.
    return {
      state: STATE.NO_DATABASE,
      clean: true,
      findings: [],
      checked: [],
      saying: '呢個 profile Chrome 未寫過資料庫 —— 即係未存過卡,唔係「查過冇卡」。'
    }
  }

  let db
  try {
    const { DatabaseSync } = require('node:sqlite')
    // Read-only, and on a COPY: Chrome holds the live file open, and a probe must never be a
    // reason the browser misbehaves.
    const tmp = file + '.probe-copy'
    fs.copyFileSync(file, tmp)
    db = new DatabaseSync(tmp, { readOnly: true })
    const findings = []
    const checked = []
    for (const t of TABLES) {
      try {
        const row = db.prepare('SELECT COUNT(*) AS n FROM ' + t.table).get()
        checked.push(t.table)
        if (row && Number(row.n) > 0) {
          findings.push({ where: t.table, count: Number(row.n), saying: t.saying })
        }
      } catch (_) { /* table absent in this Chrome version — recorded by omission from checked */ }
    }
    db.close()
    try { fs.unlinkSync(tmp) } catch (_) {}

    if (!checked.length) {
      return { state: STATE.UNREADABLE, clean: false, findings: [], checked, saying: '我打得開個資料庫,但一張表都查唔到。當唔安全處理。' }
    }
    if (findings.length) {
      const total = findings.reduce((s, f) => s + f.count, 0)
      return {
        state: STATE.FOUND,
        clean: false,
        findings,
        checked,
        // Points at what he did, not at a table.
        saying: '呢個 profile 而家有付款方式(' + total + ' 項:' + findings.map((f) => f.saying).join('、') +
          ')。最可能係你上次喺呢個 profile 完成付款嗰陣,Chrome 問你存唔存卡,而存咗。' +
          '要喺 Chrome 設定度刪走佢,我先可以開工。'
      }
    }
    return { state: STATE.CLEAN, clean: true, findings: [], checked, saying: '查過 ' + checked.length + ' 張付款表,全部空。' }
  } catch (e) {
    try { if (db) db.close() } catch (_) {}
    return {
      state: STATE.UNREADABLE,
      clean: false,
      findings: [],
      checked: [],
      saying: '我讀唔到個 profile 嘅付款資料庫(' + String(e.message).split('\n')[0].slice(0, 60) + ')。讀唔到就當唔安全,唔開工。'
    }
  }
}

/**
 * ⛔ NEVER DELETES ANYTHING.
 *
 * > **Owner: 「Never auto-clear a stale SingletonLock. Two Chromes writing one profile is the
 * > kind of corruption that surfaces days later as something else entirely.」**
 *
 * This reports what it finds and stops. Clearing a lock is the Owner's action, taken knowing
 * why — never a step the system performs on its own to keep going.
 */
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']

function probeProfileLock (userDataDir) {
  if (!fs.existsSync(userDataDir)) {
    return { state: 'NO_PROFILE', held: false, files: [], saying: '個 profile 資料夾未存在。' }
  }
  const found = []
  for (const f of LOCK_FILES) {
    const p = path.join(userDataDir, f)
    try {
      const st = fs.lstatSync(p)
      found.push({ file: f, kind: st.isSymbolicLink() ? 'symlink' : 'file', mtime: st.mtimeMs })
    } catch (_) { /* absent */ }
  }
  if (!found.length) return { state: 'FREE', held: false, files: [], saying: '冇鎖,個 profile 得閒。' }
  return {
    state: 'LOCKED',
    held: true,
    files: found,
    saying: '個 profile 有鎖(' + found.map((f) => f.file).join('、') + ')。' +
      '可能香香用緊,亦可能係上次 crash 留低。⛔ 我唔會自動刪 —— 兩個 Chrome 一齊寫一個 profile ' +
      '嘅損壞,會喺幾日之後以另一件事嘅樣出現。'
  }
}

module.exports = { probePaymentMethods, probeProfileLock, STATE, TABLES, LOCK_FILES }

/**
 * ⛔ CARD SAVING IS DISABLED AT PROFILE CREATION — not by declining a prompt at payment time.
 *
 * > **Owner: 「Card saving disabled at profile creation, not by policy at payment time. The
 * > person most likely to dismantle L2 is me, at the moment I am least paying attention.」**
 *
 * `writeProfileDefaults` is called ONCE when the profile directory is made, before Chrome has
 * ever run in it. `probeCardSavingDisabled` then checks the setting is STILL off before every
 * session — because a preference is a thing that can change, and 「we set it once」 is a memory,
 * not a fence.
 */
const PREF_PATH = ['autofill', 'credit_card_enabled']

function writeProfileDefaults (userDataDir) {
  const dir = path.join(userDataDir, 'Default')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'Preferences')
  let prefs = {}
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { prefs = {} }
  prefs.autofill = prefs.autofill || {}
  prefs.autofill.credit_card_enabled = false      // never offer to save a card
  prefs.autofill.profile_enabled = false          // nor an address
  prefs.credentials_enable_service = false        // nor a password
  prefs.credentials_enable_autosignin = false

  // ⛔ CHROME ITSELF MUST NEVER SIGN IN. Signing the BROWSER into a Google account is a
  // different act from signing into a website with Google, and it SYNCS GOOGLE PAY CARDS AND
  // AUTOFILL INTO THE PROFILE — dismantling L2 without anyone visiting a payment page.
  // Set at creation; checked by probeBrowserSignIn before every session.
  prefs.signin = prefs.signin || {}
  prefs.signin.allowed = false
  prefs.signin.allowed_on_next_startup = false
  prefs.sync = prefs.sync || {}
  prefs.sync.requested = false
  prefs.sync.has_setup_completed = false

  // ⛔ account_info IS DELIBERATELY NOT TOUCHED. It is the EVIDENCE probeBrowserSignIn reads.
  // Setting it to [] would make the fence erase the very thing its own probe looks for -- on
  // a re-assert before every launch, a genuinely signed-in Chrome would be wiped from the
  // record and then reported clean. We WRITE POLICY; we READ EVIDENCE. Never both on one key.

  fs.writeFileSync(file, JSON.stringify(prefs))
  return {
    file,
    set: {
      credit_card_enabled: false,
      profile_enabled: false,
      credentials_enable_service: false,
      signin_allowed: false,
      sync_requested: false
    }
  }
}

/**
 * ⚠ WHY THIS ASKS THE LOCK BEFORE IT BLAMES A MISSING FILE.
 *
 * Chrome rewrites `Preferences` ATOMICALLY — temp file, then rename — so a probe run while
 * Chrome is open can catch the instant it does not exist. The first version reported
 * 「搵唔到個 profile 嘅設定檔」, which describes a missing file when the truth is 「Chrome is
 * holding it」. **A correct refusal with a wrong reason sends the Owner looking in the wrong
 * place**, and this week has cost several rounds to exactly that.
 */
function absentReason (userDataDir) {
  const lock = probeProfileLock(userDataDir)
  if (lock.held) {
    return {
      state: 'PROFILE_IN_USE',
      saying: 'Chrome 而家開住呢個 profile,佢自己揸住個設定檔 —— 佢係原子性重寫嘅,' +
        '所以會有一刻讀唔到。閂咗 Chrome 我就讀得返。個檔案冇唔見。'
    }
  }
  return { state: 'NO_PREFERENCES', saying: '個 profile 冇設定檔,而 Chrome 亦冇開住佢。讀唔到就當唔安全。' }
}

function probeCardSavingDisabled (userDataDir) {
  const file = path.join(userDataDir, 'Default', 'Preferences')
  if (!fs.existsSync(file)) {
    const a = absentReason(userDataDir)
    return { ok: false, state: a.state, saying: a.saying }
  }
  let prefs
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    return { ok: false, state: 'UNREADABLE', saying: '個設定檔讀唔到(' + String(e.message).slice(0, 40) + ')。當唔安全。' }
  }
  const v = prefs && prefs.autofill ? prefs.autofill.credit_card_enabled : undefined
  if (v === false) return { ok: true, state: 'DISABLED', saying: '存卡功能係熄嘅。' }
  return {
    ok: false,
    state: v === undefined ? 'NOT_SET' : 'ENABLED',
    saying: 'Chrome 而家會問你存唔存卡(設定係 ' + String(v) + ')。' +
      '呢個係喺開 profile 嗰陣就應該熄死嘅嘢 —— 而家佢開返咗,所以下次你付款,張卡會留喺呢個 profile 度。'
  }
}

module.exports.writeProfileDefaults = writeProfileDefaults
module.exports.probeCardSavingDisabled = probeCardSavingDisabled
/**
 * ⛔ Is Chrome ITSELF signed into a Google account?
 *
 * If it is, Google Pay cards and autofill sync in and L2 is gone — **without anyone visiting a
 * payment page.** That is a SEPARATE failure route from 「he saved a card」, so it gets its own
 * probe, its own three states, and its own demonstration of failing.
 */
function probeBrowserSignIn (userDataDir) {
  const file = path.join(userDataDir, 'Default', 'Preferences')
  if (!fs.existsSync(file)) {
    const a = absentReason(userDataDir)
    return { ok: false, state: a.state, accounts: 0, saying: a.saying }
  }
  let prefs
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) {
    return { ok: false, state: 'UNREADABLE', accounts: 0, saying: '個設定檔讀唔到。當唔安全,唔開工。' }
  }
  const accounts = Array.isArray(prefs.account_info) ? prefs.account_info.length : 0
  const syncing = Boolean(prefs.sync && (prefs.sync.requested || prefs.sync.has_setup_completed))
  if (accounts > 0 || syncing) {
    return {
      ok: false,
      state: 'SIGNED_IN',
      accounts,
      saying: 'Chrome 本身登咗 Google 戶口,或者開咗同步。咁樣 Google Pay 啲卡同自動填表會同步入呢個 profile ' +
        '—— 即係唔使去過任何付款頁,「冇付款方式」已經唔成立。要喺 Chrome 度登出同關同步,我先可以開工。'
    }
  }
  if (!prefs.signin || prefs.signin.allowed !== false) {
    return { ok: false, state: 'SIGNIN_ALLOWED', accounts: 0, saying: 'Chrome 仲准許登入佢自己嘅 Google 戶口。呢個應該喺開 profile 嗰陣就關死。' }
  }
  return { ok: true, state: 'BLOCKED', accounts: 0, saying: 'Chrome 本身唔准登入,亦冇同步。' }
}

module.exports.probeBrowserSignIn = probeBrowserSignIn
module.exports.PREF_PATH = PREF_PATH
