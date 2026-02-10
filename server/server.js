const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const WebSocket = require('ws');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { registerLiveTtsRoutes } = require('./liveTTS');
const { setupEducationalQuestionRoutes } = require('./ModelsCommunication');

const { startPruner } = require('./cache/prune');
startPruner();

const GOOGLE_API_KEY = process.env.GOOGLEAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});
console.log(keyPath);
console.log(certPath);
const corsOptions = {
    origin: [
        'https://talemate.cs.vt.edu',
        'https://128.173.237.12',
        'https://localhost:3000',
        'http://localhost:3000',  // Allow HTTP for local dev
        'http://localhost:5001',  // Allow same-origin requests
        'https://talemate.cs.vt.edu:3001',
        'https://talemate.cs.vt.edu:5001'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
registerLiveTtsRoutes(app);
setupEducationalQuestionRoutes(app);

// Realtime API token endpoint
app.get('/api/rt-connection', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: {
                    type: "realtime",
                    model: "gpt-realtime",
                    audio: {
                        output: {
                            voice: "marin",
                        },
                    },
                }
            })
        });

        if (!r.ok) {
            const errorText = await r.text();
            console.error(`OpenAI error (${r.status}):`, errorText);
            return res.status(r.status).json({
                error: "Failed to generate token",
                detail: errorText
            });
        }

        // Return the full JSON response from OpenAI
        const tokenData = await r.json();
        res.json(tokenData);
    } catch (error) {
        console.error("Token generation error:", error);
        res.status(500).json({ error: "Request failed", detail: error.message });
    }
});

// WebSocket proxy endpoint for Deepgram using SDK - keeps API key on server
function setupDeepgramProxy(server) {
    const ws = new WebSocket.Server({
        server,
        path: '/api/deepgram-proxy'
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
            punctuate: false,
            interim_results: true,
            diarize: true,
            smart_format: true,
            keyterms: ['zoe', 'clara', 'add', 'bags', 'beamed', 'beep', 'beeps', 'big', 'boom', 'boop', 'boops', 'box', 'clash', 'cried', 'ding', 'dong', 'end', 'fluttered', 'fun', 'gasped', 'go', 'got', 'hats', 'hey', 'how', 'hug', 'peeked', 'said', 'sang', 'squawk', 'streamers', 'upset', 'zap', 'zip', 'zop'],
        });

        // Handle Deepgram connection opened
        deepgramLive.on(LiveTranscriptionEvents.Open, () => {
            console.log('Deepgram live connection opened');
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
            console.log('Deepgram metadata:', data);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle utterance end
        deepgramLive.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
            console.log('Utterance ended');
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle speech started
        deepgramLive.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
            console.log('Speech started');
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });

        // Handle Deepgram errors
        deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
            console.error('Deepgram error:', error);
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
            // Close the Deepgram connection
            if (deepgramLive.getReadyState() === 1) {
                deepgramLive.requestClose();
            }
        });

        // Handle client errors
        clientWs.on('error', (error) => {
            console.error('Client WebSocket error:', error);
            if (deepgramLive.getReadyState() === 1) {
                deepgramLive.requestClose();
            }
        });
    });

    console.log('Deepgram WebSocket proxy ready at /api/deepgram-proxy (using nova-3 with diarization)');
}

// Relevancy checking endpoint using OpenAI
app.post('/api/check-relevancy', async (req, res) => {
    try {
        const { bookContent, currentLine, prevUtterances, utterance } = req.body;

        if (!bookContent || !currentLine || !utterance) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['bookContent', 'currentLine', 'utterance']
            });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "developer",
                    content: `You are a reading comprehension expert.
                    Determine if the user's utterance is relevant to the book context and current line.` },
                {
                    role: "user",
                    content: `Book Context: ${JSON.stringify(bookContent)}

Current Line: "${currentLine}"

Last Utterance: "${utterance}"

Is the user's last utterance relevant to the  being read?`
                }
            ],
            response_format: { type: "json_schema",
                json_schema: {
                name: "relevance_check",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        relevance: { type: "boolean" },
                        rationale: { type: "string" }
                    },
                    required: ["relevance", "rationale"],
                    additionalProperties: false
                }
            }
             },
            temperature: 0.3
        });

        const result = JSON.parse(completion.choices[0].message.content);
        res.json(result);

    } catch (error) {
        console.error('Error checking relevancy:', error);
        res.status(500).json({
            error: 'Failed to check relevancy',
            detail: error.message
        });
    }
});

app.post('/api/classify-utterance', async (req, res) => {
    try {
        const { bookContent, currentLine, prevUtterances, utterance } = req.body;

        if (!bookContent || !currentLine || !utterance) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['bookContent', 'currentLine', 'utterance']
            });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "developer",
                    content: `You are an expert Linguist. Identify which phase the speaker is in for the "Last Utterance" based on its relationship to the "Previous Utterances" using these four labels:
**PROPOSAL** - Initiates a new topic or asks a question when no active topic exists.
**RATIFICATION** - Accepts the proposed topic. The speaker answers the question, expresses interest, or adds a relevant comment.
**EXPANSION** - Builds deeper into an already ratified topic.
**REJECTION** - The speaker refuses to take up the proposed topic (non-sequiturs, dismissal, or ignoring the cue).`
                },
                {
                    role: "user",
                    content: `Book Context: ${JSON.stringify(bookContent)}

Previous Utterances: "${prevUtterances}"

Last Utterance: "${utterance}"

Which phase is the speaker in?`
                }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "phase_classification",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            classification: {
                                type: "string",
                                enum: ["PROPOSAL", "RATIFICATION", "EXPANSION", "REJECTION"]
                            },
                            rationale: { type: "string" }
                        },
                        required: ["classification", "rationale"],
                        additionalProperties: false
                    }
                }
            },
            temperature: 0.3
        });

        const result = JSON.parse(completion.choices[0].message.content);
        res.json(result);

    } catch (error) {
        console.error('Error checking relevancy:', error);
        res.status(500).json({
            error: 'Failed to check relevancy',
            detail: error.message
        });
    }
});

app.post('/synthesize', async (req, res) => {
    try {
        // Log the incoming request body
        console.log('/synthesize request body:', JSON.stringify(req.body, null, 2));

        const fetch = (await import('node-fetch')).default;
        let sanitizedText = req.body.text.replace(/(\*)+/g, '');
        sanitizedText = sanitizedText.replace(/'/g, '"');
        //console.log(sanitizedText)
        const ssmlText = `<speak>${sanitizedText}</speak>`;
        const request = {
            input: { ssml: ssmlText },
            voice: req.body.voice,
            audioConfig: { audioEncoding: 'MP3' , speakingRate: 0.8},

        };

        // Log the exact payload sent to Google
        console.log('TTS API request payload:', JSON.stringify(request, null, 2));

        const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_API_KEY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        });

        const raw = await response.text();
        if (!response.ok) {
            console.error('TTS API responded with status', response.status);
            console.error('TTS API error body:', raw);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (parseErr) {
            console.error('Failed to parse TTS API JSON:', raw);
            return res.status(500).json({ message: 'Invalid JSON from TTS API' });
        }

        console.log('TTS API success payload (truncated):', raw.slice(0, 100));
        return res.json(data);
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5001;
    const server = app.listen(port, () => console.log(`Server started on port ${port}`));

    // Setup WebSocket proxy for Deepgram
    setupDeepgramProxy(server);
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

    // Setup WebSocket proxy for Deepgram
    setupDeepgramProxy(server);
}
