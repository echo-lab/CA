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

        logOpenAIUsage('acknowledgement-stream', response?.usage);
        const parsedResult = parseAcknowledgement(response?.choices?.[0]?.message?.content, expectedAnswer);
        const correct = parsedResult.correct;
        // On an incorrect child turn the client speaks its own handoff line, so
        // drop any text the model returned against instructions — otherwise the
        // child hears a hint and then the handoff, and TTS gets synthesized for
        // audio that should never play.
        const suppressText = correct === false;
        const acknowledgement = suppressText ? '' : parsedResult.acknowledgement;

        if (!acknowledgement && !suppressText) {
            console.warn('[acknowledgement-stream] empty acknowledgement', {
                finishReason: response?.choices?.[0]?.finish_reason,
                completionTokens: response?.usage?.completion_tokens,
            });
        }
        res.write(`data: ${JSON.stringify({ type: 'done', acknowledgement, correct })}\n\n`);

        if (acknowledgement) {
            try {
                for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({
                    text: acknowledgement,
                    voiceName: ttsVoiceName,
                })) {
                    const durationMs = (sampleBytes / 2) / 24;
                    res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
            } catch (ttsErr) {
                console.error('[acknowledgement-stream] streaming TTS failed:', ttsErr);
                res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
            }
        }

        res.end();
    } catch (error) {
        console.error('Error in /api/acknowledgement-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
