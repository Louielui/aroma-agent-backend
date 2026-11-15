'use strict'
// Safe inspection only. Even passing an activation flag is rejected.
if(process.argv.length!==2){console.error('inspection_only');process.exitCode=1}
else console.log(JSON.stringify({state:'NOT_ACTIVATED',plan:require('../../src/localBrain/boundaryAcceptancePlan')},null,2))
