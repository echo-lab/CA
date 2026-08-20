// liveTTS.js — Backend dispatcher
// Reads TTS_BACKEND env var: "gemini" (default) or "vertex"

const backend = (process.env.TTS_BACKEND || 'gemini').toLowerCase();

const useVertex = backend === 'vertex';
const handlers = require(useVertex ? './liveTTS_vertex' : './liveTTS_gemini');
const fallback = require(useVertex ? './liveTTS_gemini' : './liveTTS_vertex');
console.log(`[liveTTS] Using ${useVertex ? 'Vertex AI' : 'Gemini API key'} backend`);

// The TTS quota is per-minute per-project per-model, so a burst of turns can 429
// an otherwise healthy backend. The two backends have separate quotas, so failing
// over keeps the turn audible instead of leaving the child with silence.
// Only before the first chunk — mid-stream the child has already heard audio, and
// restarting would replay it.
async function* generateGeminiTtsChunks(opts) {
  let started = false;
  try {
    for await (const chunk of handlers.generateGeminiTtsChunks(opts)) {
      started = true;
      yield chunk;
    }
    return;
  } catch (err) {
    if (started) throw err;
    console.warn(`[liveTTS] ${backend} TTS failed before first chunk (status=${err?.status || 'n/a'}): ${err?.message || err}`);
    try {
      yield* fallback.generateGeminiTtsChunks(opts);
      console.warn('[liveTTS] served this turn from the fallback backend');
      return;
    } catch (fallbackErr) {
      console.warn(`[liveTTS] fallback backend also failed: ${fallbackErr?.message || fallbackErr}`);
      throw err;
    }
  }
}

function registerLiveTtsRoutes(app) {
  app.post("/live/say", handlers.liveSayHandler);
  app.get("/live/health", handlers.healthHandler);
}

module.exports = { registerLiveTtsRoutes, generateGeminiTtsChunks };