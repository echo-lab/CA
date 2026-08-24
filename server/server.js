const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const { registerLiveTtsRoutes } = require('./liveTTS');
const { setupEducationalQuestionRoutes } = require('./ModelsCommunication');
const { setupGeminiLiveProxy } = require('./geminiLiveProxy');
const { startPruner } = require('./lib/cache/prune');

// Route modules
const bookRoutes = require('./routes/book');
const imageRoutes = require('./routes/image');
const categorizeRoutes = require('./routes/categorize');
const generateQuestionRoutes = require('./routes/generateQuestion');
const acknowledgementRoutes = require('./routes/acknowledgement');
const loggingRoutes = require('./routes/logging');
const studyLogRoutes = require('./routes/studyLog');

startPruner();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;

console.log(keyPath);
console.log(certPath);

const corsOptions = {
    origin: [
        'https://talemate.cs.vt.edu',
        'https://128.173.237.12',
        'https://localhost:3000',
        'http://localhost:3000',
        'http://localhost:5001',
        'https://talemate.cs.vt.edu:3004',
        'https://talemate.cs.vt.edu:5004'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
// 1mb (default is 100kb): a transcript flush carries the full Deepgram words[]
// array per utterance, which overruns the default and 413s.
app.use(express.json({ limit: '1mb' }));
registerLiveTtsRoutes(app);
setupEducationalQuestionRoutes(app);

// Mount route modules
app.use(bookRoutes);
app.use(imageRoutes);
app.use(categorizeRoutes);
app.use(generateQuestionRoutes);
app.use(acknowledgementRoutes);
app.use(loggingRoutes);
app.use(studyLogRoutes);

// WebSocket proxy endpoint for Deepgram using SDK - keeps API key on server
function setupDeepgramProxy(server) {
    // noServer + manual upgrade routing so this WS server coexists with others
    // (e.g. /api/gemini-live-proxy) on the same HTTP server. `{ server, path }`
    // would cause ws to abortHandshake on any non-matching path and destroy
    // sockets meant for other proxies.
    const DEEPGRAM_PATH = '/api/deepgram-proxy';
    // 3s: two frames land inside Deepgram's 10s window even if the loop stalls.
    const KEEPALIVE_INTERVAL_MS = 3000;
    const ws = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const pathname = req.url.split('?')[0];
        if (pathname !== DEEPGRAM_PATH) return;
        ws.handleUpgrade(req, socket, head, (client) => {
            ws.emit('connection', client, req);
        });
    });

    ws.on('connection', (clientWs) => {
        console.log('Client connected to Deepgram proxy');

        // Create Deepgram client with API key (kept secure on server)
        const deepgram = createClient(DEEPGRAM_API_KEY);

        // Create live transcription connection with nova-3 and diarization
        const deepgramLive = deepgram.listen.live({
            model: 'nova-3',
            language: 'en',
            encoding: 'linear16',
            sample_rate: 16000,
            channels: 1,
            punctuate: true,
            interim_results: true,
            diarize_model: 'v1',
            smart_format: true,
            endpointing: 500,
            utterance_end_ms: 1200,
            vad_events: true,
            keyterms: ['zoe:5', 'clara:5', 'add', 'bags', 'beamed', 'beep:5', 'beeps:5', 'big', 'boom', 'boop:5', 'boops:5', 'box', 'clash', 'cried', 'ding', 'dong', 'end', 'fluttered', 'fun', 'gasped', 'go', 'got', 'hats', 'hey', 'how', 'hug', 'peeked', 'said', 'sang', 'squawk', 'streamers', 'upset', 'zap:5', 'zip:5', 'zop:5', 'zoodely:5', 'zoop:5'],
        });

        // Deepgram closes any socket that goes 10s without audio or a text frame
        // (NET-0001). The client deliberately sends nothing while the mic is
        // suppressed during TTS playback, so a long narration would otherwise kill
        // transcription for the rest of the session. KeepAlive frames hold the
        // socket open and are not billed as audio.
        let keepAliveTimer = null;
        const stopKeepAlive = () => {
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                keepAliveTimer = null;
            }
        };

        // Handle Deepgram connection opened
        deepgramLive.on(LiveTranscriptionEvents.Open, () => {
            console.log('Deepgram live connection opened');
            keepAliveTimer = setInterval(() => {
                if (deepgramLive.getReadyState() === 1) deepgramLive.keepAlive();
            }, KEEPALIVE_INTERVAL_MS);
            clientWs.send(JSON.stringify({
                type: 'server_status',
                message: 'Connected to Deepgram with nova-3 model'
            }));
        });

        // Handle transcription results from Deepgram
        deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle metadata
        deepgramLive.on(LiveTranscriptionEvents.Metadata, (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle utterance end
        deepgramLive.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle speech started
        deepgramLive.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle Deepgram errors
        deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'error',
                    message: 'Deepgram transcription error',
                    error: error
                }));
            }
        });

        // Handle Deepgram connection closed
        deepgramLive.on(LiveTranscriptionEvents.Close, () => {
            console.log('Deepgram connection closed');
            stopKeepAlive();
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
            }
        });

        // Forward audio data from client to Deepgram
        clientWs.on('message', (data) => {
            // Send raw audio buffer to Deepgram
            if (deepgramLive.getReadyState() === 1) { // 1 = OPEN
                deepgramLive.send(data);
            }
        });

        // Handle client disconnection
        clientWs.on('close', () => {
            console.log('Client disconnected from Deepgram proxy');
            stopKeepAlive();
            // Close the Deepgram connection
            if (deepgramLive.getReadyState() === 1) {
                deepgramLive.requestClose();
            }
        });

        // Handle client errors
        clientWs.on('error', (error) => {
            console.error('Client WebSocket error:', error);
            stopKeepAlive();
            if (deepgramLive.getReadyState() === 1) {
                deepgramLive.requestClose();
            }
        });
    });

    console.log(`Deepgram WebSocket proxy ready at ${DEEPGRAM_PATH} (using nova-3 with diarization)`);
}

if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5001;
    const server = app.listen(port, () => console.log(`Server started on port ${port}`));

    // Setup WebSocket proxy for Deepgram
    setupDeepgramProxy(server);
    setupGeminiLiveProxy(server);
}
else{

    const port = process.env.REACT_APP_PORT || 5001;
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    const server = https.createServer(httpsOptions, app);
    server.listen(port, () => {
        console.log(`Server started on https://localhost:${port}`);
    });

    setupDeepgramProxy(server);
    setupGeminiLiveProxy(server);
}
