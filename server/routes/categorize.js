const express = require('express');
const {
    openai,
    OpenAI,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_PROMPT_CACHE_KEY,
    OPENAI_PROMPT_CACHE_RETENTION,
    PROMPT_VERSION,
    logOpenAIUsage,
} = require('../lib/openai');
const {
    TALEMATE_SHARED_PROMPT_PREFIX,
    OFFSCRIPT_CATEGORIZATION_PROMPT,
    FOLLOWUP_QUESTION_PROMPT,
} = require('../lib/prompts');
const { buildOpenAIDynamicPagePayload } = require('../lib/payloads');
const { parseCategorizationLine } = require('../lib/modelParsing');
const { generateGeminiTtsChunks } = require('../liveTTS');

const router = express.Router();

router.post('/api/categorize-utterances-stream', async (req, res) => {
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

module.exports = router;
