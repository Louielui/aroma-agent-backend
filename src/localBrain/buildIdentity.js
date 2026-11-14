'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
// Source identity without invoking Git or a child process inside the fenced host.
function buildIdentity(root){
  const entries=[]
  function walk(relative){
    for(const name of fs.readdirSync(path.join(root,relative)).sort()){
      const file=path.join(relative,name),stat=fs.lstatSync(path.join(root,file))
      if(stat.isSymbolicLink())throw Error('local_source_symlink_refused')
      if(stat.isDirectory())walk(file)
      else if(stat.isFile())entries.push([file.replaceAll('\\','/'),crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])
    }
  }
  walk('src');walk('scripts/localBrain')
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}
module.exports={buildIdentity}
