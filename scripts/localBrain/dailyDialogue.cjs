'use strict'
const { createInterface } = require('node:readline/promises')
const { hash, ID } = require('../../src/actions/contract')
const { BOOT_COMMIT } = require('../../src/governance/bootCommit')
const { createDailyDialogue } = require('../../src/localBrain/dailyDialogue')
const { profile } = require('../../src/actions/dailyDialoguePolicy')

async function main([op,...args]) {
  const service = createDailyDialogue()
  if (op==='status' && !args.length) {
    const status=service.status()
    console.log(JSON.stringify({state:status.state,id:status.id,expiresAt:status.expiresAt,helper:status.helper}))
    return
  }
  if (op==='after-turn' && args.length===3) {
    const workflow=require('../../src/core/operating/runStore').createRunStore({workflow:'investigation'})
    console.log(JSON.stringify(service.afterTurn(...args,workflow)))
    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('owner_terminal_required')
  const [id,commit,limitText,windowText]=args
  if (!ID.test(id||'') || !BOOT_COMMIT || commit!==BOOT_COMMIT) throw Error('exact_local_source_required')
  let material
  if(op==='pause' && args.length===2) material={op,id,commit}
  else if(op==='activate' && args.length===4 && [limitText,windowText].every(s=>/^[1-9][0-9]*$/.test(s))) {
    const limit=Number(limitText),windowMs=Number(windowText)
    const selected=profile(id,limit,windowMs)
    material={op,id,commit,limit,windowMs,model:selected.model,digest:selected.digest}
  } else throw Error('invalid_request')
  const terminal=createInterface({input:process.stdin,output:process.stdout})
  try {
    console.log(JSON.stringify(material,null,2))
    const challenge='CONFIRM LOCAL DIALOGUE '+hash(material)
    if(await terminal.question('Type '+challenge+' to continue: ')!==challenge) throw Error('confirmation_refused')
    if(op==='pause')service.pause(id)
    else service.activate(material)
    console.log(JSON.stringify({id,state:service.status().state}))
  } finally { terminal.close() }
}
main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1})
