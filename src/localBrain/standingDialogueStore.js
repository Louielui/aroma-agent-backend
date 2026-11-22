'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {hash, ID} = require('../actions/contract')
const {UsageBudgetError} = require('../actions/usageError')

const fileName = 'standing.sqlite'
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Winnipeg', year:'numeric',month:'2-digit',day:'2-digit'})
const dayOf = at => dayFormat.format(new Date(at))
const metrics = ['reserved','dispatched','succeeded','failed','unresolved']
const emptyUsage = () => Object.fromEntries(metrics.map(key => [key,0]))
const fail = () => { throw new UsageBudgetError('usage_audit_unavailable') }

const schema = `
  CREATE TABLE grants (
    id TEXT PRIMARY KEY NOT NULL, material TEXT NOT NULL, digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('active','paused','revoked')),
    epoch INTEGER NOT NULL CHECK(epoch >= 1)
  ) STRICT;
  CREATE UNIQUE INDEX current_grant ON grants((1)) WHERE state <> 'revoked';
  CREATE TABLE changes (
    grant_id TEXT NOT NULL REFERENCES grants(id), epoch INTEGER NOT NULL,
    state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(grant_id,epoch)
  ) STRICT;
  CREATE TABLE turns (
    id TEXT PRIMARY KEY NOT NULL, grant_id TEXT NOT NULL REFERENCES grants(id),
    epoch INTEGER NOT NULL, ledger TEXT NOT NULL, digest TEXT NOT NULL
  ) STRICT;
  CREATE TABLE totals (
    grant_id TEXT NOT NULL REFERENCES grants(id), day TEXT NOT NULL,
    reserved INTEGER NOT NULL CHECK(reserved >= 0),
    dispatched INTEGER NOT NULL CHECK(dispatched BETWEEN 0 AND reserved),
    succeeded INTEGER NOT NULL CHECK(succeeded BETWEEN 0 AND dispatched),
    failed INTEGER NOT NULL CHECK(failed BETWEEN 0 AND reserved),
    unresolved INTEGER NOT NULL CHECK(unresolved = reserved - succeeded - failed),
    PRIMARY KEY(grant_id,day)
  ) STRICT;
  PRAGMA user_version=1;
`

function audit(operation, callback) {
  try { return callback() } catch (cause) {
    if (cause instanceof UsageBudgetError) throw cause
    // Keep the SQLite operation and numeric extended error code out of chat.
    const error = new UsageBudgetError('usage_audit_unavailable')
    error.fileOperation = operation
    error.osCode = Number.isInteger(cause?.errcode) ? 'SQLITE_'+cause.errcode : 'UNKNOWN'
    throw error
  }
}

function openStandingStore(dir, mode = 'read') {
  const file = path.join(dir,fileName)
  let stat
  try { stat=fs.lstatSync(file) } catch (e) { if (e.code!=='ENOENT') fail() }
  if (!stat && mode!=='create') return null
  return audit('open', () => {
    if (stat && !stat.isFile()) fail()
    if (!stat) {
      fs.mkdirSync(dir,{recursive:true})
      fs.closeSync(fs.openSync(file,'wx',0o600))
    }
    const {DatabaseSync}=require('node:sqlite')
    const db = new DatabaseSync(file,{readOnly:mode==='read'})
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;')
      if (mode!=='read') db.exec('PRAGMA synchronous=FULL;')
      if (!stat) db.exec('BEGIN IMMEDIATE; '+schema+' COMMIT;')
      if (db.prepare('PRAGMA user_version').get().user_version!==1) fail()
      return databaseStore(db)
    } catch (error) {
      db.close()
      throw error
    }
  })
}

function summarize(attempts) {
  const groups=new Map([['',emptyUsage()]])
  for (const attempt of attempts) {
    const day=dayOf(attempt.reservedAt)
    if (!groups.has(day)) groups.set(day,emptyUsage())
    for (const counter of [groups.get(''),groups.get(day)]) {
      counter.reserved++
      if (attempt.dispatchedAt) counter.dispatched++
      if (attempt.state==='succeeded') counter.succeeded++
      if (attempt.state==='failed') counter.failed++
      if (attempt.state==='reserved'||attempt.state==='dispatched') counter.unresolved++
    }
  }
  return groups
}

function databaseStore(db) {
  const getGrant=db.prepare(`SELECT g.*,c.state AS recorded_state,c.at FROM grants g
    LEFT JOIN changes c ON c.grant_id=g.id AND c.epoch=g.epoch WHERE g.id=?`)
  const currentId=db.prepare("SELECT id FROM grants WHERE state<>'revoked'")
  const getTurn=db.prepare('SELECT grant_id,epoch,ledger,digest FROM turns WHERE id=?')
  const getTotals=db.prepare('SELECT reserved,dispatched,succeeded,failed,unresolved FROM totals WHERE grant_id=? AND day=?')
  const setTotals=db.prepare(`INSERT INTO totals VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(grant_id,day) DO UPDATE SET reserved=excluded.reserved,dispatched=excluded.dispatched,
    succeeded=excluded.succeeded,failed=excluded.failed,unresolved=excluded.unresolved`)
  let transaction=false
  function lock() {
    if (transaction) fail()
    audit('begin',()=>db.exec('BEGIN IMMEDIATE'))
    transaction=true
    return () => {
      try { audit('commit',()=>db.exec('COMMIT')) }
      catch (error) { db.exec('ROLLBACK'); throw error }
      finally { transaction=false }
    }
  }
  function snapshot(action) {
    return audit('read',()=>{
      db.exec('BEGIN')
      try { return action() } finally { db.exec('ROLLBACK') }
    })
  }
  function atomic(action) {
    return audit('write', () => {
      const release=lock()
      try { return savepoint(action) } finally { release() }
    })
  }
  // The budget saves one event per transaction. A failed statement must leave
  // the ledger and both day/lifetime counts at their previous values.
  function savepoint(action) {
    db.exec('SAVEPOINT mutation')
    try {
      const value=action()
      db.exec('RELEASE mutation')
      return value
    } catch (error) {
      db.exec('ROLLBACK TO mutation; RELEASE mutation;')
      throw error
    }
  }
  function grant(id) {
    return audit('read',()=>{
      const row=getGrant.get(id)
      if (!row) return null
      const material=JSON.parse(row.material)
      if (material.id!==id||hash(material)!==row.digest||row.state!==row.recorded_state||!Number.isSafeInteger(row.at)) fail()
      return {material,state:row.state,epoch:row.epoch}
    })
  }
  function current() {
    const row=audit('read',()=>currentId.get())
    return row ? grant(row.id) : null
  }
  function changeGrant(material,state,epoch,at) {
    if (!transaction) fail()
    if (epoch===1) db.prepare('INSERT INTO grants VALUES(?,?,?,?,?)').run(material.id,JSON.stringify(material),hash(material),state,epoch)
    else db.prepare('UPDATE grants SET state=?,epoch=? WHERE id=?').run(state,epoch,material.id)
    db.prepare('INSERT INTO changes VALUES(?,?,?,?)').run(material.id,epoch,state,at)
  }
  function turn(id) {
    if (!ID.test(id||'')) fail()
    return audit('read',()=>{
      const row=getTurn.get(id)
      if (!row) return null
      const ledger=JSON.parse(row.ledger)
      if (ledger.id!==id||hash(ledger)!==row.digest) fail()
      return {grantId:row.grant_id,epoch:row.epoch,ledger}
    })
  }
  function totals(id,day='') {
    return audit('read',()=>({...emptyUsage(),...getTotals.get(id,day)}))
  }
  function turnStore(id,grantId,epoch) {
    return {
      lockRun: lock,
      exists: candidate => !!turn(candidate),
      get(candidate) {
        if (candidate!==id) fail()
        const saved=turn(id)
        if (saved && (saved.grantId!==grantId||saved.epoch!==epoch)) fail()
        return saved?.ledger||null
      },
      save(ledger) {
        if (!transaction||ledger.id!==id) fail()
        audit('write',()=>savepoint(()=>{
          const before=this.get(id)
          if (before) db.prepare('UPDATE turns SET ledger=?,digest=? WHERE id=?').run(JSON.stringify(ledger),hash(ledger),id)
          else db.prepare('INSERT INTO turns VALUES(?,?,?,?,?)').run(id,grantId,epoch,JSON.stringify(ledger),hash(ledger))
          const oldCounts=summarize(before?.attempts||[])
          const newCounts=summarize(ledger.attempts)
          for (const [day,counts] of newCounts) {
            const prior=oldCounts.get(day)||emptyUsage()
            const total=totals(grantId,day)
            setTotals.run(grantId,day,...metrics.map(key=>total[key]+counts[key]-prior[key]))
          }
        }))
      }
    }
  }
  return {current,grant,changeGrant,turn,turnStore,totals,atomic,snapshot,close:()=>db.close()}
}

module.exports = {openStandingStore, dayOf}
