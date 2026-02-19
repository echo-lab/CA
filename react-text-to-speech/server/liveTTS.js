function buildNaturalLanguagePrompt({ text, emotion, role }) {
  if (role === "Child") {
    return `You are a 5-year-old child reading a children's story. Speak with an extremely high-pitched, squeaky, youthful voice — as high as a young kindergartener naturally sounds. Your voice should be noticeably higher than a typical adult or older child. Be full of enthusiasm and excitement. Use a playful, innocent tone. Say the following: ${text}`;
  }
  return `Say the following in a clear, natural, conversational way suitable for narrating a children's story: ${text}`;
}

function extractAudioBase64FromCandidates(response) {
  const cands = response?.candidates;
  if (!Array.isArray(cands) || !cands.length) return null;
  const parts = cands[0]?.content?.parts || [];
  for (const p of parts) {
    if (p?.inline_data?.data) return p.inline_data.data;
    if (p?.inlineData?.data) return p.inlineData.data;
  }
  return null;
}

async function withRetries(fn, { attempts = 2, delayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.error?.code;
      const is5xx = status >= 500 && status < 600;
      if (!is5xx || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

const { CFG, buildKey, readIfFresh, writeAtomically, normalizeText, normEmotion } = require('./cache/ttsCache');
const { oncePerKey } = require('./cache/inflight');

async function liveSayHandler(req, res) {
  try {
    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    
    if (!PROJECT_ID) {
      return res.status(500).json({ message: "VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT not set" });
    }

    let { text, voiceName, emotion, model: modelFromReq, speechRate, role } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: 'Missing or invalid "text"' });
    }

    // Normalize inputs
    let textNorm = normalizeText(text);
    textNorm = textNorm.replace(/\bZoe\b/g, "Zoey");
    
    // Build prompt
    const emo = normEmotion(emotion);
    const ttsPrompt = buildNaturalLanguagePrompt({ 
      text: textNorm, 
      emotion: emo, 
      role 
    });
    
    const model = modelFromReq || process.env.VERTEX_MODEL || "gemini-2.5-flash-tts";

    if (/gemini-.*live/i.test(model)) {
      return res.status(400).json({
        message: `Model "${model}" is a Live (WebSocket) model. Use a TTS model.`,
      });
    }

    const format = 'wav';
    const sampleRate = CFG.sampleRate;

    const bypass =
      String(req.headers[CFG.bypassHeader] || '').toLowerCase() === '1' ||
      req.query.nocache === '1';

    const { key, base, fields } = buildKey({
      text: ttsPrompt,
      model,
      voiceName,
      emotion: emo,
      format,
      sampleRate,
      speechRate,
      role,
    });

    // Try cache
    if (!bypass) {
      const hit = await readIfFresh(base);
      if (hit.state === 'HIT') {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-TTS-Cache', 'HIT');
        res.setHeader('ETag', `"${key}"`);
        console.log(`[live/say][cache] HIT key=${key.slice(0,8)} model=${model} voice=${voiceName||'(default)'}`);
        return res.status(200).send(hit.buf);
      }
      if (hit.state === 'STALE') {
        console.log(`[live/say][cache] STALE key=${key.slice(0,8)} → regenerate`);
      } else {
        console.log(`[live/say][cache] MISS key=${key.slice(0,8)}`);
      }
    } else {
      console.log(`[live/say][cache] BYPASS key=${key.slice(0,8)}`);
    }

    // Generate audio
    const wavBuf = await oncePerKey(key, async () => {
      const genaiMod = await import("@google/genai");
      const { GoogleGenAI } = genaiMod;
      const wavefileMod = await import("wavefile");
      const WaveFile = wavefileMod.WaveFile || (wavefileMod.default && wavefileMod.default.WaveFile);

      // Initialize client
      const client = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
      });

      // Select voice
      const voiceToUse = voiceName || 'Kore';
      
      const config = {
        speechConfig: {
          languageCode: "en-US",
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceToUse
            }
          }
        }
      };

      // Add speaking rate if provided
      if (speechRate != null) {
        config.speechConfig.speakingRate = speechRate;
      }

      console.log(`[vertex-tts] Generating with model=${model}, voice=${voiceToUse}`);
      console.log(`[vertex-tts] Prompt: "${ttsPrompt.substring(0, 100)}..."`);

      // Call API
      const response = await withRetries(
        () => client.models.generateContent({
          model: model,
          contents: ttsPrompt,
          config: config
        }),
        { attempts: 3, delayMs: 500 }
      );

      const b64 = extractAudioBase64FromCandidates(response);
      if (!b64) {
        console.error("Full response:", JSON.stringify(response, null, 2));
        throw new Error("No audio received from TTS model.");
      }

      const pcm = Buffer.from(b64, "base64");
      const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

      const wav = new WaveFile();
      wav.fromScratch(1, sampleRate, "16", int16);
      const buf = Buffer.from(wav.toBuffer());

      console.log(`[live/say][tts] SUCCESS model=${model} voice=${voiceToUse} emotion=${emo} bytes=${pcm.byteLength}`);
      return buf;
    });

    if (!bypass) {
      const meta = {
        createdAt: Date.now(),
        key,
        ...fields,
        bytes: wavBuf.byteLength,
      };
      writeAtomically(base, wavBuf, meta)
        .then(() => {
          console.log(`[tts cache] write SUCCESS key=${key.slice(0,8)}`);
        })
        .catch(e => {
          console.error('[tts cache] write failed:', e.message);
        });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-TTS-Cache', bypass ? 'BYPASS' : 'MISS');
    res.setHeader('ETag', `"${key}"`);
    return res.status(200).send(wavBuf);

  } catch (err) {
    const status = err?.status || err?.error?.code || 500;
    const message = err?.message || err?.error?.message || String(err);
    console.error("Error in /live/say [vertex-ai]:", status, err);
    res.status(status).json({ message, error: err?.error || {} });
  }
}

async function healthHandler(req, res) {
  const ok = Boolean(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT);
  res.json({
    ok,
    defaultModel: process.env.VERTEX_MODEL || "gemini-2.5-flash-tts",
    mode: "vertex-gemini-tts",
    location: process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
  });
}

function registerLiveTtsRoutes(app) {
  app.post("/live/say", liveSayHandler);
  app.get("/live/health", healthHandler);
}

module.exports = { registerLiveTtsRoutes, liveSayHandler, healthHandler };