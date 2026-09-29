'use strict'
const net = require('node:net')
function publicUrl (value) {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443')) return null
    const h = u.hostname.toLowerCase()
    if (net.isIP(h) || h.includes(':') || !h.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(h)) return null
    return u.href
  } catch (_) { return null }
}
function validTarget (target) {
  return typeof target === 'string' && target.length > 1 && target.length <= 120 && !/[\r\n:@/?#=\\]/.test(target)
}
module.exports = { publicUrl, validTarget }
