// Checks the TTS backend failover in liveTTS.js: fall over only when the primary
// dies before yielding, never mid-stream (that would replay heard audio).
// Run: node test_liveTTS_fallback.js
const assert = require('assert');
const Module = require('module');

function loadDispatcher({ primaryChunks, primaryError, fallbackChunks, fallbackError }) {
  const calls = { fallbackUsed: false };
  const stub = (chunks, error, onCall) => ({
    liveSayHandler: () => {},
    healthHandler: () => {},
    async *generateGeminiTtsChunks() {
      onCall?.();
      for (const c of chunks || []) yield c;
      if (error) throw error;
    },
  });

  const real = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === './liveTTS_gemini') return stub(primaryChunks, primaryError);
    if (id === './liveTTS_vertex') return stub(fallbackChunks, fallbackError, () => { calls.fallbackUsed = true; });
    return real.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('./liveTTS')];
    return { mod: require('./liveTTS'), calls };
  } finally {
    Module.prototype.require = real;
    delete require.cache[require.resolve('./liveTTS')];
  }
}

const collect = async (gen) => {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
};

(async () => {
  const quota = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });

  // 1. Primary 429s before any chunk -> fallback serves the whole turn.
  let { mod, calls } = loadDispatcher({ primaryError: quota, fallbackChunks: ['a', 'b'] });
  assert.deepStrictEqual(await collect(mod.generateGeminiTtsChunks({})), ['a', 'b']);
  assert.strictEqual(calls.fallbackUsed, true);

  // 2. Primary dies AFTER yielding -> rethrow, never restart on the fallback.
  ({ mod, calls } = loadDispatcher({ primaryChunks: ['a'], primaryError: quota, fallbackChunks: ['x'] }));
  await assert.rejects(() => collect(mod.generateGeminiTtsChunks({})), /RESOURCE_EXHAUSTED/);
  assert.strictEqual(calls.fallbackUsed, false, 'must not replay audio the child already heard');

  // 3. Both down -> surface the original error, not the fallback's.
  ({ mod } = loadDispatcher({ primaryError: quota, fallbackError: new Error('GEMINI_API_KEY not set') }));
  await assert.rejects(() => collect(mod.generateGeminiTtsChunks({})), /RESOURCE_EXHAUSTED/);

  // 4. Healthy primary never touches the fallback.
  ({ mod, calls } = loadDispatcher({ primaryChunks: ['a', 'b'], fallbackChunks: ['x'] }));
  assert.deepStrictEqual(await collect(mod.generateGeminiTtsChunks({})), ['a', 'b']);
  assert.strictEqual(calls.fallbackUsed, false);

  console.log('liveTTS failover: 4/4 OK');
})();
