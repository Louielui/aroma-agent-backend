'use strict'
const path=require('node:path')
// The Owner CLI, elevated terminal and desktop must share one lock and evidence
// store. MSIX redirects AppData for desktop processes; never use it for policy.
function promotionDirectory (env=process.env) {
  const profile=env.USERPROFILE
  if(typeof profile!=='string'||!profile.trim()||!path.isAbsolute(profile))throw Error('invalid_promotion_owner_profile')
  return path.join(profile,'.imagine','repository-promotion')
}
module.exports={promotionDirectory}
