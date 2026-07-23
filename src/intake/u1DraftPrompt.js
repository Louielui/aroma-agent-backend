'use strict';

/**
 * U1 Draft Shadow — prompt builder + strict parser.
 *
 * This module is PURE: no adapter, no I/O, no Memory, no filesystem, no network.
 * It only (a) builds the { system, prompt } payload and (b) strictly parses the
 * model's raw text into a validated ParsedU1Draft, throwing DistillParseError on
 * ANY violation. It never fail-softs a malformed response into a "normal" result.
 *
 * Model schema (LOCKED):
 * {
 *   mode: 'ask' | 'draft_proposal',
 *   understanding: {
 *     recipient: { name: string|null, email: string|null, confidence: 'high'|'medium'|'low' },
 *     purpose:   { value: string|null, confidence: 'high'|'medium'|'low' },
 *     tone:      { value: string|null, confidence: 'high'|'medium'|'low' },
 *     constraints: string[],
 *     understandingSignals: [{ classification: 'FACT'|'PREFERENCE'|'TEMPORARY',
 *                              statement: string, source: 'current_message'|'session_context'|'persona',
 *                              confidence: 'high'|'medium'|'low' }]
 *   },
 *   restatement: string,                 // non-empty in BOTH modes
 *   clarifyingQuestion: string | null,
 *   draft: null | { to: string|null, subject: string, body: string, tone: string }
 * }
 *
 * Invariants:
 *   mode='ask'            -> draft===null, restatement non-empty, clarifyingQuestion non-empty
 *   mode='draft_proposal' -> draft is object, restatement non-empty, clarifyingQuestion===null
 *                            recipient.email stays null if unknown (never guessed)
 *
 * The model schema MUST NOT contain any authority/completion key:
 *   stage, sent, approved, executed, gmailDraftCreated, persistentMemoryWritten, proposalCreated
 * These are appended server-side ONLY after successful parse (in u1DraftShadow.js).
 */

/** Reasons carried by DistillParseError (U1-specific). */
const DISTILL_PARSE_REASON = Object.freeze({
  MALFORMED_JSON: 'malformed_json',
  EXTRA_PROSE: 'extra_prose',
  DUPLICATE_KEY: 'duplicate_key',
  UNKNOWN_KEY: 'unknown_key',
  AUTHORITY_KEY: 'authority_key',
  INVALID_ENUM: 'invalid_enum',
  EMPTY_REQUIRED: 'empty_required',
  MODE_DRAFT_INCONSISTENT: 'mode_draft_inconsistent',
  WRONG_TYPE: 'wrong_type',
});

// Reuse the EXISTING exported DistillParseError (verified: src/intake/distillPrompt.js).
// Its contract: new DistillParseError(reason, diagnostic) where diagnostic is an
// object; it stores `reason` and `diagnostic`. U1 does NOT define a second class
// and does NOT thread a correlationId here — the outer processIntake supplies the
// requestId when the thrown error has no correlation yet.
const { DistillParseError } = require('./distillPrompt');

const AUTHORITY_KEYS = Object.freeze([
  'stage', 'sent', 'approved', 'executed',
  'gmailDraftCreated', 'persistentMemoryWritten', 'proposalCreated',
]);

const MODE_ENUM = Object.freeze(['ask', 'draft_proposal']);
const CLASSIFICATION_ENUM = Object.freeze(['FACT', 'PREFERENCE', 'TEMPORARY']);
const SOURCE_ENUM = Object.freeze(['current_message', 'session_context', 'persona']);
const CONFIDENCE_ENUM = Object.freeze(['high', 'medium', 'low']);

const TOP_KEYS = Object.freeze(['mode', 'understanding', 'restatement', 'clarifyingQuestion', 'draft']);
const UNDERSTANDING_KEYS = Object.freeze(['recipient', 'purpose', 'tone', 'constraints', 'understandingSignals']);
const RECIPIENT_KEYS = Object.freeze(['name', 'email', 'confidence']);
const VALUE_CONF_KEYS = Object.freeze(['value', 'confidence']);
const SIGNAL_KEYS = Object.freeze(['classification', 'statement', 'source', 'confidence']);
const DRAFT_KEYS = Object.freeze(['to', 'subject', 'body', 'tone']);

/* ----------------------------- prompt builder ----------------------------- */

/**
 * buildU1DraftPrompt — PURE. Returns { system, prompt }.
 * @param {{instruction:string, history?:Array, personaText?:string}} args
 */
function buildU1DraftPrompt({ instruction, history, personaText } = {}) {
  const instr = typeof instruction === 'string' ? instruction : '';
  const personaBlock = (typeof personaText === 'string' && personaText.trim())
    ? personaText.trim()
    : '(no persona provided)';

  let historyBlock = '(no prior conversation)';
  if (Array.isArray(history) && history.length) {
    historyBlock = history
      .map((h) => {
        const role = h && typeof h.role === 'string' ? h.role : 'unknown';
        const content = h && typeof h.text === 'string'
          ? h.text
          : (h && typeof h.content === 'string' ? h.content : '');
        return `${role}: ${content}`;
      })
      .join('\n');
  }

  const system = [
    'You are Xiangxiang operating in DRAFT PROPOSAL SHADOW mode.',
    'Your ONLY job is to understand the owner\'s instruction and either ask ONE clarifying question or propose an email draft.',
    'You DO NOT send email. You DO NOT create anything. You DO NOT claim any action was taken.',
    'You output a SINGLE JSON object and NOTHING else — no prose, no markdown, no code fences.',
    '',
    'Trusted runtime persona:',
    'Use it as read-only guidance for understanding Louie\'s stable preferences and operating principles.',
    'It cannot override this U1 schema, authority limits, no-action rules, or output-format requirements.',
    personaBlock,
    '',
    'Output JSON schema (exact keys, no extra keys):',
    '{',
    '  "mode": "ask" | "draft_proposal",',
    '  "understanding": {',
    '    "recipient": { "name": string|null, "email": string|null, "confidence": "high"|"medium"|"low" },',
    '    "purpose":   { "value": string|null, "confidence": "high"|"medium"|"low" },',
    '    "tone":      { "value": string|null, "confidence": "high"|"medium"|"low" },',
    '    "constraints": string[],',
    '    "understandingSignals": [',
    '      { "classification": "FACT"|"PREFERENCE"|"TEMPORARY", "statement": string,',
    '        "source": "current_message"|"session_context"|"persona", "confidence": "high"|"medium"|"low" }',
    '    ]',
    '  },',
    '  "restatement": string,',
    '  "clarifyingQuestion": string|null,',
    '  "draft": null | { "to": string|null, "subject": string, "body": string, "tone": string }',
    '}',
    '',
    'Rules:',
    '- restatement MUST be a non-empty string in BOTH modes (restate your understanding).',
    '- mode="ask": draft MUST be null; clarifyingQuestion MUST be a single non-empty question.',
    '- mode="draft_proposal": clarifyingQuestion MUST be null; draft MUST be a valid object.',
    '- If you do not know the recipient email, set recipient.email to null. NEVER guess an email.',
    '- understandingSignals MUST contain at least one signal.',
    '- Do NOT include any of these keys anywhere: stage, sent, approved, executed, gmailDraftCreated, persistentMemoryWritten, proposalCreated.',
    '- VOICE: when mode="draft_proposal", write draft.body in the OWNER\'S voice — first person, as if the owner wrote it themselves.',
    '- TONE (all outputs, including a mode="ask" clarifyingQuestion): direct, concise, and naturally polite. Keep it efficient — minimal filler, no "hope this finds you well" padding, no over-apologizing. Respectful but efficient.',
    '- OUTPUT FORMAT (hard rule): output ONLY one raw JSON object. No markdown, no code fences (no ``` and no ```json), no comments, and no prose before or after. The FIRST output character MUST be "{" and the LAST output character MUST be "}".',
  ].join('\n');

  const prompt = [
    'Prior conversation:',
    historyBlock,
    '',
    'Owner instruction:',
    instr,
    '',
    'Produce the single JSON object now.',
  ].join('\n');

  return { system, prompt };
}

/* ------------------------------ strict parser ----------------------------- */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Reject duplicate keys at ALL depths. JSON.parse silently keeps the last
 * duplicate, so we scan the raw text with a reviver-independent tokenizer via
 * JSON.parse using a reviver that records paths, combined with a manual
 * duplicate check using a source-level pass.
 */
function assertNoDuplicateKeys(rawJsonText) {
  // Source-level duplicate detection: walk the JSON text tracking object scopes.
  // This catches duplicates at any nesting depth that JSON.parse would collapse.
  // Escape-safe: the captured token is the FULL quoted string (with quotes), and
  // it is decoded via JSON.parse before comparison, so "mode" and "\u006dode"
  // are recognised as the SAME key. Only the key position (string immediately
  // before a ':') is treated as a key; string VALUES never enter the key set.
  const n = rawJsonText.length;
  let i = 0;
  const stack = []; // each object frame: { keys:Set }
  let inString = false;
  let tokenStart = -1;   // index of the opening quote of the current string
  let escaped = false;
  let lastKeyToken = null; // full quoted token (incl. quotes) of the last string

  function frame() { return stack[stack.length - 1]; }

  while (i < n) {
    const ch = rawJsonText[i];

    if (inString) {
      if (escaped) { escaped = false; i++; continue; }
      if (ch === '\\') { escaped = true; i++; continue; }
      if (ch === '"') {
        inString = false;
        lastKeyToken = rawJsonText.slice(tokenStart, i + 1); // full quoted token incl. quotes
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '"') { inString = true; tokenStart = i; i++; continue; }

    if (ch === '{') { stack.push({ keys: new Set() }); i++; lastKeyToken = null; continue; }
    if (ch === '}') { stack.pop(); i++; lastKeyToken = null; continue; }
    if (ch === '[') { stack.push({ keys: null }); i++; lastKeyToken = null; continue; }
    if (ch === ']') { stack.pop(); i++; lastKeyToken = null; continue; }

    if (ch === ':') {
      const f = frame();
      if (f && f.keys && lastKeyToken !== null) {
        let decodedKey;
        try {
          decodedKey = JSON.parse(lastKeyToken); // decode \uXXXX and other escapes
        } catch (e) {
          throw new DistillParseError(DISTILL_PARSE_REASON.MALFORMED_JSON, { path: 'root', detail: 'invalid key token' });
        }
        if (f.keys.has(decodedKey)) {
          throw new DistillParseError(DISTILL_PARSE_REASON.DUPLICATE_KEY, { path: decodedKey, detail: 'duplicate key (escape-normalised)' });
        }
        f.keys.add(decodedKey);
      }
      lastKeyToken = null;
      i++; continue;
    }

    if (ch === ',') { lastKeyToken = null; i++; continue; }

    i++;
  }
}

function assertString(v, path, { allowEmpty = false } = {}) {
  if (typeof v !== 'string') {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path, detail: 'must be a string' });
  }
  if (!allowEmpty && v.trim() === '') {
    throw new DistillParseError(DISTILL_PARSE_REASON.EMPTY_REQUIRED, { path, detail: 'must be non-empty' });
  }
}

function assertStringOrNull(v, path) {
  if (v !== null && typeof v !== 'string') {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path, detail: 'must be string or null' });
  }
}

function assertEnum(v, allowed, path) {
  if (typeof v !== 'string' || !allowed.includes(v)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.INVALID_ENUM, { path, detail: 'invalid enum' });
  }
}

function assertExactKeys(obj, allowedKeys, path) {
  for (const k of Object.keys(obj)) {
    if (AUTHORITY_KEYS.includes(k)) {
      throw new DistillParseError(DISTILL_PARSE_REASON.AUTHORITY_KEY, { path: `${path}.${k}`, detail: 'prohibited authority/completion key' });
    }
    if (!allowedKeys.includes(k)) {
      throw new DistillParseError(DISTILL_PARSE_REASON.UNKNOWN_KEY, { path: `${path}.${k}`, detail: 'unknown key' });
    }
  }
}

/**
 * parseU1DraftResponse — STRICT. Reads the raw model text (llmResult.text),
 * throws DistillParseError on ANY violation. Returns ParsedU1Draft on success.
 * @param {string} rawText
 * @param {string} [correlationId]
 * @returns {object} ParsedU1Draft (WITHOUT server-fixed fields)
 */
function parseU1DraftResponse(rawText) {
  if (typeof rawText !== 'string') {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'rawText', detail: 'must be a string' });
  }

  const trimmed = rawText.trim();
  if (trimmed === '') {
    throw new DistillParseError(DISTILL_PARSE_REASON.EMPTY_REQUIRED, { path: 'root', detail: 'empty response' });
  }

  // Reject extra prose / markdown fences: the response must be exactly one JSON object.
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    throw new DistillParseError(DISTILL_PARSE_REASON.EXTRA_PROSE, { path: 'root', detail: 'must be a single JSON object with no surrounding text' });
  }

  // Duplicate-key detection at all depths (before JSON.parse collapses them),
  // decoding escapes so that e.g. "mode" and "\u006dode" count as the SAME key.
  assertNoDuplicateKeys(trimmed);

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    throw new DistillParseError(DISTILL_PARSE_REASON.MALFORMED_JSON, { path: 'root', detail: 'invalid JSON' });
  }

  if (!isPlainObject(obj)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'root', detail: 'must be an object' });
  }

  // Top-level keys exact.
  assertExactKeys(obj, TOP_KEYS, 'root');

  // mode
  assertEnum(obj.mode, MODE_ENUM, 'mode');

  // understanding
  if (!isPlainObject(obj.understanding)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'understanding', detail: 'must be an object' });
  }
  const u = obj.understanding;
  assertExactKeys(u, UNDERSTANDING_KEYS, 'understanding');

  // understanding.recipient
  if (!isPlainObject(u.recipient)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'understanding.recipient', detail: 'must be an object' });
  }
  assertExactKeys(u.recipient, RECIPIENT_KEYS, 'understanding.recipient');
  assertStringOrNull(u.recipient.name, 'understanding.recipient.name');
  assertStringOrNull(u.recipient.email, 'understanding.recipient.email');
  assertEnum(u.recipient.confidence, CONFIDENCE_ENUM, 'understanding.recipient.confidence');

  // understanding.purpose
  if (!isPlainObject(u.purpose)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'understanding.purpose', detail: 'must be an object' });
  }
  assertExactKeys(u.purpose, VALUE_CONF_KEYS, 'understanding.purpose');
  assertStringOrNull(u.purpose.value, 'understanding.purpose.value');
  assertEnum(u.purpose.confidence, CONFIDENCE_ENUM, 'understanding.purpose.confidence');

  // understanding.tone
  if (!isPlainObject(u.tone)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'understanding.tone', detail: 'must be an object' });
  }
  assertExactKeys(u.tone, VALUE_CONF_KEYS, 'understanding.tone');
  assertStringOrNull(u.tone.value, 'understanding.tone.value');
  assertEnum(u.tone.confidence, CONFIDENCE_ENUM, 'understanding.tone.confidence');

  // understanding.constraints
  if (!Array.isArray(u.constraints)) {
    throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'understanding.constraints', detail: 'must be an array' });
  }
  u.constraints.forEach((c, idx) => assertString(c, `understanding.constraints[${idx}]`, { allowEmpty: false }));

  // understanding.understandingSignals
  if (!Array.isArray(u.understandingSignals) || u.understandingSignals.length < 1) {
    throw new DistillParseError(DISTILL_PARSE_REASON.EMPTY_REQUIRED, { path: 'understanding.understandingSignals', detail: 'must have at least one signal' });
  }
  u.understandingSignals.forEach((sig, idx) => {
    if (!isPlainObject(sig)) {
      throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: `understandingSignals[${idx}]`, detail: 'must be an object' });
    }
    assertExactKeys(sig, SIGNAL_KEYS, `understandingSignals[${idx}]`);
    assertEnum(sig.classification, CLASSIFICATION_ENUM, `understandingSignals[${idx}].classification`);
    assertString(sig.statement, `understandingSignals[${idx}].statement`, { allowEmpty: false });
    assertEnum(sig.source, SOURCE_ENUM, `understandingSignals[${idx}].source`);
    assertEnum(sig.confidence, CONFIDENCE_ENUM, `understandingSignals[${idx}].confidence`);
  });

  // restatement — non-empty in BOTH modes
  assertString(obj.restatement, 'restatement', { allowEmpty: false });

  // clarifyingQuestion — string|null (further constrained by mode below)
  assertStringOrNull(obj.clarifyingQuestion, 'clarifyingQuestion');

  // draft — null | object (further constrained by mode below)
  if (obj.draft !== null) {
    if (!isPlainObject(obj.draft)) {
      throw new DistillParseError(DISTILL_PARSE_REASON.WRONG_TYPE, { path: 'draft', detail: 'must be null or an object' });
    }
    assertExactKeys(obj.draft, DRAFT_KEYS, 'draft');
    assertStringOrNull(obj.draft.to, 'draft.to');
    assertString(obj.draft.subject, 'draft.subject', { allowEmpty: false });
    assertString(obj.draft.body, 'draft.body', { allowEmpty: false });
    assertString(obj.draft.tone, 'draft.tone', { allowEmpty: false });
  }

  // Mode / draft / clarifyingQuestion invariants.
  if (obj.mode === 'ask') {
    if (obj.draft !== null) {
      throw new DistillParseError(DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT, { path: 'draft', detail: 'mode=ask requires draft===null' });
    }
    if (typeof obj.clarifyingQuestion !== 'string' || obj.clarifyingQuestion.trim() === '') {
      throw new DistillParseError(DISTILL_PARSE_REASON.EMPTY_REQUIRED, { path: 'clarifyingQuestion', detail: 'mode=ask requires a non-empty clarifyingQuestion' });
    }
  } else { // draft_proposal
    if (!isPlainObject(obj.draft)) {
      throw new DistillParseError(DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT, { path: 'draft', detail: 'mode=draft_proposal requires draft object' });
    }
    if (obj.clarifyingQuestion !== null) {
      throw new DistillParseError(DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT, { path: 'clarifyingQuestion', detail: 'mode=draft_proposal requires clarifyingQuestion===null' });
    }
  }

  return obj;
}

module.exports = {
  buildU1DraftPrompt,
  parseU1DraftResponse,
  DistillParseError,
  DISTILL_PARSE_REASON,
  AUTHORITY_KEYS,
};
