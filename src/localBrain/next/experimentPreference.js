
'use strict'
const path = require('node:path')
const { createModelCenter } = require('../../modelCenter/service')
const names = Object.freeze({ default: 'local:qwen3.5:9b', B: 'local:qwen3.8-flash-next-iq3_s', P: 'local:qwen3.8:27b' })
const available = Object.values(names)
const effort = 'auto'

function preference (root) {
  const center = createModelCenter({
    dataDir: path.join(root, 'interface-preference'),
    localProfile: true,
    selectionPolicy: {
      initialBrain: { model: names.default, effort },
      validChoice: value => available.includes(value?.model) && value.effort === effort
    },
    catalogue: async () => ({ models: available.map(model => ({ model, available: true, supportsEffort: false })) })
  })
  function project (data) {
    return { selected: Object.keys(names).find(key => names[key] === data.brain.model), revision: data.revision }
  }
  return {
    read: () => project(center.read()),
    async save (body) {
      if (!body || Object.keys(body).sort().join() !== 'revision,selected' ||
          !Object.hasOwn(names, body.selected) || !Number.isInteger(body.revision) || body.revision < 0) {
        throw Error('experiment_input_invalid')
      }
      return project(await center.saveBrain({ model: names[body.selected], effort, revision: body.revision }))
    }
  }
}

module.exports = { preference }
