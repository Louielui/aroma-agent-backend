'use strict'
const {fileName,validatePackage}=require('../../workers/execution/windowsSandbox')
const {gitRead,createSource}=require('../projectWork/source')
const {ID}=require('../operating/runStore')
const TEST='acceptance/registered-task.test.cjs'
function allowed(name){try{return typeof name==='string'&&name.startsWith('src/')&&fileName(name)===name}catch{return false}}
function validate(scope,editable){
 if(!scope||Object.keys(scope).sort().join(',')!=='budgetRoot,files,profile'||scope.profile!=='repository'||!ID.test(scope.budgetRoot||'')||scope.budgetRoot===require('../../actions/usageBudget').PROFILE.id||!Array.isArray(scope.files)||!scope.files.length||scope.files.length>49||new Set(scope.files.map(n=>String(n).toLowerCase())).size!==scope.files.length||scope.files.some(n=>!allowed(n))||editable.some(n=>!scope.files.includes(n)||n.startsWith('src/demo/assets/')||/\.(?:test\.[cm]?js|css|html|svg)$/.test(n)))throw Error('invalid_request')
 return scope
}
function validateSnapshot(snapshot){try{validatePackage({files:snapshot.order.files,tests:[TEST],expectedTests:3})}catch{throw Error('repository_package_limit')}}
// The host binds the backend checkout. A chat path is a selection, never a
// filesystem root, credential or read grant. Existing package limits stay intact.
function createInventory({root,readGit=gitRead,health}){
 async function list(bootCommit){
  if(!/^[a-f0-9]{40}$/.test(bootCommit||''))throw Error('invalid_request')
  if((await readGit(root,['rev-parse','HEAD'])).trim()!==bootCommit)throw Error('source_changed')
  const lines=(await readGit(root,['ls-tree','-r','-l',bootCommit,'--','src'])).trim().split('\n')
  return lines.flatMap(line=>{const m=line.match(/^100644 blob [a-f0-9]{40}\s+(\d+)\t(.+)$/);if(!m||!allowed(m[2]))return[];const limit=require('../../workers/execution/packageLimits').fileLimit(m[2]);return[{path:m[2],bytes:Number(m[1]),limit,eligible:Number(m[1])<=limit}]})
 }
 return {list,sourceFor:definition=>createSource({root,readGit,...(health?{health}:{}),resolveRecipe:id=>{if(id!==definition.workOrder.recipe)throw Error('invalid_request');return definition}})}
}
module.exports={allowed,validate,validateSnapshot,createInventory}
