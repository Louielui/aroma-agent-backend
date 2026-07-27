'use strict'

/**
 * contextResult.js — the lean, sourced context shape 守燈 uses to cite external
 * reads and to fail honestly. Read-only by nature (it only describes data).
 *
 *   { source, sourceId, title, retrievedAt, originalDate|null, content, link,
 *     trust: 'live' | 'unavailable', error: string|null }
 *
 * `retrievedAt` (asOf) is always present so a citation carries its freshness. On
 * failure the shape is identical but trust='unavailable' + a plain reason, so 守燈
 * can say "目前讀不到" instead of guessing from memory.
 */

function makeContextResult ({ source, sourceId = null, title = null, originalDate = null, content = '', link = null, retrievedAt }) {
  return {
    source,
    sourceId: sourceId == null ? null : String(sourceId),
    title: title == null ? null : String(title),
    retrievedAt,
    originalDate: originalDate == null ? null : String(originalDate),
    content: content == null ? '' : String(content),
    link: link == null ? null : String(link),
    trust: 'live',
    error: null
  }
}

function makeUnavailable ({ source, sourceId = null, reason, retrievedAt }) {
  return {
    source,
    sourceId: sourceId == null ? null : String(sourceId),
    title: null,
    retrievedAt,
    originalDate: null,
    content: '',
    link: null,
    trust: 'unavailable',
    error: reason == null ? 'unavailable' : String(reason)
  }
}

module.exports = { makeContextResult, makeUnavailable }
