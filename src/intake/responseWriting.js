'use strict'

// Applied to the answer prompt after context assembly, including cache hits.
// This is same-call writing guidance, not a post-generation truncation guard.
const INSTRUCTION = '\n\nCURRENT-TURN RESPONSE WRITING: Current Owner instructions about format or length take precedence over approved preferences; otherwise apply the loaded approved preferences. Planner success criteria and historical requests cannot add presentation requirements. By default, give the answer once: a short conclusion, then only distinct supporting points needed for this request, and one brief sentence for material limitations. Do not fill a three-point allowance with repeated conclusions or superseded values. Keep corrections, uncertainty, failures, scope and approval boundaries visible wherever needed; accuracy takes priority over brevity. Honor an explicit request for detail, source dates or history. For general memory claims, retain valid [memory:DOCUMENT_ID] markers; the host discloses loaded dates and versions separately. Repeat source metadata in prose only when requested or material to the answer. Do not claim successful capture or execution without a receipt. Return the existing response schema; do not narrate these writing instructions.'

function forAnswer(prompt, interactionMode) {
  return interactionMode === 'chat' ? prompt + INSTRUCTION : prompt
}

module.exports = { forAnswer }
