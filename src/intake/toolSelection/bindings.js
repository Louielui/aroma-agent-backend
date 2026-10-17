'use strict'
// A projection of existing Context resources, not another executable registry.
// The host supplies already-authorized services and their current lease verifiers.
const { aromaResources } = require('../../context/aromaContext')
const { calendarResources } = require('../../context/calendarContext')
const { driveResources } = require('../../context/driveContext')
const { validateDriveRequest } = require('../../context/driveContextService')
const { capabilityEntry } = require('../../governance/selfCapability')
const { AROMA_OPERATIONS } = require('../../context/readOperations')

function contextBindings({ aroma, calendar, drive, driveSource }) {
  const sources = [
    { resources: aromaResources(), service: aroma, capability: 'aroma_system.read' },
    { resources: calendarResources(), service: calendar, capability: 'calendar.read' },
    { resources: driveSource ? driveResources(driveSource) : [], service: drive, capability: 'drive.read' }
  ]
  return sources.flatMap(({ resources, service, capability }) => resources.flatMap(resource => {
    const vocabulary = AROMA_OPERATIONS.find(row => row.intentKey === (resource.id === 'aroma.order_planning' ? 'order_planning' : resource.id === 'aroma.invoices' ? 'invoice' : null))
    return Object.entries(resource.operations).map(([operation, spec]) => {
      const identityKey = resource.source === 'calendar' ? 'eventId' : resource.source === 'drive' ? 'fileId' : 'sourceId'
      const args = operation === 'get' ? { [identityKey]: 'required existing source ID; never invent an ID' }
        : operation === 'search' ? { query: 'required nonempty search text, at most 80 characters' } : {}
      if (resource.source === 'calendar' && ['search', 'list'].includes(operation)) args.window = 'today or this_week only; default today, America/Winnipeg'
      if (resource.source === 'drive' && operation === 'list') args.folderId = 'optional existing folder ID within the registered root'
      if (resource.source === 'drive' && operation === 'readMetadata') args.fileId = 'optional existing file ID within the registered root'
      return Object.freeze({
        // Server-owned nominal identity type; never inferred from document prose.
        identity: Object.freeze({ type: resource.source + '/' + resource.id, field: 'sourceId', parameter: identityKey }),
        descriptor: Object.freeze({ id: resource.id + '.' + operation, resource: resource.id, source: resource.source,
          capability, operation, description: [capabilityEntry(capability).label, vocabulary?.label || resource.id,
            operation === 'readMetadata' ? 'Inspect source metadata only' : operation === 'search' ? 'Find matching records' : operation === 'list' ? 'List records in the permitted scope' : 'Read one identified record'].join('; '),
          arguments: args }),
        validate(input) { return resource.source === 'drive' ? validateDriveRequest(operation, input) : spec.params(input) },
        capture() {
          if (!service) throw Error('tool_unavailable')
          if (resource.source === 'drive') return service.captureTaskScope().verify
          if (resource.source === 'calendar') return service.captureAccess()
          service.verify(); return service.verify
        },
        read(actor, input) {
          if (!service) throw Error('tool_unavailable')
          return resource.source === 'aroma_system' ? service.read(actor, resource.id, operation, input) : service.read(actor, operation, input)
        }
      })
    })
  }))
}
module.exports = { contextBindings }
