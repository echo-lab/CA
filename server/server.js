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
            model: "gpt-4o",
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

app.post('/api/categorize-utterances', async (req, res) => {
    try {
        const { formattedUtterances, bookPageText, currentPageQuestion, bookText } = req.body;

        if (!formattedUtterances) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['formattedUtterances']
            });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "developer",
                    content: `You are a reading interaction analyst for a parent-child co-reading system. You classify off-script utterances — words spoken beyond the expected book text — during reading sessions.
                    
Categories:
- ON_TOPIC: Related to the book content or questions from the book. This includes comments about characters, plot, predictions, or connections to the child's life.
- OFF_TOPIC: Unrelated to the book content or reading activity.

Classification rules:
- Classify by the speaker's primary communicative intent.
- Loose story connections count as book-related. Parents often link the story to the child's life — classify these as ON_TOPIC, not OFF_TOPIC.
- Redirections or attention prompts (e.g., "Pay attention", "Let's focus") are OFF_TOPIC.
- When uncertain, favor a ON_TOPIC over OFF_TOPIC.`
                },
                {
                    role: "user",
                    content: `Full book text:
${bookText}

<current_page>
Page: ${req.body.currentPageNumber || ''}
Text: "${bookPageText}"
Question: "${currentPageQuestion}"
</current_page>

<off_script_utterances>
${formattedUtterances}
</off_script_utterances>

Classify each utterance.`
                }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "utterance_categorization",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            items: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        line: { type: "string" },
                                        text: { type: "string" },
                                        category: { type: "string", enum: ["ON_TOPIC", "OFF_TOPIC"] },
                                        confidence: { type: "number", minimum: 0, maximum: 1 },
                                        rationale: { type: "string" }
                                    },
                                    required: ["line", "text", "category", "confidence", "rationale"],
                                    additionalProperties: false
                                }
                            },
                            summary: { type: "string" }
                        },
                        required: ["items", "summary"],
                        additionalProperties: false
                    }
                }
            },
            temperature: 0.3
        });

        const result = JSON.parse(completion.choices[0].message.content);

        // Generate a follow-up question from ON_TOPIC utterances
        const onTopicItems = (result.items || []).filter(i => i.category === 'ON_TOPIC');
        let generatedQuestion = null;

        if (onTopicItems.length > 0) {
            const onTopicText = onTopicItems.map(i => i.text).join('\n');
            const questionCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "developer",
                        content: `You are an educator helping toddlers learn about patterns during a parent-child co-reading session. Generate ONE brief educational question that teaches toddlers about patterns and provokes further discussion between toddler and caregiver based on the provided book content and the child's on-topic comments.`
                    },
                    {
                        role: "user",
                        content: `Book page text: "${bookPageText}"

Page question: "${currentPageQuestion}"

Child's on-topic comments:
${onTopicText}

Generate one short, engaging educational question about patterns based on the book content and the child's comments.`
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });
            generatedQuestion = questionCompletion.choices[0].message.content.trim();
        }

        res.json({ ...result, generatedQuestion });

    } catch (error) {
        console.error('Error categorizing utterances:', error);
        res.status(500).json({
            error: 'Failed to categorize utterances',
            detail: error.message
        });
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

// Test page: select book + page, type utterances, send to /api/categorize-utterances
app.get('/test-categorize', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test Categorize Utterances</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; background: #1e1e1e; color: #d4d4d4; padding: 20px; max-width: 800px; }
    h2 { color: #c586c0; margin-bottom: 16px; }
    label { display: block; color: #9cdcfe; margin: 10px 0 4px; }
    select, textarea, input {
      width: 100%; background: #2d2d2d; color: #d4d4d4; border: 1px solid #3c3c3c;
      padding: 8px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    select { cursor: pointer; }
    textarea { height: 120px; resize: vertical; }
    .context-box {
      margin-top: 8px; padding: 10px; background: #252526; border: 1px solid #3c3c3c;
      border-radius: 4px; font-size: 11px; line-height: 1.6; max-height: 200px; overflow-y: auto;
    }
    .context-box .page-q { color: #c586c0; margin-bottom: 4px; }
    .context-box .line { color: #808080; }
    .context-box .char { color: #569cd6; }
    button {
      margin-top: 14px; padding: 10px 24px; background: #569cd6; color: #fff;
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
    }
    button:hover { background: #4a8abf; }
    button:disabled { background: #555; cursor: not-allowed; }
    #result {
      margin-top: 20px; padding: 12px; background: #252526; border: 1px solid #3c3c3c;
      border-radius: 4px; white-space: pre-wrap; display: none; max-height: 500px; overflow-y: auto;
    }
    .q-label { color: #4caf50; font-weight: bold; }
    .cat-label { color: #569cd6; font-weight: bold; }
    .error { color: #f44747; }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
  </style>
</head>
<body>
  <h2>Test: Categorize Utterances + Question Generation</h2>

  <div class="row">
    <div>
      <label>Book</label>
      <select id="bookSelect" onchange="loadBook()">
        <option value="">-- Select a book --</option>
        <option value="1">Book 1: Birthday Beeps and Boops</option>
        <option value="2">Book 2: Sleepover Similarities</option>
        <option value="3">Book 3: Levels in the Library</option>
      </select>
    </div>
    <div>
      <label>Page</label>
      <select id="pageSelect" onchange="selectPage()" disabled>
        <option value="">-- Select book first --</option>
      </select>
    </div>
  </div>

  <div id="pageContext" class="context-box" style="display:none">
    <div class="page-q" id="ctxQuestion"></div>
    <div id="ctxLines"></div>
  </div>

  <label>Off-script utterances (one per line)</label>
  <textarea id="utterances" placeholder="line1: Look at the pretty flowers!&#10;line2: I like the blue one&#10;line3: Can we have lunch?"></textarea>

  <button id="sendBtn" onclick="send()" disabled>Send</button>
  <div id="result"></div>

  <script>
    let bookData = null;

    async function loadBook() {
      const bookId = document.getElementById('bookSelect').value;
      const pageSel = document.getElementById('pageSelect');
      const ctx = document.getElementById('pageContext');
      bookData = null;
      pageSel.disabled = true;
      pageSel.innerHTML = '<option value="">Loading...</option>';
      ctx.style.display = 'none';
      document.getElementById('sendBtn').disabled = true;

      if (!bookId) { pageSel.innerHTML = '<option value="">-- Select book first --</option>'; return; }

      try {
        const res = await fetch('/api/book-data/' + bookId);
        bookData = await res.json();
        pageSel.innerHTML = bookData.pages.map((p, i) =>
          '<option value="' + i + '">' + p.key + '</option>'
        ).join('');
        pageSel.disabled = false;
        selectPage();
      } catch (err) {
        pageSel.innerHTML = '<option value="">Error loading book</option>';
      }
    }

    function selectPage() {
      const idx = parseInt(document.getElementById('pageSelect').value);
      const ctx = document.getElementById('pageContext');
      const btn = document.getElementById('sendBtn');
      if (!bookData || isNaN(idx)) { ctx.style.display = 'none'; btn.disabled = true; return; }

      const page = bookData.pages[idx];
      document.getElementById('ctxQuestion').textContent = 'Question: ' + (page.question || '(none)');
      document.getElementById('ctxLines').innerHTML = page.text.map(l =>
        '<div class="line"><span class="char">' + l.Character + ':</span> ' + l.Dialogue + '</div>'
      ).join('');
      ctx.style.display = 'block';
      btn.disabled = false;
    }

    function getFullBookText() {
      if (!bookData) return '';
      return bookData.pages.map((p, i) =>
        'Page ' + (i + 1) + ':\\n' + p.text.map(l => l.Character + ': ' + l.Dialogue).join('\\n')
      ).join('\\n\\n');
    }

    function getCurrentPageText() {
      const idx = parseInt(document.getElementById('pageSelect').value);
      if (!bookData || isNaN(idx)) return '';
      return bookData.pages[idx].text.map(l => l.Dialogue).join(' ');
    }

    function getCurrentPageQuestion() {
      const idx = parseInt(document.getElementById('pageSelect').value);
      if (!bookData || isNaN(idx)) return '';
      return bookData.pages[idx].question;
    }

    async function send() {
      const btn = document.getElementById('sendBtn');
      const resultDiv = document.getElementById('result');
      const pageIdx = parseInt(document.getElementById('pageSelect').value);
      btn.disabled = true;
      btn.textContent = 'Processing...';
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = '<span style="color:#888">Sending to /api/categorize-utterances...</span>';

      const body = {
        formattedUtterances: document.getElementById('utterances').value,
        bookPageText: getCurrentPageText(),
        currentPageQuestion: getCurrentPageQuestion(),
        bookText: getFullBookText(),
        currentPageNumber: pageIdx + 1
      };

      try {
        const res = await fetch('/api/categorize-utterances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');

        let html = '<div><span class="cat-label">Categorization:</span></div>';
        if (data.items) {
          data.items.forEach(item => {
            const color = item.category === 'ON_TOPIC' ? '#4caf50' : '#f44747';
            html += '<div style="margin:4px 0 4px 12px;">'
              + '<span style="color:' + color + '">[' + item.category + ']</span> '
              + item.text
              + '<span style="color:#888"> &mdash; ' + item.rationale + '</span>'
              + '</div>';
          });
        }
        if (data.summary) {
          html += '<div style="margin:8px 0 4px 12px;color:#888">Summary: ' + data.summary + '</div>';
        }
        html += '<div style="margin-top:14px;border-top:1px solid #3c3c3c;padding-top:10px;">'
          + '<span class="q-label">Generated Question:</span> '
          + (data.generatedQuestion || '<span style="color:#888">None (no ON_TOPIC utterances)</span>')
          + '</div>';
        resultDiv.innerHTML = html;
      } catch (err) {
        resultDiv.innerHTML = '<span class="error">Error: ' + err.message + '</span>';
      }
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  </script>
</body>
</html>`);
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
