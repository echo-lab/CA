const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const WebSocket = require('ws');
const OpenAI = require('openai');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { registerLiveTtsRoutes, generateGeminiTtsChunks } = require('./liveTTS');
const { setupEducationalQuestionRoutes } = require('./ModelsCommunication');
const { setupGeminiLiveProxy } = require('./geminiLiveProxy');

const { startPruner } = require('./lib/cache/prune');
startPruner();

const imageCache = require('./lib/cache/imageCache');

const GOOGLE_API_KEY = process.env.GOOGLEAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const PROMPT_VERSION = 'talemate-offscript-v1';
const OPENAI_PROMPT_CACHE_KEY = PROMPT_VERSION;
const OPENAI_PROMPT_CACHE_RETENTION = '24h';
const OPENAI_OFFSCRIPT_MODEL = 'gpt-5-mini';

const TALEMATE_SHARED_PROMPT_PREFIX = `TaleMate is a parent-child co-reading system for children's picture books.
Audience: toddlers and young children, roughly ages 3-6, reading with a caregiver.
Primary goal: keep the interaction grounded in the current book page, the child/caregiver utterance, and the visible illustration.
Style requirements:
- Use concrete, child-friendly language.
- Prefer short responses.
- Do not invent story facts, objects, names, or emotions not supported by the provided text or image context.
- Character grounding: Zoe is the bird. Clara is the chameleon. Use character names when known.
Prompt version: ${PROMPT_VERSION}`;

const OFFSCRIPT_CATEGORIZATION_PROMPT = `Task: classify off-script utterances for the current page. When classifying put more weight on the latest part of the utterance.

Output one JSON object as one NDJSON line for each utterance, with no extra text.

Categories:
1. ON_TOPIC
- Directly addresses the current page's narrative, character emotions, or visual details.
- Shows accurate comprehension of the story, including correct character names/genders.
- Can use pronouns or partial descriptions instead of character names when the meaning is clearly grounded in the current page.
- Must be substantive. Do not use for one-word fillers.
- Related to the current page question as long as it is not a regurgitation of existing page question.
- The utterance must open up a meaningfully NEW angle relative to any <pending_question>.

2. OFF_TOPIC
- NON_SUBSTANTIVE: Fillers, presence signals, or empty reactions.
- EXTERNAL: Daily chat or physical environment comments.
- RELVANCY: The latest addition to utterance is off-topic, even if earlier parts were on-topic.
- REDUNDANT: The utterance is on-topic but would only prompt a follow-up question nearly identical to the <pending_question> still awaiting the child's response.

Output schema:
{"category":"ON_TOPIC"|"OFF_TOPIC","reason":"<one short sentence, max 20 words, explaining the classification>"}`;

const FOLLOWUP_QUESTION_PROMPT = `Task: generate one short, engaging follow-up question for a toddler.

Use the child's/caregiver's utterance, the current page text, the page question, and image context when available.
Build on what the user noticed. Keep it natural, like a parent would ask. Prefer concrete "who/what/where/why" questions, description prompts, simple recall, or completion-style prompts.

Output only the question. No explanation, no preface.`;

const REINFORCEMENT_PROMPT = `Task: generate one brief reinforcement response for a toddler in a co-reading session.

Use the latest child/caregiver utterance, the last asked question, the current page text, prior reinforcement turns, and image context when available.
Affirm what the user said, gently connect it to the book or pattern idea, and keep the response natural for a parent to say aloud.
Do not ask a new question. Do not introduce unrelated facts. Do not mention that you are an AI.

Output only the reinforcement response. No explanation, no preface.`;

const GEMINI_IMAGE_CHARACTER_RULES = `You are working with TaleMate children's picture book illustrations.
Character rules:
- Zoe is the bird. Any bird you see is always Zoe.
- Clara is the chameleon. Any chameleon or lizard you see will most likely be Clara.
- Always call them by name when referring to those characters.`;

const GEMINI_IMAGE_ANALYSIS_PROMPT = `${GEMINI_IMAGE_CHARACTER_RULES}
Answer as a parent speaking to a child.
Give a SHORT answer of 1 sentence.`;

const GEMINI_IMAGE_TAGGING_PROMPT = `${GEMINI_IMAGE_CHARACTER_RULES}
Detect the characters and key story objects: props, clothing, and held items visible in this illustration.
Keep bounding boxes tight.
If an object appears multiple times, give each a unique label.
Limit to 20 objects.
Return just box_2d ([y_min, x_min, y_max, x_max] normalized 0-1000) and label for each. No additional text.`;

const GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC = Number(process.env.GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC || 60 * 60);

const geminiImageContextCache = new Map();

function buildOpenAIDynamicPagePayload({
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    utteranceTag,
    formattedUtterances,
    pendingGeneratedQuestion,
}) {
    const pendingBlock = pendingGeneratedQuestion
        ? `<pending_question>\n"${pendingGeneratedQuestion}"\n(This question was generated for the child but has not yet been played/answered. Avoid producing another that would be redundant with it.)\n</pending_question>\n`
        : '';
    return `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText || ''}
Question: "${currentPageQuestion || ''}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User Attention: "${userAttention}"` : ''}\n</image_context>\n` : ''}${pendingBlock}<${utteranceTag}>
${formattedUtterances}
</${utteranceTag}>`;
}

function buildReinforcementPayload({
    question,
    reply,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    reinforcementHistory,
}) {
    const history = Array.isArray(reinforcementHistory)
        ? reinforcementHistory
            .slice(-8)
            .map((turn, idx) => `[Turn ${idx + 1}] User: "${turn.user || ''}"\nResponse: "${turn.response || ''}"`)
            .join('\n')
        : '';

    return `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText || ''}
Page Question: "${currentPageQuestion || ''}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User Attention: "${userAttention}"` : ''}\n</image_context>\n` : ''}<reinforcement_context>
Last Asked Question: "${question || currentPageQuestion || ''}"
Latest User Utterance: "${reply || ''}"
${history ? `Prior Reinforcement Turns:\n${history}` : 'Prior Reinforcement Turns: none'}
</reinforcement_context>`;
}

function getCachedPromptTokens(usage) {
    return usage?.prompt_tokens_details?.cached_tokens ?? usage?.promptTokensDetails?.cachedTokens ?? null;
}

function logOpenAIUsage(label, usage) {
    if (!usage) return;
    console.log(`[${label}] OpenAI usage`, {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cachedTokens: getCachedPromptTokens(usage),
    });
}

function parseCategorizationLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;
    const jsonish = trimmed
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        const item = JSON.parse(jsonish);
        return item && typeof item === 'object' && typeof item.category === 'string' ? item : null;
    } catch {
        const match = jsonish.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                const item = JSON.parse(match[0]);
                return item && typeof item === 'object' && typeof item.category === 'string' ? item : null;
            } catch {}
        }
        return null;
    }
}

function parseJsonFromModelText(text, fallback) {
    const raw = String(text || '').trim();
    if (!raw) return fallback;
    const jsonish = raw
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(jsonish);
    } catch {
        const arrayMatch = jsonish.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]);
            } catch {}
        }
        const objectMatch = jsonish.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                return JSON.parse(objectMatch[0]);
            } catch {}
        }
        return fallback;
    }
}

function normalizePageTextForCache(pageText) {
    return String(pageText || '').replace(/\s+/g, ' ').trim();
}

function buildGeminiImageContextKey({ book, page, model, pageText, imageData }) {
    return JSON.stringify({
        v: imageCache.CFG.version,
        book: String(book),
        page: String(page),
        model,
        pageText: normalizePageTextForCache(pageText),
        imageHash: crypto.createHash('sha256').update(imageData).digest('hex'),
    });
}

async function getGeminiImageContextCache({ ai, model, book, page, pageText, imageData }) {
    const key = buildGeminiImageContextKey({ book, page, model, pageText, imageData });
    const now = Date.now();
    const existing = geminiImageContextCache.get(key);
    if (existing && existing.expiresAt > now) {
        return existing.promise;
    }

    const contents = [{
        role: 'user',
        parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageData } },
            {
                text: `${GEMINI_IMAGE_CHARACTER_RULES}
Shared page context for later image analysis and tagging requests.
${pageText ? `Page text:\n${pageText}` : 'No page text provided.'}`,
            },
        ],
    }];
    const promise = ai.caches.create({
        model,
        config: {
            displayName: `talemate-image-context-book-${book}-page-${page}`,
            contents,
            ttl: `${GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC}s`,
        },
    }).then(cache => {
        console.log('[image-context-cache] READY', {
            book,
            page,
            model,
            cacheName: cache.name,
            usageMetadata: cache.usageMetadata || cache.usage_metadata,
        });
        return cache;
    }).catch(err => {
        geminiImageContextCache.delete(key);
        console.warn('[image-context-cache] unavailable, falling back to inline image:', err?.message || err);
        return null;
    });

    geminiImageContextCache.set(key, {
        expiresAt: now + (GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC * 1000),
        promise,
    });
    return promise;
}

function buildInlineImageContents({ imageData, pageText, taskText }) {
    return [{
        role: 'user',
        parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageData } },
            { text: `${taskText}${pageText ? `\n\nPage text:\n${pageText}` : ''}` },
        ],
    }];
}

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
            punctuate: true,
            interim_results: true,
            diarize: true,
            smart_format: true,
            endpointing: 500,
            utterance_end_ms: 1200,
            vad_events: true,
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

    const MODEL = 'gemini-2.5-flash';
    const bypass = req.headers[imageCache.CFG.bypassHeader] === '1';
    const { base } = imageCache.buildKey({
      kind: 'analyze',
      book: String(book),
      page: String(page),
      model: MODEL,
      pageText,
      question,
    });
    if (!bypass) {
      const cached = await imageCache.readIfFresh(base);
      if (cached.state === 'HIT') {
        res.setHeader('x-cache', 'HIT');
        return res.json(cached.data);
      }
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
    const contextCache = await getGeminiImageContextCache({ ai, model: MODEL, book, page, pageText, imageData });
    const request = contextCache
      ? {
          model: MODEL,
          contents: [{
            role: 'user',
            parts: [{ text: `${GEMINI_IMAGE_ANALYSIS_PROMPT}\n\nQuestion:\n${question}` }],
          }],
          config: {
            cachedContent: contextCache.name,
          },
        }
      : {
          model: MODEL,
          contents: buildInlineImageContents({ imageData, pageText, taskText: question }),
          config: {
            systemInstruction: GEMINI_IMAGE_ANALYSIS_PROMPT,
          },
        };
    const response = await ai.models.generateContent({
      ...request,
    });
    if (response.usageMetadata || response.usage_metadata) {
      console.log('[image-analysis] Gemini usage', response.usageMetadata || response.usage_metadata);
    }

    const payload = { answer: response.text ?? '' };
    imageCache.write(base, payload).catch(err => console.warn('[image cache] analyze write failed', err));
    res.setHeader('x-cache', 'MISS');
    res.json(payload);
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

    const MODEL = 'gemini-2.5-flash';
    const bypass = req.headers[imageCache.CFG.bypassHeader] === '1';
    const { base } = imageCache.buildKey({
      kind: 'tag',
      book: String(book),
      page: String(page),
      model: MODEL,
      pageText,
    });
    if (!bypass) {
      const cached = await imageCache.readIfFresh(base);
      if (cached.state === 'HIT') {
        res.setHeader('x-cache', 'HIT');
        return res.json(cached.data);
      }
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
    const contextCache = await getGeminiImageContextCache({ ai, model: MODEL, book, page, pageText, imageData });
    const request = contextCache
      ? {
          model: MODEL,
          contents: [{
            role: 'user',
            parts: [{
              text: `${GEMINI_IMAGE_TAGGING_PROMPT}

Return a JSON array only. Each item must be:
{"label":"object name","box_2d":[y_min,x_min,y_max,x_max]}`,
            }],
          }],
          config: {
            cachedContent: contextCache.name,
          },
        }
      : {
          model: MODEL,
          contents: buildInlineImageContents({
            imageData,
            pageText,
            taskText: 'Tag this image using the required JSON schema.',
          }),
          config: {
            systemInstruction: GEMINI_IMAGE_TAGGING_PROMPT,
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
        };
    const response = await ai.models.generateContent({
      ...request,
    });
    if (response.usageMetadata || response.usage_metadata) {
      console.log('[image-tagging] Gemini usage', response.usageMetadata || response.usage_metadata);
    }

    const tags = parseJsonFromModelText(response.text, []);
    const payload = { tags };
    imageCache.write(base, payload).catch(err => console.warn('[image cache] tag write failed', err));
    res.setHeader('x-cache', 'MISS');
    res.json(payload);
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
    let categorizationUsage = null;

    const { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, pendingGeneratedQuestion, ttsVoiceName } = req.body;

    if (!formattedUtterances) {
        res.write(`data: ${JSON.stringify({ error: 'Missing required fields' })}\n\n`);
        return res.end();
    }

    try {
        const questionAbortController = new AbortController();
        tlog(`handler start, both OpenAI calls about to launch promptVersion=${PROMPT_VERSION} cacheKey=${OPENAI_PROMPT_CACHE_KEY}`);
        const categorizationMessages = [
            { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
            { role: "developer", content: OFFSCRIPT_CATEGORIZATION_PROMPT },
            {
                role: "user",
                content: buildOpenAIDynamicPagePayload({
                    currentPageQuestion,
                    bookText,
                    currentPageNumber,
                    imageDescription,
                    userAttention,
                    utteranceTag: 'off_script_utterances',
                    formattedUtterances,
                    pendingGeneratedQuestion,
                }),
            },
        ];
        const questionMessages = [
            { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
            { role: "developer", content: FOLLOWUP_QUESTION_PROMPT },
            {
                role: "user",
                content: buildOpenAIDynamicPagePayload({
                    currentPageQuestion,
                    bookText,
                    currentPageNumber,
                    imageDescription,
                    userAttention,
                    utteranceTag: 'utterances',
                    formattedUtterances,
                    pendingGeneratedQuestion,
                }),
            },
        ];

        // Start categorization and question generation simultaneously
        const categorizationStreamPromise = openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 512,
            reasoning_effort: 'minimal',
            verbosity: 'low',
            response_format: { type: 'json_object' },
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: categorizationMessages,
        });

        const questionPromise = openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 48,
            reasoning_effort: 'minimal',
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: questionMessages,
        }, { signal: questionAbortController.signal }).catch(err => {
            if (err.name === 'AbortError' || err instanceof OpenAI.APIUserAbortError || err.code === 'ERR_CANCELED') return null;
            throw err;
        });

        // Stream categorization items
        const categorizationStream = await categorizationStreamPromise;
        tlog('categorization stream object received (request sent to OpenAI)');
        const items = [];
        let buffer = '';
        let rawCategorizationText = '';
        let categorizationFinishReason = null;
        let hasOnTopic = false;

        for await (const chunk of categorizationStream) {
            if (chunk.usage) {
                categorizationUsage = chunk.usage;
                continue;
            }
            if (chunk.choices?.[0]?.finish_reason) {
                categorizationFinishReason = chunk.choices[0].finish_reason;
            }
            if (tFirstChunk === null) {
                tFirstChunk = Date.now();
                tlog('first chunk arrived from OpenAI');
            }
            const token = chunk.choices?.[0]?.delta?.content || '';
            buffer += token;
            rawCategorizationText += token;

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const item = parseCategorizationLine(line);
                if (item) {
                    if (tFirstItem === null) {
                        tFirstItem = Date.now();
                        tlog('first parsed item written to client');
                    }
                    tLastItem = Date.now();
                    items.push(item);
                    res.write(`data: ${JSON.stringify({ type: 'item', item })}\n\n`);
                    console.log(`[cat-stream] item: ${item.category}${item.reason ? ` — ${item.reason}` : ''}`);
                    if (item.category === 'ON_TOPIC') hasOnTopic = true;
                    else questionAbortController.abort();
                }
            }
        }
        tlog(`categorization stream complete (${items.length} items, hasOnTopic=${hasOnTopic})`);
        logOpenAIUsage('cat-stream/categorization', categorizationUsage);

        // Flush remaining buffer
        if (buffer.trim()) {
            const item = parseCategorizationLine(buffer);
            if (item) {
                if (tFirstItem === null) tFirstItem = Date.now();
                tLastItem = Date.now();
                items.push(item);
                res.write(`data: ${JSON.stringify({ type: 'item', item })}\n\n`);
                console.log('Categorization item (from flush):', item);
                if (item.category === 'ON_TOPIC') hasOnTopic = true;
                else questionAbortController.abort();
            }
        }

        if (items.length === 0) {
            console.warn('[cat-stream] no categorization item parsed', {
                rawText: rawCategorizationText.slice(0, 500),
                rawLength: rawCategorizationText.length,
                finishReason: categorizationFinishReason,
            });
            tlog('retrying categorization without streaming');
            const retryResult = await openai.chat.completions.create({
                model: OPENAI_OFFSCRIPT_MODEL,
                max_completion_tokens: 512,
                reasoning_effort: 'minimal',
                verbosity: 'low',
                response_format: { type: 'json_object' },
                prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
                prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
                messages: categorizationMessages,
            });
            logOpenAIUsage('cat-stream/categorization-retry', retryResult?.usage);
            const retryText = retryResult?.choices?.[0]?.message?.content || '';
            const retryItem = parseCategorizationLine(retryText);
            if (retryItem) {
                if (tFirstItem === null) tFirstItem = Date.now();
                tLastItem = Date.now();
                items.push(retryItem);
                res.write(`data: ${JSON.stringify({ type: 'item', item: retryItem })}\n\n`);
                if (retryItem.category === 'ON_TOPIC') hasOnTopic = true;
                else questionAbortController.abort();
                tlog('categorization retry parsed one item');
            } else {
                console.warn('[cat-stream] categorization retry also produced no parseable item', {
                    rawText: retryText.slice(0, 500),
                    rawLength: retryText.length,
                    finishReason: retryResult?.choices?.[0]?.finish_reason,
                });
            }
        }

        // Categorization done — decide whether to use or cancel question generation
        // const hasOnTopic = items.some(i => i.category === 'ON_TOPIC');
        let generatedQuestion = null;

        if (hasOnTopic) {
            console.log("Generating question based on ON_TOPIC utterance(s)");
            const qResult = await questionPromise;
            tlog('question generation complete');
            logOpenAIUsage('cat-stream/question', qResult?.usage);
            generatedQuestion = qResult?.choices[0]?.message?.content?.trim() || null;
        } else {
            questionAbortController.abort();
            tlog('question generation aborted (no ON_TOPIC)');
        }

        res.write(`data: ${JSON.stringify({ type: 'done', generatedQuestion })}\n\n`);

        if (generatedQuestion && ttsVoiceName) {
            const tTtsStart = Date.now();
            let tFirstChunkOut = null;
            let chunksSent = 0;
            try {
                for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({
                    text: generatedQuestion,
                    voiceName: ttsVoiceName,
                })) {
                    if (tFirstChunkOut === null) {
                        tFirstChunkOut = Date.now();
                        tlog(`tts first chunk after ${tFirstChunkOut - tTtsStart}ms`);
                    }
                    console.log(`Chunk ${seq + 1} generated`);
                    // PCM is 16-bit (2 bytes) mono at 24kHz → durationMs = (samples / 24)
                    const durationMs = (sampleBytes / 2) / 24;
                    res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
                    chunksSent++;
                }
                res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
                tlog(`tts streaming complete in ${Date.now() - tTtsStart}ms (${chunksSent} chunks)`);
            } catch (ttsErr) {
                console.error('[cat-stream] streaming TTS failed:', ttsErr);
                res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
            }
        }

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

app.post('/api/reinforcement', async (req, res) => {
    try {
        const {
            question,
            reply,
            currentPageQuestion,
            bookText,
            currentPageNumber,
            imageDescription,
            userAttention,
            reinforcementHistory,
        } = req.body;

        if (!reply) {
            return res.status(400).json({ message: 'Provide reply' });
        }

        const response = await openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 80,
            reasoning_effort: 'minimal',
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: [
                { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
                { role: "developer", content: REINFORCEMENT_PROMPT },
                {
                    role: "user",
                    content: buildReinforcementPayload({
                        question,
                        reply,
                        currentPageQuestion,
                        bookText,
                        currentPageNumber,
                        imageDescription,
                        userAttention,
                        reinforcementHistory,
                    }),
                },
            ],
        });

        logOpenAIUsage('reinforcement', response?.usage);
        const reinforcement = response?.choices?.[0]?.message?.content?.trim() || '';
        res.json({ reinforcement });
    } catch (error) {
        console.error('Error in /api/reinforcement:', error);
        res.status(500).json({ message: error.toString() });
    }
});

app.post('/api/reinforcement-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const {
            question,
            reply,
            currentPageQuestion,
            bookText,
            currentPageNumber,
            imageDescription,
            userAttention,
            reinforcementHistory,
            ttsVoiceName,
        } = req.body;

        if (!reply) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Provide reply' })}\n\n`);
            return res.end();
        }

        const response = await openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 80,
            reasoning_effort: 'minimal',
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: [
                { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
                { role: "developer", content: REINFORCEMENT_PROMPT },
                {
                    role: "user",
                    content: buildReinforcementPayload({
                        question,
                        reply,
                        currentPageQuestion,
                        bookText,
                        currentPageNumber,
                        imageDescription,
                        userAttention,
                        reinforcementHistory,
                    }),
                },
            ],
        });

        logOpenAIUsage('reinforcement-stream', response?.usage);
        const reinforcement = response?.choices?.[0]?.message?.content?.trim() || '';
        res.write(`data: ${JSON.stringify({ type: 'done', reinforcement })}\n\n`);

        if (reinforcement) {
            try {
                for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({
                    text: reinforcement,
                    voiceName: ttsVoiceName,
                })) {
                    const durationMs = (sampleBytes / 2) / 24;
                    res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
            } catch (ttsErr) {
                console.error('[reinforcement-stream] streaming TTS failed:', ttsErr);
                res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
            }
        }

        res.end();
    } catch (error) {
        console.error('Error in /api/reinforcement-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

app.post('/api/generated-question-test-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const { questionText, ttsVoiceName } = req.body;
        const generatedQuestion = String(questionText || '').trim();

        if (!generatedQuestion) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Provide questionText' })}\n\n`);
            return res.end();
        }

        res.write(`data: ${JSON.stringify({ type: 'done', generatedQuestion })}\n\n`);

        {
            try {
                for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({
                    text: generatedQuestion,
                    voiceName: ttsVoiceName,
                })) {
                    const durationMs = (sampleBytes / 2) / 24;
                    res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
            } catch (ttsErr) {
                console.error('[generated-question-test-stream] streaming TTS failed:', ttsErr);
                res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
            }
        }

        res.end();
    } catch (error) {
        console.error('Error in /api/generated-question-test-stream:', error);
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

async function synthesizeSpeech({ text, voice }) {
    if (!text || !voice) throw new Error('synthesizeSpeech: text and voice required');
    const fetch = (await import('node-fetch')).default;
    const sanitizedText = String(text).replace(/(\*)+/g, '').replace(/'/g, '"');
    const ssmlText = `<speak>${sanitizedText}</speak>`;
    const request = {
        input: { ssml: ssmlText },
        voice,
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.8 },
    };
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    const raw = await response.text();
    if (!response.ok) {
        console.error('TTS API responded with status', response.status);
        console.error('TTS API error body:', raw);
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return JSON.parse(raw);
}

app.post('/synthesize', async (req, res) => {
    try {
        console.log('/synthesize request body:', JSON.stringify(req.body, null, 2));
        const data = await synthesizeSpeech({ text: req.body.text, voice: req.body.voice });
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

// Survey responses — appended to server/survey-log.csv
// Payload: { name, book, condition, answers }
// answers: { "0": 1..5, "1": 1..5, ... } (one entry per question index)
app.post('/api/log-survey', (req, res) => {
    const { name, book, condition, answers } = req.body || {};
    if (!name || !book || !condition || !answers || typeof answers !== 'object') {
        return res.status(400).json({ message: 'Provide {name, book, condition, answers}' });
    }

    const NUM_QUESTIONS = 9;
    const csvPath = path.join(__dirname, 'survey-log.csv');
    const timestamp = new Date().toISOString();

    const qHeaders = Array.from({ length: NUM_QUESTIONS }, (_, i) => `q${i + 1}`).join(',');
    const header = `timestamp,name,book,condition,${qHeaders}\n`;

    const qValues = Array.from({ length: NUM_QUESTIONS }, (_, i) => answers[i] ?? '').join(',');
    const row = `${timestamp},${name},${book},${condition},${qValues}\n`;

    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, header + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }
    console.log(`[survey-log] ${name}, book ${book}, ${condition}`);
    res.json({ success: true });
});

// Download survey log CSV
app.get('/api/log-survey/download', (req, res) => {
    const csvPath = path.join(__dirname, 'survey-log.csv');
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ message: 'No survey log found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=survey-log.csv');
    res.sendFile(csvPath);
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
