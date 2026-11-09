// Plays streamed 24kHz mono PCM chunks as they arrive, routed through a WebRTC loopback into <audio> so Chrome's echo canceller hears it (direct output fallback).

const SAMPLE_RATE = 24000;
// Keep the loopback alive this long after the last chunk so the delayed <audio> tail isn't clipped.
const LOOPBACK_TAIL_MS = 500;

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

  // All chunk sources connect to this bus. The bus is routed either through the
  // AEC loopback (preferred) or directly to ctx.destination (fallback).
  const outputBus = ctx.createGain();
  const streamDest = ctx.createMediaStreamDestination();
  outputBus.connect(streamDest);

  let loopbackLocalPc = null;
  let loopbackRemotePc = null;
  let loopbackAudioEl = null;
  let usingDirectFallback = false;
  let loopbackTornDown = false;

  function fallbackToDirect(reason) {
    if (usingDirectFallback || loopbackTornDown) return;
    usingDirectFallback = true;
    console.warn('AEC loopback unavailable; playing TTS directly (no echo cancellation):', reason);
    try { outputBus.connect(ctx.destination); } catch {}
  }

  // Idempotent, and not skipped on loopbackTornDown, so it also closes connections set up after a racing teardown.
  function teardownLoopback() {
    loopbackTornDown = true;
    if (loopbackAudioEl) {
      try { loopbackAudioEl.pause(); loopbackAudioEl.srcObject = null; } catch {}
      loopbackAudioEl = null;
    }
    if (loopbackLocalPc) { try { loopbackLocalPc.close(); } catch {} loopbackLocalPc = null; }
    if (loopbackRemotePc) { try { loopbackRemotePc.close(); } catch {} loopbackRemotePc = null; }
  }

  // ctx.close() rejects on an already-closed context, so check state and swallow the rejection.
  function closeCtx() {
    if (ctx.state === 'closed') return;
    try { ctx.close().catch(() => {}); } catch {}
  }

  // Set up the WebRTC loopback (local PC -> remote PC -> <audio>) so AEC can see
  // this audio. Runs eagerly; on any failure we fall back to direct output.
  (async () => {
    if (typeof RTCPeerConnection === 'undefined') { fallbackToDirect('no RTCPeerConnection'); return; }
    try {
      const local = new RTCPeerConnection();
      const remote = new RTCPeerConnection();
      loopbackLocalPc = local;
      loopbackRemotePc = remote;
      if (loopbackTornDown) { teardownLoopback(); return; } // stop() raced ahead
      local.onicecandidate = (e) => { if (e.candidate) remote.addIceCandidate(e.candidate).catch(() => {}); };
      remote.onicecandidate = (e) => { if (e.candidate) local.addIceCandidate(e.candidate).catch(() => {}); };

      const el = new Audio();
      el.autoplay = true;
      loopbackAudioEl = el;
      remote.ontrack = (e) => {
        if (loopbackTornDown) return;
        el.srcObject = e.streams[0];
        el.play().catch((err) => fallbackToDirect('audio element play() rejected: ' + err));
      };

      streamDest.stream.getTracks().forEach((t) => local.addTrack(t, streamDest.stream));

      const offer = await local.createOffer();
      await local.setLocalDescription(offer);
      await remote.setRemoteDescription(offer);
      const answer = await remote.createAnswer();
      await remote.setLocalDescription(answer);
      await local.setRemoteDescription(answer);
      if (loopbackTornDown) teardownLoopback();
    } catch (e) {
      if (loopbackTornDown) teardownLoopback();
      else fallbackToDirect(e);
    }
  })();

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
      // Let the (latency-delayed) loopback <audio> tail finish, then clean up.
      setTimeout(() => {
        if (stopped) return;
        teardownLoopback();
        closeCtx();
      }, LOOPBACK_TAIL_MS);
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
      if (stopped || ctx.state === 'closed') return;
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
      src.connect(outputBus);
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
          s.stop();
        } catch {}
      });
      scheduledSources = [];
      teardownLoopback();
      closeCtx();
    },
    isFinished() {
      return endedSignaled;
    },
  };
}
