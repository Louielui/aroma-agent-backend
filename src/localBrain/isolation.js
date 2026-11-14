'use strict'
// Process-local transport boundary for the isolated acceptance host. No firewall,
// credentials or global service settings are changed. Install before app imports.
function install({ port = 11435, tokenizerPort = 11436, audit = () => {} } = {}) {
  const net = require('node:net'), child = require('node:child_process')
  const connect = net.Socket.prototype.connect
  const restore = []
  const deny = kind => { audit({type:'egress_denied',kind}); const e = Error('local_only_egress_denied'); e.code='local_only_egress_denied'; throw e }
  net.Socket.prototype.connect = function(...args) {
    const first = args[0]
    const o = Array.isArray(first) ? first[0] : first
    const target = typeof o === 'object' ? o : {port:o,host:typeof args[1] === 'string' ? args[1] : 'localhost'}
    if (target.path || target.host !== '127.0.0.1' || ![port,tokenizerPort].includes(Number(target.port))) return deny('socket')
    audit({type:'egress_allowed',host:'127.0.0.1',port:Number(target.port)}); return connect.apply(this,args)
  }
  restore.push(()=>{net.Socket.prototype.connect=connect})
  for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) {
    const original = child[key]; child[key] = () => deny('child_process'); restore.push(()=>{child[key]=original})
  }
  return () => restore.reverse().forEach(f=>f())
}
module.exports={install}
