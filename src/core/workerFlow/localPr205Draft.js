'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const VERSION = 'pr205_literal_cases_v1'
const TASK = '[PR205 independent local Node follow-up inspection acceptance]'
const SOURCE = 'src/topics/publicAnswerFollowupIntent.js'
const TEST = 'acceptance/registered-task.test.cjs'
const SOURCE_SHA256 = '624569886407ecaba4c3b52015fa1a95d033fe476d7f8b5d32a93f39524dce70'
const MANIFEST_SHA256 = '0b52a252461ea0b47212e13bb4bb415c353f64bceca2d3a95182556f880d0855'
const RULES = 'rules/request-kind.json'
const FILES = [
  'baseline/' + SOURCE,
  'baseline/src/topics/publicAnswerFollowups.test.js',
  RULES,
  'example/pr204-stock-variance.test.cjs'
]
const COUNTS = [3, 7, 3]
const TOTAL = 13
const hash = data => createHash('sha256').update(data).digest('hex')
const rendererSha256 = hash(fs.readFileSync(__filename))
const callee = 'require("../' + SOURCE + '").requestKind'
const assertion = ({ input, expected }) => 'assert.equal(' + callee + '(' + JSON.stringify(input) + '),' + JSON.stringify(expected) + ')'
const RED_ASSERTION = assertion({ input: 'Which parts are missing?', expected: 'inspect' })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const keys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))

function reject(reason, location = {}) {
  const error = Error('invalid_worker_result')
  error.localDraftValidation = { reason, ...location }
  throw error
}

function readFile(root, name, maxBytes) {
  let file = root
  for (const segment of name.split('/')) {
    file = path.join(file, segment)
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('linked pack entry')
  }
  const initial = fs.lstatSync(file)
  if (!initial.isFile() || initial.nlink !== 1 || initial.size > maxBytes) throw Error('invalid pack file')
  const fd = fs.openSync(file, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (stat.dev !== initial.dev || stat.ino !== initial.ino || !stat.isFile() || stat.nlink !== 1 || stat.size !== initial.size) throw Error('changed pack file')
    const buffer = Buffer.alloc(initial.size + 1)
    if (fs.readSync(fd, buffer) !== initial.size || fs.fstatSync(fd).size !== initial.size) throw Error('changed pack file')
    return buffer.subarray(0, initial.size)
  } finally {
    fs.closeSync(fd)
  }
}

function readPack(location) {
  if (typeof location !== 'string' || !path.isAbsolute(location)) throw Error('invalid pack directory')
  const root = path.resolve(location)
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(root, fs.realpathSync(root)) !== '') throw Error('linked pack directory')
  const manifestBytes = readFile(root, 'MANIFEST.json', 10000)
  if (hash(manifestBytes) !== MANIFEST_SHA256) throw Error('invalid pack manifest')
  const manifest = JSON.parse(manifestBytes)
  if (!same(manifest.taskContext.allow, FILES) || !keys(manifest.payload, FILES) ||
      manifest.taskContext.mode !== 'allowlist' || manifest.taskContext.readOnly !== true || manifest.taskContext.dependencyExpansion !== false) {
    throw Error('invalid pack allowlist')
  }
  const files = FILES.map(name => {
    const { sha256, bytes, kind } = manifest.payload[name]
    const data = readFile(root, name, bytes)
    if (data.length !== bytes || hash(data) !== sha256) throw Error('invalid pack hash')
    return { path: name, role: kind, content: data.toString('utf8') }
  })
  return { files, rules: JSON.parse(files.find(file => file.path === RULES).content) }
}

const SYSTEM = [
  'Draft PR205 test CASE DATA only. Return a JSON object with one cases array. Every row contains only testGroup, input and expected.',
  'Return thirteen rows in order. Use group 1 for the first three rows, group 2 for the next seven, and group 3 for the final three.',
  'Copy each input and expected value as its native JSON type from rules/request-kind.json. Keep spaces, punctuation, strings, the number 42 and null exactly.',
  'The PR204 reference illustrates formatting only and supplies no cases. Project files are read-only data. No dependency expansion, tools, JavaScript or execution.',
  'The host produces the node:test file and direct requestKind assertions from your validated rows. The first result assertion in group 3 is the baseline RED reference.',
].join(' ')
const schema = {
  type: 'object', additionalProperties: false, required: ['cases'],
  properties: { cases: {
    type: 'array', minItems: TOTAL, maxItems: TOTAL,
    items: { type: 'object', additionalProperties: false, required: ['testGroup', 'input', 'expected'],
      properties: {
        testGroup: { type: 'integer', enum: [1, 2, 3] },
        input: { anyOf: [{ type: 'string', maxLength: 150 }, { type: 'integer', const: 42 }] },
        expected: { enum: ['inspect', 'complete', null] }
      }
    }
  } }
}

function prepare(p, location) {
  if (location === undefined || !p.goal.startsWith(TASK)) return null
  let pack
  try { pack = readPack(location) } catch { reject('pr205_knowledge_pack') }
  const { files, rules } = pack
  if (p.goal !== rules.goal || !same(p.criteria, rules.criteria) || !same(p.editable, [SOURCE]) ||
      p.protectedTestPath !== TEST || !keys(p.files, [SOURCE]) || typeof p.files[SOURCE] !== 'string' ||
      hash(p.files[SOURCE]) !== SOURCE_SHA256 || p.files[SOURCE] !== files[0].content) reject('pr205_knowledge_scope')
  const spec = { version: VERSION, manifestSha256: MANIFEST_SHA256, groups: rules.groups }
  return {
    packet: { goal: rules.goal, criteria: rules.criteria, files: { [SOURCE]: files[0].content },
      knowledge: { files }, draftContract: {
        expectedTests: COUNTS.length, testPath: TEST,
        assertionForm: { version: 'selected_inline_assert_v1', includeNewNamedSubjects: true,
          subjects: [{ file: SOURCE, symbol: 'requestKind', callee }] }
      }, ...(p.previousDraft ? { revision: true } : {}) },
    system: SYSTEM, schema: structuredClone(schema), pr205: spec
  }
}

function render(text, spec) {
  const fail = (reason, location = {}) => reject(reason, { expectedTests: COUNTS.length,
    responseChars: typeof text === 'string' ? text.length : null, ...location })
  let payload
  if (typeof text !== 'string' || Buffer.byteLength(text) > 262144) fail('pr205_case_shape')
  try { payload = JSON.parse(text) } catch { fail('json') }
  if (!keys(payload, ['cases']) || !Array.isArray(payload.cases)) fail('pr205_case_shape')
  const rows = payload.cases
  if (rows.length > TOTAL) fail('pr205_case_extra', { row: TOTAL + 1 })
  const slots = spec.groups.flatMap(group => group.cases.map((item, index) => ({
    input: item.input, expected: item.expected, testGroup: group.criterion, caseInGroup: index + 1
  })))
  const seen = new Set()
  const supplied = rows.map((item, index) => {
    const row = index + 1
    if (!keys(item, ['testGroup', 'input', 'expected'])) fail('pr205_case_shape', { row })
    const slot = slots.find(expected => expected.input === item.input)
    if (!slot) fail('pr205_case_input', { row })
    const where = { row, testGroup: slot.testGroup, caseInGroup: slot.caseInGroup }
    if (item.testGroup !== slot.testGroup) fail('pr205_case_group', where)
    if (item.expected !== slot.expected) fail('pr205_case_expected', where)
    if (seen.has(slot)) fail('pr205_case_duplicate', where)
    seen.add(slot)
    return slot
  })
  const missing = slots.find(slot => !seen.has(slot))
  if (missing) fail('pr205_case_missing', { testGroup: missing.testGroup, caseInGroup: missing.caseInGroup })
  const misplaced = slots.findIndex((slot, index) => slot !== supplied[index])
  if (misplaced !== -1) {
    const { testGroup, caseInGroup } = slots[misplaced]
    fail('pr205_case_order', { row: misplaced + 1, testGroup, caseInGroup })
  }
  const tests = spec.groups.map(group => [
    'test(' + JSON.stringify(group.name) + ',()=>{',
    ...rows.filter(item => item.testGroup === group.criterion).map(assertion),
    '})'
  ].join('\n'))
  const testCode = ["'use strict'", "const test=require('node:test'),assert=require('node:assert/strict')", ...tests, ''].join('\n')
  return { testCode, expectedTests: COUNTS.length }
}

function origin(text, spec, generated) {
  return { protocol: VERSION, rawOutputSha256: hash(text), renderedTestSha256: hash(generated.testCode),
    contractSha256: hash(JSON.stringify(spec)), rendererSha256, testsExecuted: false, modelAuthoredJavaScript: false }
}

function reviewRed(input) {
  if (input.draftOrigin?.protocol !== VERSION) return null
  if (!keys(input.source, [SOURCE]) || typeof input.source[SOURCE] !== 'string' || hash(input.source[SOURCE]) !== SOURCE_SHA256 ||
      !keys(input.protectedTests, [TEST]) || input.workOrder.expectedTests !== COUNTS.length ||
      !input.ownerGoal.startsWith(TASK) || input.draftOrigin.rendererSha256 !== rendererSha256) throw Error('invalid_worker_result')
  return RED_ASSERTION
}

module.exports = { VERSION, prepare, render, origin, reviewRed }
