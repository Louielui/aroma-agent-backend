'use strict'

/**
 * redaction.js — remove what we can recognise, and never claim the rest is clean.
 *
 * ── WHAT THIS IS, STATED PLAINLY ───────────────────────────────────────────
 * This is a BEST-EFFORT HARM-REDUCTION PASS. It is not a guarantee and must never be described
 * as one, in code, in comments, in documentation or on a screen.
 *
 * A password can be any string. `hunter2` is a password and is indistinguishable from a word.
 * A recovery code can look like a phone number. An API key can be pasted with no label at all.
 * Pattern detection catches the shapes it knows and misses everything else, and the things it
 * misses are exactly the ones nobody thought to write a pattern for.
 *
 * THEREFORE THE ARCHIVE IS TREATED AS IF IT CONTAINS SECRETS, always:
 *   . its own directory, its own ACL, Owner-only
 *   . never committed to git
 *   . never added to an existing backup chain without a separate decision
 *
 * If anything downstream ever reasons "the archive is redacted, so it is safe to copy
 * somewhere", that reasoning is wrong and this comment is the reason it is wrong.
 *
 * ── WHY REDACTION HAPPENS BEFORE THE WRITE, NOT AFTER ──────────────────────
 * A secret written to disk and redacted later has still been written to disk. The pass runs on
 * the way in, and the unredacted string is never handed to the writer.
 */

/** What replaces a recognised secret. Fixed, so a reader can grep the archive for it. */
const MARK = '[REDACTED]'

/**
 * Labelled secrets: a key-ish word, a separator, then the value.
 *
 * The value is taken to the end of the line or the closing quote. Deliberately greedy: a
 * password with spaces in it is still a password, and leaving the tail behind would be worse
 * than removing a few extra words.
 */
/**
 * ── WHY THE CHINESE LABELS ARE NOT INSIDE THE \b GROUP ─────────────────────
 * `\b` is defined against [A-Za-z0-9_]. There is no word boundary next to 密, so `\b密碼\b`
 * matches NOTHING — and the first version of this file had exactly that, which meant every
 * Chinese-labelled password went straight to disk while the English ones were caught. A rule
 * that works in one language and silently fails in the other is worse than one that fails in
 * both, because the failing half is invisible.
 *
 * ASCII labels keep their boundaries; CJK labels are matched directly.
 */
const LABELLED = [
  // password / passphrase / passcode, in English and Chinese
  /(?:\b(pass(?:word|phrase|code)?|pwd)\b|(密碼|密码|口令))\s*(?:[:=]|係|是|is)\s*(\S[^\r\n]*)/gi,
  // api keys, tokens, secrets, bearer credentials
  /(?:\b(api[\s_-]?key|apikey|secret[\s_-]?key|secret|token|bearer|auth(?:orization)?|access[\s_-]?token|refresh[\s_-]?token)\b|(密鑰|密钥|金鑰))\s*(?:[:=]|係|是)\s*(\S[^\r\n]*)/gi,
  // cookies and session identifiers
  /(?:\b(cookie|set-cookie|session[\s_-]?id|sessionid|jsessionid|phpsessid)\b|(x_never_matches_x))\s*(?:[:=])\s*(\S[^\r\n]*)/gi,
  // banking / card / payroll credentials
  /(?:\b(card[\s_-]?number|cvv|cvc|pin|iban|sort[\s_-]?code|account[\s_-]?number|routing[\s_-]?number|payroll)\b|(銀行密碼|信用卡|戶口號碼|提款卡密碼))\s*(?:[:=]|係|是)\s*(\S[^\r\n]*)/gi,
  // recovery / backup / seed material
  /(?:\b(recovery[\s_-]?(?:code|key|phrase)|backup[\s_-]?code|seed[\s_-]?phrase|mnemonic|2fa|otp)\b|(一次性密碼|恢復碼|備用碼))\s*(?:[:=]|係|是)\s*(\S[^\r\n]*)/gi,
  // private keys named inline
  /(?:\b(private[\s_-]?key|priv[\s_-]?key|ssh[\s_-]?key)\b|(私鑰|私钥))\s*(?:[:=]|係|是)\s*(\S[^\r\n]*)/gi
]

/**
 * Shapes that are secrets regardless of what they are called — or are called nothing at all.
 * These are the ones a label-based rule would miss entirely, which is most real pastes.
 */
const SHAPES = [
  // PEM blocks, whole
  { name: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'openssh', re: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g },
  // provider-shaped keys
  { name: 'openai', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'google', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // JWTs
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // payment cards: 13-19 digits, optional separators, Luhn-checked below
  { name: 'card', re: /\b(?:\d[ -]?){13,19}\b/g }
]

/** Luhn, so an order number or a long id is not mistaken for a card. */
function isLuhn (digits) {
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/**
 * The Owner's own instruction to not record a turn.
 *
 * Checked on the USER's text only. An assistant reply saying "I won't record that" must not be
 * able to suppress the record — the instruction belongs to the person, not to the model.
 */
const DO_NOT_RECORD = [
  /這段不要記錄/,
  /这段不要记录/,
  /唔好記錄/,
  /不要記錄/,
  /不要记录/,
  /don'?t\s+record\s+this/i,
  /do\s+not\s+record\s+this/i,
  /off\s+the\s+record/i
]

function saysDoNotRecord (text) {
  const s = String(text == null ? '' : text)
  return DO_NOT_RECORD.some((re) => re.test(s))
}

/**
 * Redact a string.
 *
 * @returns {{text: string, hits: string[]}} the redacted text, and the KINDS found — never the
 *   values. A log line naming what it removed would put the secret back.
 */
function redact (input) {
  let text = String(input == null ? '' : input)
  const hits = []

  for (const re of LABELLED) {
    // Two capture groups now: the ASCII label or the CJK one. Whichever matched is the label.
    text = text.replace(re, (m, ascii, cjk) => {
      const label = ascii || cjk
      hits.push('labelled:' + String(label).toLowerCase().replace(/\s+/g, ''))
      return label + ': ' + MARK
    })
  }

  for (const { name, re } of SHAPES) {
    text = text.replace(re, (m) => {
      if (name === 'card') {
        const digits = m.replace(/\D/g, '')
        if (!isLuhn(digits)) return m // an id, not a card
      }
      hits.push('shape:' + name)
      return MARK
    })
  }

  return { text, hits }
}

module.exports = { redact, saysDoNotRecord, MARK, DO_NOT_RECORD }
