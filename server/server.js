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
const { setupGeminiLiveProxy } = require('./geminiLiveProxy');

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
        'https://talemate.cs.vt.edu:3004',
        'https://talemate.cs.vt.edu:5004'
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
    // noServer + manual upgrade routing so this WS server coexists with others
    // (e.g. /api/gemini-live-proxy) on the same HTTP server. `{ server, path }`
    // would cause ws to abortHandshake on any non-matching path and destroy
    // sockets meant for other proxies.
    const DEEPGRAM_PATH = '/api/deepgram-proxy';
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
            punctuate: false,
            interim_results: true,
            diarize: true,
            smart_format: true,
            keyterms: ['zoe:5', 'clara:5', 'add', 'bags', 'beamed', 'beep:5', 'beeps:5', 'big', 'boom', 'boop:5', 'boops:5', 'box', 'clash', 'cried', 'ding', 'dong', 'end', 'fluttered', 'fun', 'gasped', 'go', 'got', 'hats', 'hey', 'how', 'hug', 'peeked', 'said', 'sang', 'squawk', 'streamers', 'upset', 'zap:5', 'zip:5', 'zop:5'],
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

    console.log(`Deepgram WebSocket proxy ready at ${DEEPGRAM_PATH} (using nova-3 with diarization)`);
}

app.post('/analyze-image', async (req, res) => {
  try {
    const { book, page, question, pageText } = req.body;
    if (!book || !page || !question) {
      return res.status(400).json({ message: 'Provide book, page, and question' });
    }

    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!PROJECT_ID) {
      return res.status(500).json({ message: 'VERTEX_PROJECT_ID not set' });
    }

    const fileName = String(book) === '3'
      ? `${page} Library.jpg`
      : `Page_${page}.jpg`;
    const imgPath = path.join(__dirname, '../src/Pictures', `book${book}`, fileName);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ message: `Image not found: ${fileName}` });
    }

    const imageData = fs.readFileSync(imgPath).toString('base64');

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageData } },
          { text: question },
        ],
      }],
      config: {
        systemInstruction: `You are a narrator for a children's picture book.
The two characters in every image are:
- Zoe: the bird (any bird you see is always Zoe)
- Clara: the chameleon (any chameleon or lizard you see is always Clara)
Always call them by name — never say "the bird" or "the chameleon".
Give a SHORT answer of 1 sentence. Be similar to a parent answering a question to their kid. ${pageText ? `\n\nThe text on this page reads:\n${pageText}` : ''}`,
      },
    });

    res.json({ answer: response.text ?? '' });
  } catch (error) {
    console.error('Error in /analyze-image:', error);
    res.status(500).json({ message: error.toString() });
  }
});

app.post('/tag-image', async (req, res) => {
  try {
    const { book, page, pageText } = req.body;
    if (!book || !page) {
      return res.status(400).json({ message: 'Provide book and page' });
    }

    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!PROJECT_ID) {
      return res.status(500).json({ message: 'VERTEX_PROJECT_ID not set' });
    }

    const fileName = String(book) === '3'
      ? `${page} Library.jpg`
      : `Page_${page}.jpg`;
    const imgPath = path.join(__dirname, '../src/Pictures', `book${book}`, fileName);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ message: `Image not found: ${fileName}` });
    }

    const imageData = fs.readFileSync(imgPath).toString('base64');

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageData } },
          { text: `${pageText ? `Page text: "${pageText}"\n\n` : ''}Detect the characters (Zoe: Parrot, Clara: Chameleon) and key story objects (props, clothing, held items) visible in this illustration. Do NOT tag walls, floors, ceilings, sky, ground, or generic background scenery. Keep bounding boxes tight. If an object appears multiple times, give each a unique label. Limit to 20 objects. Return just box_2d ([y_min, x_min, y_max, x_max] normalized 0-1000) and label for each. No additional text.` },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              box_2d: {
                type: 'array',
                items: { type: 'integer' },
                description: '[y_min, x_min, y_max, x_max] normalized 0-1000',
              },
            },
            required: ['label', 'box_2d'],
          },
        },
      },
    });

    const tags = JSON.parse(response.text ?? '[]');
    res.json({ tags });
  } catch (error) {
    console.error('Error in /tag-image:', error);
    res.status(500).json({ message: error.toString() });
  }
});

app.post('/api/categorize-utterances-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Send headers immediately so the browser starts parsing SSE before any data.
    res.flushHeaders();

    const t0 = Date.now();
    const tlog = (label) => console.log(`[cat-stream] +${Date.now() - t0}ms ${label}`);
    let tFirstChunk = null;
    let tFirstItem = null;
    let tLastItem = null;

    const { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention } = req.body;

    if (!formattedUtterances) {
        res.write(`data: ${JSON.stringify({ error: 'Missing required fields' })}\n\n`);
        return res.end();
    }

    try {
        const questionAbortController = new AbortController();
        tlog('handler start, both OpenAI calls about to launch');

        // Start categorization and question generation simultaneously
        const categorizationStreamPromise = openai.chat.completions.create({
            model: "gpt-5-mini",
            stream: true,
            // Got rid of rationale for speed and simplicity, can add back if needed {"category":"ON_TOPIC or OFF_TOPIC","rationale":"<one sentence>"}
            messages: [
                {
                    role: "developer",
                    content: `You are a reading interaction analyst for a parent-child co-reading system.

CLASSIFY each off-script utterance. Output one JSON object per line (NDJSON), no extra text.

1. ON_TOPIC: 
   - Directly addresses the current page's narrative, character emotions, or visual details.
   - Shows accurate comprehension of the story (e.g., correct character names/genders).
   - Must be substantive. Do not use for one-word fillers.

2. PAGE_QUESTION: 
   - The utterance is a literal or near-literal restatement of the prompt question.

3. OFF_TOPIC: 
   - CONTEXT DRIFT: References topics/objects from previous pages not present now (e.g., talking about 'cake' on a 'streamer' page).
   - HALLUCINATION: Mentioning objects or actions not in the provided Image Analysis or Text (e.g., calling a party hat a 'nest').
   - FACTUAL ERROR: Using incorrect genders or names for characters (e.g., calling Zoe 'he').
   - NON-SUBSTANTIVE: Fillers, signals of presence, or empty reactions (e.g., 'so', 'oh', 'um').
   - EXTERNAL: Daily chat or physical environment comments.

OUTPUT REQUIREMENT:
- Output exactly ONE JSON line per request: {"category":"ON_TOPIC", "PAGE_QUESTION", or "OFF_TOPIC"}
- Output ONLY the NDJSON lines. No conversational filler.`
                },
                {
                    role: "user",
                    content: `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText}
Question: "${currentPageQuestion}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User's Attention: "${userAttention}"` : ''}\n</image_context>\n` : ''}<off_script_utterances>
${formattedUtterances}
</off_script_utterances>`
                }
            ]
        });

// Use one of these strategies (vary across calls):
// - Open-ended: Ask the child to describe or explain ("What's happening here?")
// - Wh-question: Who, what, where, why about the story or illustration
// - Recall: Ask about something earlier in the story
// - Completion: Leave a blank for the child to fill in (for repetitive/rhyming text)

        const questionPromise = openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
                {
                    role: "developer",
                    content: `You are an educator for a parent-child co-reading system. Generate ONE short, engaging follow-up question for a toddler based on what they just said, the book content, and the image (if provided).
Guidelines:
- Build on the provided contexts utterance, user attention, and page information— respond to what THEY noticed
- Keep it short and natural (how a parent would talk)
- For ages 3-6: prefer concrete, simple language
- Reply with only the question, no extra text.`
                },
                {
                    role: "user",
                    content: `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText}
Question: "${currentPageQuestion}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User's attention is on "${userAttention}"` : ''}\n</image_context>\n` : ''}<utterances>
${formattedUtterances}
</utterances>`
                }
            ]
        }, { signal: questionAbortController.signal }).catch(err => {
            if (err.name === 'AbortError' || err instanceof OpenAI.APIUserAbortError || err.code === 'ERR_CANCELED') return null;
            throw err;
        });

        // Stream categorization items
        const categorizationStream = await categorizationStreamPromise;
        tlog('categorization stream object received (request sent to OpenAI)');
        const items = [];
        let buffer = '';
        let hasOnTopic = false;

        // To-Do - optimize by starting to parse stream and abort question as soon as we see an ON_TOPIC, instead of waiting for whole categorization to finish
        for await (const chunk of categorizationStream) {
            if (tFirstChunk === null) {
                tFirstChunk = Date.now();
                tlog('first chunk arrived from OpenAI');
            }
            const token = chunk.choices[0]?.delta?.content || '';
            buffer += token;

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const item = JSON.parse(trimmed);
                    if (tFirstItem === null) {
                        tFirstItem = Date.now();
                        tlog('first parsed item written to client');
                    }
                    tLastItem = Date.now();
                    items.push(item);
                    res.write(`data: ${JSON.stringify({ type: 'item', item })}\n\n`);
                    if (item.category === 'ON_TOPIC') hasOnTopic = true;
                } catch (e) {}
            }
        }
        tlog(`categorization stream complete (${items.length} items, hasOnTopic=${hasOnTopic})`);

        // Flush remaining buffer
        if (buffer.trim()) {
            try {
                const item = JSON.parse(buffer.trim());
                if (tFirstItem === null) tFirstItem = Date.now();
                tLastItem = Date.now();
                items.push(item);
                res.write(`data: ${JSON.stringify({ type: 'item', item })}\n\n`);
                console.log('Categorization item (from flush):', item);
                if (item.category === 'ON_TOPIC') hasOnTopic = true;
            } catch (e) {}
        }

        // Categorization done — decide whether to use or cancel question generation
        // const hasOnTopic = items.some(i => i.category === 'ON_TOPIC');
        let generatedQuestion = null;

        if (hasOnTopic) {
            console.log("Generating question based on ON_TOPIC utterance(s)");
            const qResult = await questionPromise;
            tlog('question generation complete');
            generatedQuestion = qResult?.choices[0]?.message?.content?.trim() || null;
        } else {
            questionAbortController.abort();
            tlog('question generation aborted (no ON_TOPIC)');
        }

        res.write(`data: ${JSON.stringify({ type: 'done', generatedQuestion })}\n\n`);
        res.end();
        const ms = (a, b) => a == null || b == null ? null : b - a;
        console.log('[cat-stream] summary (ms):', {
            firstChunk: ms(t0, tFirstChunk),
            firstItem: ms(t0, tFirstItem),
            lastItem: ms(t0, tLastItem),
            total: Date.now() - t0,
            itemCount: items.length,
            generatedQuestion: !!generatedQuestion,
        });

    } catch (error) {
        console.error('Error in streaming categorization:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

// --- Book data loader for test page ---
function loadBookData(bookId) {
    const bookFiles = {
        1: path.join(__dirname, '..', 'src', 'Book', 'Book1.js'),
        2: path.join(__dirname, '..', 'src', 'Book', 'Book2.js'),
        3: path.join(__dirname, '..', 'src', 'Book', 'Book3.js'),
    };
    const filePath = bookFiles[bookId];
    if (!filePath) return null;
    let src = fs.readFileSync(filePath, 'utf-8');
    // Strip require() calls (images) and export keyword
    src = src.replace(/require\([^)]+\)/g, 'null');
    src = src.replace(/^export\s+const\s+data\s*=/, 'var __data =');
    // Evaluate and extract
    const vm = require('vm');
    const ctx = {};
    vm.runInNewContext(src, ctx);
    return ctx.__data && ctx.__data[0] ? ctx.__data[0].Book : null;
}

function stripSSML(text) {
    return text.replace(/<\/?[^>]+(>|$)/g, '').replace(/\s+/g, ' ').trim();
}

// API: get book metadata (page names, text, questions)
app.get('/api/book-data/:bookId', (req, res) => {
    const book = loadBookData(parseInt(req.params.bookId));
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const pageEntries = Object.entries(book.Pages).map(([key, page], i) => ({
        key,
        index: i,
        question: page.question || '',
        text: (page.text || []).map(l => ({ Character: l.Character, Dialogue: stripSSML(l.Dialogue) })),
    }));

    res.json({ name: book.Name, pages: pageEntries });
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

// Two payload shapes share this endpoint:
//   1. {name, book, condition}     — single-row session metadata (study setup)
//                                    appended to server/session-log.csv
//   2. {sessionId, rows}           — full event log for a session (from
//                                    src/logGeneration.js); overwrites
//                                    server/logs/session_<sessionId>.csv
app.post('/api/log-session', (req, res) => {
    const { name, book, condition, sessionId, rows } = req.body || {};

    // Shape 2: per-session event log
    if (sessionId && Array.isArray(rows)) {
        if (rows.length === 0) {
            return res.status(400).json({ message: 'rows must be non-empty' });
        }
        const headers = [
            'session_id', 'user_id', 'book_id', 'condition', 'event_type', 'timestamp',
            'page_number', 'latency_ms', 'manual_interventions',
            'line_index', 'direction', 'trigger'
        ];
        const escape = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csvRows = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
        const csv = headers.join(',') + '\n' + csvRows.join('\n') + '\n';

        const logsDir = path.join(__dirname, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const csvPath = path.join(logsDir, `session_${sessionId}.csv`);
        fs.writeFileSync(csvPath, csv);

        console.log(`[log-session events] wrote ${rows.length} rows → ${csvPath}`);
        return res.json({ success: true, count: rows.length, path: `logs/session_${sessionId}.csv` });
    }

    // Shape 1: study-setup metadata row
    if (!name || !book || !condition) {
        return res.status(400).json({
            message: 'Provide either {name, book, condition} or {sessionId, rows}'
        });
    }
    const csvPath = path.join(__dirname, 'session-log.csv');
    const timestamp = new Date().toISOString();
    const header = 'timestamp,name,book,condition\n';
    const row = `${timestamp},${name},${book},${condition}\n`;

    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, header + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }
    console.log(`[session-log] ${name}, book ${book}, ${condition}`);
    res.json({ success: true });
});

// Download session log CSV
app.get('/api/log-session/download', (req, res) => {
    const csvPath = path.join(__dirname, 'session-log.csv');
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ message: 'No session log found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=session-log.csv');
    res.sendFile(csvPath);
});

// Download all per-session event logs concatenated into one CSV.
// Each row carries session_id so they can be unambiguously grouped at analysis.
app.get('/api/log-events/download', (req, res) => {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        return res.status(404).json({ message: 'No event logs found' });
    }
    const files = fs.readdirSync(logsDir)
        .filter((f) => f.startsWith('session_') && f.endsWith('.csv'))
        .sort();
    if (files.length === 0) {
        return res.status(404).json({ message: 'No event logs found' });
    }

    let header = null;
    const bodies = [];
    for (const f of files) {
        const content = fs.readFileSync(path.join(logsDir, f), 'utf8');
        const newlineIdx = content.indexOf('\n');
        if (newlineIdx === -1) continue;
        const fileHeader = content.slice(0, newlineIdx);
        const fileBody = content.slice(newlineIdx + 1);
        if (header === null) header = fileHeader;
        if (fileBody.trim()) bodies.push(fileBody.endsWith('\n') ? fileBody : fileBody + '\n');
    }
    if (!header) {
        return res.status(404).json({ message: 'No event log content' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=event-logs.csv');
    res.send(header + '\n' + bodies.join(''));
});

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

    // Setup WebSocket proxy for Deepgram
    setupDeepgramProxy(server);
    setupGeminiLiveProxy(server);
}
