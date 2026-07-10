'use strict'

/**
 * redlinePolicy.js — RED-LINE policy (condition 7).
 *
 * This module MUST be called before ANY external LLM call.
 * If a message matches any red-line class, it is NEVER sent to Claude
 * or any external model under any circumstances.
 *
 * Red-line classes (per task spec):
 *   - Banking / TD / account numbers
 *   - CRA / Manitoba filings
 *   - SIN (Social Insurance Number)
 *   - Passwords / secrets / API keys
 *   - Credit card numbers
 *
 * Returns { blocked: true, blocked_reason, matchedClass } if matched,
 * or { blocked: false } if clean.
 */

/**
 * Each entry: { id, label, patterns: RegExp[] }
 * Patterns are intentionally broad — false positives are safe; false negatives are not.
 */
const RED_LINE_CLASSES = [
  {
    id: 'sin',
    label: 'SIN (Social Insurance Number)',
    patterns: [
      /\bsin\b/i,
      /social\s+insurance\s+number/i,
      /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/,   // 9-digit SIN pattern
    ]
  },
  {
    id: 'banking',
    label: 'Banking / TD / account numbers',
    patterns: [
      /\btd\s+bank\b/i,
      /\btd\b.*\baccount\b/i,
      /\bbank\s+account\b/i,
      /\baccount\s+number\b/i,
      /\btransit\s+number\b/i,
      /\binstitution\s+number\b/i,
      /\brouting\s+number\b/i,
      /\biban\b/i,
      /\bswift\b/i,
      /\b\d{5,17}\b.*\b(account|acct|banking)\b/i,
    ]
  },
  {
    id: 'cra',
    label: 'CRA / Manitoba filings',
    patterns: [
      /\bcra\b/i,
      /canada\s+revenue\s+agency/i,
      /\bt1\b|\bt2\b|\bt4\b|\bt5\b/i,       // CRA form codes
      /\btax\s+return\b/i,
      /\bnotice\s+of\s+assessment\b/i,
      /\bmanit?oba.*tax\b/i,
      /\bmanit?oba.*filing\b/i,
      /\bprovincial.*filing\b/i,
      /\bbusiness\s+number\b/i,              // CRA BN
      /\b\d{9}\s*RT\d{4}\b/i,               // CRA BN format
    ]
  },
  {
    id: 'credit_card',
    label: 'Credit card numbers',
    patterns: [
      // Visa, Mastercard, Amex, Discover patterns (Luhn not checked — broad match is safer)
      /\b4[0-9]{12}(?:[0-9]{3})?\b/,        // Visa
      /\b5[1-5][0-9]{14}\b/,                // Mastercard
      /\b3[47][0-9]{13}\b/,                 // Amex
      /\b6(?:011|5[0-9]{2})[0-9]{12}\b/,   // Discover
      /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/, // spaced/dashed 16-digit
      /\bcredit\s+card\s+number\b/i,
      /\bcvv\b|\bcvc\b/i,
    ]
  },
  {
    id: 'password_secret',
    label: 'Passwords / secrets / API keys',
    patterns: [
      /\bpassword\b/i,
      /\bpasswd\b/i,
      /\bapi[_\s-]?key\b/i,
      /\bsecret[_\s-]?key\b/i,
      /\baccess[_\s-]?token\b/i,
      /\bprivate[_\s-]?key\b/i,
      /\bauth[_\s-]?token\b/i,
      /\bbearer\s+[a-zA-Z0-9\-._~+/]+=*/i, // Bearer token pattern
      /\bsk-[a-zA-Z0-9]{20,}\b/,            // OpenAI-style key
      /\bANTHROPIC_API_KEY\b/i,
      /\bghp_[a-zA-Z0-9]{36}\b/,            // GitHub PAT
    ]
  }
]

/**
 * Checks a message against all red-line patterns.
 *
 * @param {string} message — the raw user message
 * @returns {{ blocked: boolean, blocked_reason?: string, matchedClass?: string }}
 */
function checkRedLine (message) {
  if (typeof message !== 'string') {
    return { blocked: false }
  }

  for (const cls of RED_LINE_CLASSES) {
    for (const pattern of cls.patterns) {
      if (pattern.test(message)) {
        return {
          blocked: true,
          blocked_reason: `Message matched red-line class: ${cls.label}. ` +
            `This message was NOT sent to any external model and has been recorded locally only.`,
          matchedClass: cls.id
        }
      }
    }
  }

  return { blocked: false }
}

module.exports = { checkRedLine, RED_LINE_CLASSES }
