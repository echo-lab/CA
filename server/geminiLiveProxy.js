const WebSocket = require('ws');

const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

const PROXY_PATH = '/api/gemini-live-proxy';

function setupGeminiLiveProxy(server) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini-live-proxy] GEMINI_API_KEY not set — proxy will reject connections.');
  }

  const wss = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url.split('?')[0];
    if (pathname !== PROXY_PATH) return;
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (clientWs) => {
    if (!apiKey) {
      clientWs.close(1011, 'GEMINI_API_KEY not configured on server');
      return;
    }

    console.log('[gemini-live-proxy] client connected');

    const upstream = new WebSocket(`${GEMINI_LIVE_URL}?key=${apiKey}`);
    // Queue client frames that arrive before upstream finishes its handshake.
    const pending = [];
    let upstreamOpen = false;

    upstream.on('open', () => {
      upstreamOpen = true;
      console.log('[gemini-live-proxy] upstream connected, flushing', pending.length, 'frames');
      for (const { data, isBinary } of pending) upstream.send(data, { binary: isBinary });
      pending.length = 0;
    });

    upstream.on('message', (data, isBinary) => {
      console.log('[gemini-live-proxy] received message from upstream, forwarding to client');
      if (clientWs.readyState === WebSocket.OPEN) {
        console.log('[gemini-live-proxy] forwarding message from upstream to client');
        clientWs.send(data, { binary: isBinary });
      }
    });

    upstream.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      console.log(`[gemini-live-proxy] upstream closed code=${code} reason="${reasonStr}"`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code === 1006 ? 1011 : code, reasonStr.slice(0, 120));
      }
    });

    upstream.on('error', (err) => {
      console.error('[gemini-live-proxy] upstream error:', err?.message || err);
    });

    clientWs.on('message', (data, isBinary) => {
      if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push({ data, isBinary });
      }
    });

    clientWs.on('close', () => {
      console.log('[gemini-live-proxy] client disconnected');
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    });

    clientWs.on('error', (err) => {
      console.error('[gemini-live-proxy] client error:', err?.message || err);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    });
  });

  console.log(`Gemini Live WebSocket proxy ready at ${PROXY_PATH}`);
}

module.exports = { setupGeminiLiveProxy };
