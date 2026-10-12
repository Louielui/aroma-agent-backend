'use strict'
const { createHash } = require('node:crypto')
const MAX_IMAGES = 4, MAX_IMAGE_BYTES = 1500000
// Only raster PNG bytes cross the chat wire. The browser decodes JPEG/WebP and
// normalizes them first; paths, URLs, SVG and arbitrary file bodies are absent.
function validateImages(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) throw Error('invalid_images')
  return images.map(dataUrl => {
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_BYTES * 4 / 3 + 24 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw Error('invalid_images')
    const encoded = dataUrl.slice(22), bytes = Buffer.from(encoded, 'base64')
    if (bytes.length < 67 || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('invalid_images')
    let position = 8, width, height, pixels = false, ended = false
    while (position + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(position), type = bytes.toString('ascii', position + 4, position + 8)
      if (length > MAX_IMAGE_BYTES || position + length + 12 > bytes.length) throw Error('invalid_images')
      if (position === 8) {
        if (type !== 'IHDR' || length !== 13) throw Error('invalid_images')
        width = bytes.readUInt32BE(position + 8); height = bytes.readUInt32BE(position + 12)
        if (!width || !height || width > 4096 || height > 4096 || width * height > 16000000) throw Error('invalid_images')
      } else if (type === 'IHDR') throw Error('invalid_images')
      if (type === 'IDAT' && length > 0) pixels = true
      position += length + 12
      if (type === 'IEND') { if (length !== 0 || position !== bytes.length) throw Error('invalid_images'); ended = true; break }
    }
    if (!pixels || !ended) throw Error('invalid_images')
    return { dataUrl, sha256: createHash('sha256').update(bytes).digest('hex'), width, height }
  })
}
module.exports = { validateImages, MAX_IMAGES, MAX_IMAGE_BYTES }
