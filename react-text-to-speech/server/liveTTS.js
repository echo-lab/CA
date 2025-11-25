function buildSystemInstructionText({ emotion, role }) {
  const tone = (emotion && String(emotion).trim()) || "neutral";
  
  // Check if the role is "Child" and provide child-specific instructions
  if (role === "Child") {
    console.log("Child prompt");
    return `You are a young, energetic child. Read this text in a youthful, and lively voice suitable for a kid character in a story. Use a higher pitch and speak with childlike enthusiasm and energy.`;
  }
  
  // Default instruction for other roles
  return `Read in a ${tone} tone suitable for a children's story.`;
}

function asSystemContent(text) {
  return { role: "system", parts: [{ text }] };
}

function extractAudioBase64FromCandidates(response) {
  const cands = response?.candidates;
  if (!Array.isArray(cands) || !cands.length) return null;
  const parts = cands[0]?.content?.parts || [];
  for (const p of parts) {
    if (p?.inlineData?.data && p?.inlineData?.mimeType?.startsWith("audio/")) return p.inlineData.data;
    if (p?.audio?.data) return p.audio.data;
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

const { CFG, buildKey, readIfFresh, writeAtomically, normalizeText, normEmotion, pathsFor } = require('./cache/ttsCache');
const { oncePerKey } = require('./cache/inflight');

async function liveSayHandler(req, res) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ message: "GEMINI_API_KEY not set" });

    let { text, voiceName, emotion, model: modelFromReq, speechRate, role } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: 'Missing or invalid "text"' });
    }

    // Normalize inputs
    let textNorm = normalizeText(text);
    textNorm = textNorm.replace(/\bZoe\b/g, "Zoey"); // correct speaking issue to avoid confusion
    console.log("TEXT AFTER NORMALIZE:", textNorm); 
    const emo = normEmotion(emotion);

    const requestedModel = modelFromReq && String(modelFromReq).trim();
    const model = requestedModel || process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-preview-tts";

    if (/gemini-.*live/i.test(model)) {
      return res.status(400).json({
        message: `Model "${model}" is a Live (WebSocket) model. Use a TTS model (e.g., "gemini-2.5-flash-preview-tts") with this endpoint.`,
      });
    }

    const format = 'wav';
    const sampleRate = CFG.sampleRate;

    const bypass =
      String(req.headers[CFG.bypassHeader] || '').toLowerCase() === '1' ||
      req.query.nocache === '1';

    const { key, base, fields } = buildKey({
      text: textNorm,
      model,
      voiceName,
      emotion: emo,
      format,
      sampleRate,
      speechRate,
      role,
    });

    // Try cache unless bypassed
    if (!bypass) {
      const hit = await readIfFresh(base);
      if (hit.state === 'HIT') {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-TTS-Cache', 'HIT');
        res.setHeader('ETag', `"${key}"`);
        console.log(`[live/say][cache] HIT key=${key.slice(0,8)} model=${model} voice=${voiceName||'(default)'} emotion=${emo} role=${role||'(none)'} bytes=${hit.buf.byteLength}`);
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

    // Produce (deduplicated) on MISS/BYPASS
    const wavBuf = await oncePerKey(key, async () => {
      const genaiMod = await import("@google/genai");
      const { GoogleGenAI } = genaiMod;
      const wavefileMod = await import("wavefile");
      const WaveFile = wavefileMod.WaveFile || (wavefileMod.default && wavefileMod.default.WaveFile);

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const systemInstructionText = buildSystemInstructionText({ emotion: emo, role });

      const speechConfig =
        speechRate != null
          ? {
              ...(voiceName ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } : {}),
              speakingRate: speechRate,
            }
          : (voiceName ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } : undefined);

      const reqBody = {
        model,
        contents: [{ parts: [{ text: textNorm }]}],
        systemInstruction: asSystemContent(systemInstructionText),
        config: {
          responseModalities: ["AUDIO"],
          ...(speechConfig ? { speechConfig } : {}),
        },
      };

      const response = await withRetries(
        () => ai.models.generateContent(reqBody),
        { attempts: 3, delayMs: 500 } // Increased retries
      );

      const b64 = extractAudioBase64FromCandidates(response);
      if (!b64) throw new Error("No audio received from TTS model.");

      const pcm = Buffer.from(b64, "base64");
      const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

      const wav = new WaveFile();
      wav.fromScratch(1, sampleRate, "16", int16);
      const buf = Buffer.from(wav.toBuffer());

      console.log(`[live/say][tts] 200 model=${model} voice=${voiceName || "(default)"} emotion=${emo} role=${role || "(none)"} bytes=${pcm.byteLength}`);
      return buf;
    });

    // Write-through cache with better error handling
    const meta = {
      createdAt: Date.now(),
      key,
      ...fields,
      bytes: wavBuf.byteLength,
    };
    if (!bypass) {
      writeAtomically(base, wavBuf, meta)
        .then(() => {
          console.log(`[tts cache] write SUCCESS key=${key.slice(0,8)}`);
        })
        .catch(e => {
          console.error('[tts cache] write failed:', e.message);
          console.error('[tts cache] key:', key.slice(0, 8));
          console.error('[tts cache] base path:', base);
        });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-TTS-Cache', bypass ? 'BYPASS' : 'MISS');
    res.setHeader('ETag', `"${key}"`);
    return res.status(200).send(wavBuf);

  } catch (err) {
    const status = err?.status || err?.error?.code || 500;
    const message = err?.message || err?.error?.message || String(err);
    console.error("Error in /live/say [tts]:", status, err);
    res.status(status).json({ message, error: err?.error || {} });
  }
}

async function healthHandler(req, res) {
  const ok = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    ok,
    defaultModel: process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-preview-tts",
    mode: "tts",
  });
}

function registerLiveTtsRoutes(app) {
  app.post("/live/say", liveSayHandler);
  app.get("/live/health", healthHandler);
}

module.exports = { registerLiveTtsRoutes, liveSayHandler, healthHandler };