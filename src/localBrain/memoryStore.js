'use strict'
// Explicit isolated backend for the existing structured-store contract. Never
// selected as a fallback for production PostgreSQL or its service credentials.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v
const encode=v=>JSON.stringify(ordered(v)),hash=v=>createHash('sha256').update(v).digest('hex')
function createLocalStore(dir){
 const root=path.resolve('C:/Aroma/local-brain-runtime'),target=path.resolve(dir)
 if(!path.isAbsolute(dir)||!target.startsWith(root+path.sep))throw Error('local_memory_path_refused')
 fs.mkdirSync(target,{recursive:true})
 if(fs.realpathSync(target)!==target||fs.realpathSync(root)!==root)throw Error('local_memory_path_refused')
 const file=path.join(target,'memory.sqlite')
 if(fs.existsSync(file)&&(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).nlink!==1))throw Error('local_memory_path_refused')
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file,{timeout:1000})
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,version INTEGER,body TEXT);
 CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT,body TEXT,previousHash TEXT,hash TEXT);
 CREATE TABLE IF NOT EXISTS documents(scope TEXT,id TEXT,body TEXT,PRIMARY KEY(scope,id));
 CREATE TABLE IF NOT EXISTS inference(id TEXT PRIMARY KEY,state TEXT,body TEXT);`)
 const all=()=>db.prepare('SELECT body FROM records ORDER BY seq').all().map(r=>JSON.parse(r.body))
 const get=id=>{const r=db.prepare('SELECT body FROM records WHERE id=?').get(id);return r?JSON.parse(r.body):null}
 function commit(changes,event){
  db.exec('BEGIN IMMEDIATE')
  try{
   if(new Set(changes.map(c=>c.row.id)).size!==changes.length)throw Error('revision_conflict')
   for(const c of changes)if((get(c.row.id)?.version||0)!==c.expected)throw Error('revision_conflict')
   for(const {row} of changes){
    db.prepare('INSERT INTO records(id,version,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body').run(row.id,row.version,encode(row))
    const previous=db.prepare('SELECT hash FROM audit WHERE id=? ORDER BY seq DESC LIMIT 1').get(row.id)?.hash||null
    const entry={...event,recordId:row.id,version:row.version,snapshot:row}
    db.prepare('INSERT INTO audit(id,body,previousHash,hash) VALUES(?,?,?,?)').run(row.id,encode(entry),previous,hash((previous||'')+encode(entry)))
   }
   const active=all().filter(r=>r.status==='active'&&['decision','preference'].includes(r.type))
   if(new Set(active.map(r=>encode([r.type,r.scope,r.subject]))).size!==active.length)throw Error('decision_conflict')
   db.exec('COMMIT');return changes.map(c=>structuredClone(c.row))
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 async function invoke(r){
  if(r.op==='get')return get(r.id)
  if(r.op==='all')return all().slice(r.offset,r.offset+200)
  if(r.op==='general_page'){
   const snapshot=r.snapshotSequence??db.prepare('SELECT coalesce(max(seq),0) n FROM records').get().n
   const rows=db.prepare('SELECT seq,body FROM records WHERE seq>? AND seq<=? ORDER BY seq LIMIT 2000').all(r.after,snapshot)
   return {items:rows.map(x=>JSON.parse(x.body)).filter(x=>!x.source.kind.startsWith('admin_mail_')),snapshotSequence:snapshot,nextSequence:rows.at(-1)?.seq||snapshot,hasMore:rows.length===2000&&rows.at(-1).seq<snapshot}
  }
  if(r.op==='grants')return [] // No new agent access or credentials in this candidate.
  if(r.op==='health')return {state:'connected',database:'isolated-local-sqlite',vector:false}
  if(r.op==='commit')return commit(r.changes,r.event)
  if(r.op==='audit')return db.prepare('SELECT body,previousHash,hash FROM audit WHERE id=? ORDER BY seq').all(r.id).map(x=>({...JSON.parse(x.body),previousHash:x.previousHash,hash:x.hash}))
  throw Error('local_memory_operation_not_authorized')
 }
 const store=require('../memory/structuredStore').createStructuredStore({invoke})
 return {store,close:()=>db.close(),seed(rows){if(all().length)return;commit(rows.map(row=>({expected:0,row})),{op:'isolated_snapshot_import',actor:'owner',at:new Date().toISOString()})},
  document(scope,id){const r=db.prepare('SELECT body FROM documents WHERE scope=? AND id=?').get(scope,id);return r?JSON.parse(r.body):null},
  documents(scope){return db.prepare('SELECT body FROM documents WHERE scope=?').all(scope).map(r=>JSON.parse(r.body))},
  saveDocument(scope,id,body){db.prepare('INSERT INTO documents(scope,id,body) VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body').run(scope,id,encode(body))},
  forget(scope,id){db.prepare('DELETE FROM documents WHERE scope=? AND id=?').run(scope,id)},
  reserve(id){const r=db.prepare('SELECT state,body FROM inference WHERE id=?').get(id);if(r?.state==='done')return JSON.parse(r.body);if(r)throw Error('local_memory_inference_unconfirmed');db.prepare('INSERT INTO inference(id,state,body) VALUES(?,?,?)').run(id,'running','null');return null},
  finish(id,body){db.prepare("UPDATE inference SET state='done',body=? WHERE id=?").run(encode(body),id)},
  fail(id,code){db.prepare("UPDATE inference SET state='failed',body=? WHERE id=? AND state='running'").run(encode({code,at:new Date().toISOString()}),id)},
  inferenceStatus(){return {counts:Object.fromEntries(db.prepare('SELECT state,count(*) n FROM inference GROUP BY state').all().map(r=>[r.state,r.n])),lastFailure:(()=>{const r=db.prepare("SELECT body FROM inference WHERE state='failed' ORDER BY rowid DESC LIMIT 1").get();return r?JSON.parse(r.body):null})()}} }
}
module.exports={createLocalStore}
