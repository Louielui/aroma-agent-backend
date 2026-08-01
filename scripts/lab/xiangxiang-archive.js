'use strict'

/**
 * xiangxiang-archive.js — the Owner's own hands on the Lab archive.
 *
 * The ONLY reader of the archive in v0.1. Nothing here is reachable from the model, the prompt,
 * the persona or Decision Recall; this is a command the Owner runs.
 *
 *   node scripts/lab/xiangxiang-archive.js stats
 *   node scripts/lab/xiangxiang-archive.js export [> file.json]
 *   node scripts/lab/xiangxiang-archive.js audit
 *   node scripts/lab/xiangxiang-archive.js delete --turn <turnId>
 *   node scripts/lab/xiangxiang-archive.js delete --conversation <conversationId>
 *   node scripts/lab/xiangxiang-archive.js delete --from 2026-08-01 --to 2026-08-02
 *   node scripts/lab/xiangxiang-archive.js delete --all
 *
 * DELETE REALLY DELETES. It rewrites the archive without the selected records and writes an
 * audit line naming what went — ids, counts and ranges, never the text. An audit that kept the
 * text would be a copy of the thing you asked to remove.
 *
 * The export carries verbatim conversation text and is exactly as sensitive as the archive.
 */

const { createConversationArchive } = require('../../src/lab/conversationArchive')

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true)
}

const archive = createConversationArchive({ root: flag('root') && flag('root') !== true ? flag('root') : undefined })

function out (o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n') }

if (cmd === 'stats') {
  out(archive.stats())
  process.exit(0)
}

if (cmd === 'export') {
  out(archive.exportAll())
  process.exit(0)
}

if (cmd === 'audit') {
  out({ events: archive.readAudit() })
  process.exit(0)
}

if (cmd === 'delete') {
  let sel = null
  if (flag('all') === true) sel = { all: true }
  else if (flag('turn')) sel = { turnId: flag('turn') }
  else if (flag('conversation')) sel = { conversationId: flag('conversation') }
  else if (flag('from') || flag('to')) sel = { from: flag('from') || null, to: flag('to') || null }

  if (!sel) {
    process.stderr.write('delete needs one of: --turn <id> | --conversation <id> | --from/--to | --all\n')
    process.exit(2)
  }
  const before = archive.stats()
  const res = archive.remove(sel)
  out({ selector: sel, before: before.turnCount, result: res, after: archive.stats().turnCount })
  process.exit(res.ok ? 0 : 1)
}

process.stderr.write('usage: stats | export | audit | delete [--turn|--conversation|--from --to|--all]\n')
process.exit(2)
