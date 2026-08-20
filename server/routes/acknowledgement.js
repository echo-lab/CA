const express = require('express');
const {
    openai,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_OFFSCRIPT_REASONING_EFFORT,
    OPENAI_PROMPT_CACHE_KEY,
    OPENAI_PROMPT_CACHE_RETENTION,
    logOpenAIUsage,
    bedrockOffscript,
} = require('../lib/openai');
const { JENNIE_SHARED_PROMPT_PREFIX, ACKNOWLEDGEMENT_PROMPT } = require('../lib/prompts');
const { buildAcknowledgementPayload } = require('../lib/payloads');
const { buildPageImageMessage } = require('../lib/pageImage');
const { generateGeminiTtsChunks } = require('../liveTTS');

const router = express.Router();
const USE_BEDROCK = process.env.OFFSCRIPT_PROVIDER === 'bedrock';
const offscript = USE_BEDROCK ? bedrockOffscript : openai;

router.post('/api/acknowledgement-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const t0 = Date.now();
    const tlog = (label) => console.log(`[ack-stream] +${Date.now() - t0}ms ${label}`);
    let tImageReady = null;
    let tFirstToken = null;
    let tStreamEnd = null;
    let tFirstAudioChunk = null;
    let tAudioEnd = null;

    try {
        const {
            question,
            reply,
            currentPageQuestion,
            bookText,
            currentPageNumber,
            imageDescription,
            userAttention,
            acknowledgementHistory,
            ttsVoiceName,
            expectedAnswer,
            book,
        } = req.body;

        if (!reply) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Provide reply' })}\n\n`);
            return res.end();
        }

        const pageImageMessage = buildPageImageMessage(book, currentPageNumber);
        tImageReady = Date.now();
        tlog(`page image ready (attached=${!!pageImageMessage})`);

        const stream = await offscript.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 256,
            reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: [
                { role: "developer", content: JENNIE_SHARED_PROMPT_PREFIX },
                { role: "developer", content: ACKNOWLEDGEMENT_PROMPT },
                ...(pageImageMessage ? [pageImageMessage] : []),
                {
                    role: "user",
                    content: buildAcknowledgementPayload({
                        question,
                        reply,
                        currentPageQuestion,
                        bookText,
                        currentPageNumber,
                        imageDescription,
                        userAttention,
                        acknowledgementHistory,
                        expectedAnswer,
                    }),
                },
            ],
        });

        tlog('stream object received (request sent to model)');

        let raw = '';
        let usage = null;
        let finishReason = null;

        for await (const chunk of stream) {
            if (chunk.usage) {
                usage = chunk.usage;
                continue;
            }
            if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
            const token = chunk.choices?.[0]?.delta?.content || '';
            if (!token) continue;
            if (tFirstToken === null) {
                tFirstToken = Date.now();
                tlog('first token');
            }
            raw += token;
        }
        tStreamEnd = Date.now();
        tlog('model stream complete');
        logOpenAIUsage('acknowledgement-stream', usage);

        // Plain text out, so nothing to parse — just guard against a stray fence
        // or wrapping quotes if the model ignores the format instruction.
        const acknowledgement = raw
            .trim()
            .replace(/^```(?:\w+)?\s*/i, '')
            .replace(/\s*```$/, '')
            .replace(/^"(.*)"$/s, '$1')
            .trim();

        if (!acknowledgement) {
            console.warn('[acknowledgement-stream] empty acknowledgement', {
                finishReason,
                completionTokens: usage?.completion_tokens,
            });
        }
        res.write(`data: ${JSON.stringify({ type: 'done', acknowledgement })}\n\n`);

        if (acknowledgement) {
            try {
                for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({
                    text: acknowledgement,
                    voiceName: ttsVoiceName,
                })) {
                    if (tFirstAudioChunk === null) {
                        tFirstAudioChunk = Date.now();
                        tlog('first TTS chunk');
                    }
                    const durationMs = (sampleBytes / 2) / 24;
                    res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
                }
                tAudioEnd = Date.now();
                res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
                tlog('TTS complete');
            } catch (ttsErr) {
                console.error('[acknowledgement-stream] streaming TTS failed:', ttsErr);
                res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
            }
        }

        res.end();

        const ms = (a, b) => (a == null || b == null ? null : b - a);
        console.log('[ack-stream] summary (ms):', {
            pageImage: ms(t0, tImageReady),
            modelFirstToken: ms(t0, tFirstToken),
            modelStreamEnd: ms(t0, tStreamEnd),
            ttsFirstChunk: ms(t0, tFirstAudioChunk),
            ttsEnd: ms(t0, tAudioEnd),
            total: Date.now() - t0,
            promptTokens: usage?.prompt_tokens ?? null,
            cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
            // Splits the wait before the first content token: reasoning tokens mean
            // the model was thinking, none means the time went to prefill.
            reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
            completionTokens: usage?.completion_tokens ?? null,
            imageAttached: !!pageImageMessage,
        });
    } catch (error) {
        console.error('Error in /api/acknowledgement-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
