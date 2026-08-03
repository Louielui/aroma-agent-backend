'use strict'

/**
 * contextResult.js — the lean, sourced context shape 心燈 uses to cite external
 * reads and to fail honestly. Read-only by nature (it only describes data).
 *
 *   { source, sourceId, title, retrievedAt, originalDate|null, content, link,
 *     trust: 'live' | 'unavailable', error: string|null }
 *
 * `retrievedAt` (asOf) is always present so a citation carries its freshness. On
 * failure the shape is identical but trust='unavailable' + a plain reason, so 心燈
 * can say "目前讀不到" instead of guessing from memory.
 */

/**
 * WHAT KIND OF THING THIS ROW IS, and the FIELDS THAT MEAN SOMETHING.
 *
 * A row used to be a title, a date and a `k=v · k=v` string, which is enough to cite it
 * and nothing else. It was not enough to know what it IS — so four rows out of an item
 * table were rendered as 「確認到 4 項存貨」, a false claim about stock on hand, and the
 * `currentStock` and `unit` the API had actually returned were dropped on the floor
 * because the renderer only knew how to show a title and a date.
 *
 * `entityType` is set by the ADAPTER, from the endpoint it called. A model can choose what
 * to say about a row; it cannot decide that an item record is a stock count.
 * `fields` carries the row's real values, unflattened, so a renderer can show a quantity
 * instead of inferring one from a string.
 */
function makeContextResult ({ source, sourceId = null, title = null, originalDate = null, content = '', link = null, retrievedAt, entityType = null, fields = null }) {
  return {
    source,
    sourceId: sourceId == null ? null : String(sourceId),
    title: title == null ? null : String(title),
    retrievedAt,
    originalDate: originalDate == null ? null : String(originalDate),
    content: content == null ? '' : String(content),
    link: link == null ? null : String(link),
    entityType: entityType == null ? null : String(entityType),
    fields: (fields && typeof fields === 'object' && !Array.isArray(fields)) ? fields : {},
    trust: 'live',
    error: null
  }
}

function makeUnavailable ({ source, sourceId = null, reason, retrievedAt, entityType = null }) {
  return {
    source,
    sourceId: sourceId == null ? null : String(sourceId),
    title: null,
    retrievedAt,
    originalDate: null,
    content: '',
    link: null,
    entityType: entityType == null ? null : String(entityType),
    fields: {},
    trust: 'unavailable',
    error: reason == null ? 'unavailable' : String(reason)
  }
}

/**
 * THE CLOSED SET OF ENTITY TYPES. A row is one of these or it is untyped; there is no
 * free-text kind, because the whole point is that the kind cannot be argued with.
 */
const ENTITY_TYPES = Object.freeze({
  INVENTORY_ITEM: 'inventory_item',
  SUPPLIER: 'supplier',
  INVOICE: 'invoice',
  PURCHASE_ORDER: 'purchase_order',
  DAILY_COUNT: 'daily_count',
  ORDER_SUGGESTION: 'order_suggestion',
  MAIL: 'mail',
  FILE: 'file',
  EVENT: 'event',
  COMMIT: 'commit',
  PULL_REQUEST: 'pull_request',
  THREAD: 'thread'
})

module.exports = { makeContextResult, makeUnavailable, ENTITY_TYPES }
