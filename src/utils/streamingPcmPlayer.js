// Streaming PCM player for Gemini TTS audio chunks.
//
// Gemini emits 16-bit signed little-endian mono PCM at 24kHz. Each base64 chunk
// is decoded into an AudioBuffer and scheduled contiguously on an AudioContext,
// so the first chunk starts playing as soon as it arrives without waiting for
// the rest of the stream.

const SAMPLE_RATE = 24000;

function decodePcmBase64ToAudioBuffer(ctx, b64) {
  const bin = atob(b64);
  const sampleCount = Math.floor(bin.length / 2);
  const buf = ctx.createBuffer(1, sampleCount, SAMPLE_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    let s = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (s >= 0x8000) s -= 0x10000;
    ch[i] = s / 32768;
  }
  return buf;
}

// onEnded fires once after `end()` is signaled AND the final scheduled chunk
// finishes playing. If `stop()` is called first, onEnded is not invoked.
export function createStreamingPcmPlayer({ onEnded, onError } = {}) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctor({ sampleRate: SAMPLE_RATE });
  let nextStartTime = 0; // absolute AudioContext time; set on first chunk
  let scheduledSources = [];
  let endReceived = false;
  let pendingChunks = 0;
  let endedSignaled = false;
  let stopped = false;
  const playedSeqs = new Set(); // chunkNums we've already logged "Playing" for

  function maybeSignalEnd() {
    if (stopped || endedSignaled) return;
    if (endReceived && pendingChunks === 0) {
      endedSignaled = true;
      try { onEnded?.(); } catch (e) { console.error('player onEnded error:', e); }
    }
  }

  return {
    ctx,
    async resume() {
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (e) { /* ignore */ }
      }
    },
    pushChunk(seq, audioContent) {
      if (stopped) return;
      let buf;
      try {
        buf = decodePcmBase64ToAudioBuffer(ctx, audioContent);
      } catch (e) {
        console.error('player decode error:', e);
        try { onError?.(e); } catch {}
        return;
      }
      const chunkNum = (seq ?? 0) + 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      if (nextStartTime === 0) nextStartTime = ctx.currentTime + 0.08;
      const startAt = Math.max(nextStartTime, ctx.currentTime + 0.005);
      src.start(startAt);
      nextStartTime = startAt + buf.duration;
      pendingChunks++;

      const delayMs = Math.max(0, (startAt - ctx.currentTime) * 1000);
      const playingTimer = setTimeout(() => {
        if (!playedSeqs.has(chunkNum)) {
          playedSeqs.add(chunkNum);
        }
      }, delayMs);
      src._chunkNum = chunkNum;
      src._playingTimer = playingTimer;
      src.onended = () => {
        pendingChunks--;
        clearTimeout(playingTimer);
        maybeSignalEnd();
      };
      scheduledSources.push(src);
    },
    end() {
      endReceived = true;
      maybeSignalEnd();
    },
    stop() {
      stopped = true;
      scheduledSources.forEach((s) => {
        try {
          if (s._playingTimer) clearTimeout(s._playingTimer);
          const n = s._chunkNum;
          s.stop();
        } catch {}
      });
      scheduledSources = [];
      try { ctx.close(); } catch {}
    },
    isFinished() {
      return endedSignaled;
    },
  };
}
