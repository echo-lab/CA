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

function parseAcknowledgement(raw, expectedAnswer) {
    const gradable = !!String(expectedAnswer || '').trim();
    const content = (raw || '').trim();
    if (!content) return { acknowledgement: '', correct: true };
    try {
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleaned);
        const acknowledgement = String(parsed?.response ?? '').trim();
        const correct = (gradable && parsed?.correct === false) ? false : true;
        return { acknowledgement, correct };
    } catch (err) {
        console.warn('[acknowledgement] failed to parse JSON, using raw content:', err?.message);
        return { acknowledgement: content, correct: true };
    }
}

router.post('/api/acknowledgement', async (req, res) => {
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
            expectedAnswer,
            book,
        } = req.body;

        if (!reply) {
            return res.status(400).json({ message: 'Provide reply' });
        }

        const pageImageMessage = buildPageImageMessage(book, currentPageNumber);
        const response = await offscript.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
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

        logOpenAIUsage('acknowledgement', response?.usage);
        const { acknowledgement, correct } = parseAcknowledgement(response?.choices?.[0]?.message?.content, expectedAnswer);
        res.json({ acknowledgement, correct });
    } catch (error) {
        console.error('Error in /api/acknowledgement:', error);
        res.status(500).json({ message: error.toString() });
    }
});

router.post('/api/acknowledgement-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const t0 = Date.now();
    const tlog = (label) => console.log(`[ack-stream] +${Date.now() - t0}ms ${label}`);
    let tImageReady = null;
    let tFirstToken = null;
    let tVerdict = null;
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

        // "correct" is the first key in the response schema, so an incorrect
        // verdict is knowable long before the rest of the object arrives — and
        // when incorrect there is nothing else to wait for, since the text is
        // suppressed and no TTS is synthesized. Emitting `done` at that moment
        // lets the client start its pre-warmed handoff line immediately.
        const gradable = !!String(expectedAnswer || '').trim();
        let raw = '';
        let usage = null;
        let finishReason = null;
        let earlyVerdictSent = false;

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

            // Only before "response" appears, so a false inside the spoken text
            // can never be mistaken for the verdict. Ungradable turns are always
            // correct regardless of what the model says, so they never early-exit.
            if (!earlyVerdictSent && gradable && !raw.includes('"response"') && /"correct"\s*:\s*false/.test(raw)) {
                earlyVerdictSent = true;
                tVerdict = Date.now();
                res.write(`data: ${JSON.stringify({ type: 'done', acknowledgement: '', correct: false })}\n\n`);
                tlog('early incorrect verdict sent — client speaks handoff now');
            }
        }
        tStreamEnd = Date.now();
        tlog('model stream complete');
        logOpenAIUsage('acknowledgement-stream', usage);

        const parsedResult = parseAcknowledgement(raw, expectedAnswer);
        const correct = parsedResult.correct;
        // On an incorrect child turn the client speaks its own handoff line, so
        // drop any text the model returned against instructions — otherwise the
        // child hears a hint and then the handoff, and TTS gets synthesized for
        // audio that should never play.
        const suppressText = correct === false;
        const acknowledgement = suppressText ? '' : parsedResult.acknowledgement;

        if (!acknowledgement && !suppressText) {
            console.warn('[acknowledgement-stream] empty acknowledgement', {
                finishReason,
                completionTokens: usage?.completion_tokens,
            });
        }
        if (earlyVerdictSent) {
            // The early exit predicted incorrect; a full parse that disagrees
            // means the client already acted on a wrong verdict.
            if (correct !== false) {
                console.warn('[ack-stream] early verdict said incorrect but full parse said correct', { raw: raw.slice(0, 200) });
            }
        } else {
            tVerdict = Date.now();
            res.write(`data: ${JSON.stringify({ type: 'done', acknowledgement, correct })}\n\n`);
        }

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
            verdict: ms(t0, tVerdict),
            modelStreamEnd: ms(t0, tStreamEnd),
            ttsFirstChunk: ms(t0, tFirstAudioChunk),
            ttsEnd: ms(t0, tAudioEnd),
            total: Date.now() - t0,
            correct,
            earlyVerdict: earlyVerdictSent,
            gradable,
            promptTokens: usage?.prompt_tokens ?? null,
            cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        });
    } catch (error) {
        console.error('Error in /api/acknowledgement-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
