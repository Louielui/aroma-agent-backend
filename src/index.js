'use strict'

/**
 * index.js — server entry point.
 *
 * Imports the app from app.js and starts the HTTP server.
 * Separated from app.js so tests can import app without binding a port.
 */

const app = require('./app')

const PORT = process.env.PORT || 8081

app.listen(PORT, () => {
  console.log(`[AROMA-HUB] Listening on port ${PORT}`)
  console.log(`[AROMA-HUB] LLM provider: ${process.env.LLM_PROVIDER || 'claude'}`)
  // NEVER log the API key
})
