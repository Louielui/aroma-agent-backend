'use strict'

// Browser views need comparisons and measured evidence, not duplicate sealed
// execution inputs. The canonical store remains unchanged for approval, source
// verification, adoption and rollback.
function adoptionView (row) {
  if (!row) return row
  const { source, accepted, ...visible } = row
  if (source) visible.source = { evidence: source.evidence, hash: source.hash }
  if (accepted) visible.accepted = {
    patchHash: accepted.patchHash, evidenceHash: accepted.evidenceHash,
    ...(accepted.baseline ? { baseline: accepted.baseline } : {})
  }
  return visible
}

module.exports = { adoptionView }
