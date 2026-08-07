'use strict'
/**
 * Did the login survive closing Chrome?
 *
 * Reads the profile's Cookies database READ-ONLY, on a copy, and reports per host: how many
 * cookies, and how many are SESSION cookies (`has_expires = 0`) — which do not survive the
 * browser closing.
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const PROFILE = 'C:\\Aroma\\browser-profile'
const file = path.join(PROFILE, 'Default', 'Network', 'Cookies')
const alt = path.join(PROFILE, 'Default', 'Cookies')
const src = fs.existsSync(file) ? file : (fs.existsSync(alt) ? alt : null)

if (!src) { console.log('no Cookies database found'); process.exit(1) }

const tmp = src + '.probe-copy'
fs.copyFileSync(src, tmp)
const db = new DatabaseSync(tmp, { readOnly: true })

const rows = db.prepare(
  'SELECT host_key, COUNT(*) AS n, SUM(CASE WHEN has_expires=0 THEN 1 ELSE 0 END) AS session_only ' +
  'FROM cookies GROUP BY host_key ORDER BY n DESC'
).all()

const total = rows.reduce((s, r) => s + Number(r.n), 0)
console.log('cookies in the profile: ' + total + ' across ' + rows.length + ' hosts\n')

const costco = rows.filter((r) => /costco/i.test(r.host_key))
if (!costco.length) {
  console.log('⛔ NO COSTCO COOKIES AT ALL. The login did not persist.')
} else {
  console.log('costco hosts:')
  for (const r of costco) {
    console.log(`   ${String(r.host_key).padEnd(34)} ${String(r.n).padStart(3)} cookies, ${r.session_only} session-only`)
  }
}

console.log('\ntop hosts overall:')
rows.slice(0, 8).forEach((r) => console.log(`   ${String(r.host_key).padEnd(34)} ${String(r.n).padStart(3)}`))

db.close()
try { fs.unlinkSync(tmp) } catch (_) {}
