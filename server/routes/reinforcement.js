const express = require('express');
const {
    openai,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_OFFSCRIPT_REASONING_EFFORT,
    OPENAI_PROMPT_CACHE_KEY,
    OPENAI_PROMPT_CACHE_RETENTION,
    logOpenAIUsage,
} = require('../lib/openai');
const { TALEMATE_SHARED_PROMPT_PREFIX, REINFORCEMENT_PROMPT } = require('../lib/prompts');
const { buildReinforcementPayload } = require('../lib/payloads');
const { buildPageImageMessage } = require('../lib/pageImage');
const { generateGeminiTtsChunks } = require('../liveTTS');

const router = express.Router();

router.post('/api/reinforcement', async (req, res) => {
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
            expectedAnswer,
            book,
        } = req.body;

        if (!reply) {
            return res.status(400).json({ message: 'Provide reply' });
        }

        const pageImageMessage = buildPageImageMessage(book, currentPageNumber);
        const response = await openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 256,
            reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: [
                { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
                { role: "developer", content: REINFORCEMENT_PROMPT },
                ...(pageImageMessage ? [pageImageMessage] : []),
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
                        expectedAnswer,
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

router.post('/api/reinforcement-stream', async (req, res) => {
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
            expectedAnswer,
            book,
        } = req.body;

        if (!reply) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Provide reply' })}\n\n`);
            return res.end();
        }

        const pageImageMessage = buildPageImageMessage(book, currentPageNumber);
        const response = await openai.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 256,
            reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
            verbosity: 'low',
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages: [
                { role: "developer", content: TALEMATE_SHARED_PROMPT_PREFIX },
                { role: "developer", content: REINFORCEMENT_PROMPT },
                ...(pageImageMessage ? [pageImageMessage] : []),
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
                        expectedAnswer,
                    }),
                },
            ],
        });

        logOpenAIUsage('reinforcement-stream', response?.usage);
        const reinforcement = response?.choices?.[0]?.message?.content?.trim() || '';
        if (!reinforcement) {
            console.warn('[reinforcement-stream] empty reinforcement', {
                finishReason: response?.choices?.[0]?.finish_reason,
                completionTokens: response?.usage?.completion_tokens,
            });
        }
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

router.post('/api/generated-question-test-stream', async (req, res) => {
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

module.exports = router;
