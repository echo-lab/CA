function buildSystemInstructionText({ emotion }) {
  const tone = (emotion && String(emotion).trim()) || "neutral";
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

async function liveSayHandler(req, res) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ message: "GEMINI_API_KEY not set" });

    let { text, voiceName, emotion, model: modelFromReq } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: 'Missing or invalid "text"' });
    }
    text = String(text).replace(/(\*)+/g, "").trim();

    // Resolve model priority: request -> env -> default TTS
    const requestedModel = modelFromReq && String(modelFromReq).trim();
    const model = requestedModel || process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-preview-tts";

    // This endpoint uses the non-Live generateContent API; reject Live models here.
    if (/gemini-.*live/i.test(model)) {
      return res.status(400).json({
        message: `Model "${model}" is a Live (WebSocket) model. Use a TTS model (e.g., "gemini-2.5-flash-preview-tts") with this endpoint.`,
      });
    }

    const genaiMod = await import("@google/genai");
    const { GoogleGenAI } = genaiMod;
    const wavefileMod = await import("wavefile");
    const WaveFile = wavefileMod.WaveFile || (wavefileMod.default && wavefileMod.default.WaveFile);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const systemInstructionText = buildSystemInstructionText({ emotion });

    const reqBody = {
      model,
      contents: [{ parts: [{ text }]}],
      systemInstruction: asSystemContent(systemInstructionText),
      config: {
        responseModalities: ["AUDIO"],
        ...(voiceName
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }
          : {}),
      },
    };

    const response = await withRetries(
      () => ai.models.generateContent(reqBody),
      { attempts: 2, delayMs: 400 }
    );

    const b64 = extractAudioBase64FromCandidates(response);
    if (!b64) {
      console.warn('[live/say][tts] No audio part in response');
      return res.status(502).json({ message: "No audio received from TTS model." });
    }

    const pcm = Buffer.from(b64, "base64");
    const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

    const wav = new WaveFile();
    wav.fromScratch(1, 24000, "16", int16);
    const wavBuf = Buffer.from(wav.toBuffer());

    console.log(`[live/say][tts] 200 model=${model} voice=${voiceName || "(default)"} emotion=${emotion || "neutral"} bytes=${pcm.byteLength}`);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", 'inline; filename="gemini.wav"');
    return res.status(200).send(wavBuf);
  } catch (err) {
    const status = err?.status || err?.error?.code || 500;
    const message = err?.message || err?.error?.message || String(err);
    console.error("Error in /live/say [tts]:", status, message);
    res.status(500).json({ message, status });
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
