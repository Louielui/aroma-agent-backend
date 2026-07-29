'use strict'

/**
 * generate-assertion-registry.js — emit the assertion register as JSON for the PowerShell
 * side to read.
 *
 * The JS module is the source of truth. This file is a PROJECTION of it, checked in so the
 * probes can run on a machine with no Node available, and guarded by a test that fails if
 * the projection and the source ever disagree. Regenerate with:
 *
 *   node scripts/computer/generate-assertion-registry.js
 */

const fs = require('node:fs')
const path = require('node:path')
const registry = require('../../src/computer/assertionRegistry')

const OUT = path.resolve(__dirname, 'assertion-registry.json')
const json = JSON.stringify(registry.toJSON(), null, 2) + '\n'
fs.writeFileSync(OUT, json, 'utf8')

console.log('wrote ' + OUT)
console.log('  assertions  : ' + registry.ids().length)
console.log('  fingerprint : ' + registry.registerFingerprint())
