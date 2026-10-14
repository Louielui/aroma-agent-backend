'use strict'
// Exact Owner-selected read/navigation acceptance profile, not a generic site flag.
function employeeReadProfile(companyId,scope){return companyId===153450&&typeof scope?.url==='string'&&/^https:\/\/app\.7shifts\.com\/company\/153450\/employees(?:\/list)?$/.test(scope.url)}
module.exports={employeeReadProfile}
