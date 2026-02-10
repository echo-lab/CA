// liveTTS.js — Backend dispatcher
// Reads TTS_BACKEND env var: "gemini" (default) or "vertex"

const backend = (process.env.TTS_BACKEND || 'gemini').toLowerCase();

let handlers;
if (backend === 'vertex') {
  handlers = require('./liveTTS_vertex');
  console.log('[liveTTS] Using Vertex AI backend');
} else {
  handlers = require('./liveTTS_gemini');
  console.log('[liveTTS] Using Gemini API key backend');
}

function registerLiveTtsRoutes(app) {
  app.post("/live/say", handlers.liveSayHandler);
  app.get("/live/health", handlers.healthHandler);
}

module.exports = { registerLiveTtsRoutes };