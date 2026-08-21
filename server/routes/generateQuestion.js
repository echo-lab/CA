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
const {
    resolveClickMode,
    buildQuestionMessages,
    sanitizeMessagesForDebug,
    resolveQuestion,
    streamQuestionAudio,
} = require('../lib/questionGen');

const router = express.Router();

const USE_BEDROCK = process.env.OFFSCRIPT_PROVIDER === 'bedrock';
const offscript = USE_BEDROCK ? bedrockOffscript : openai;

// Asked for directly by tapping the mate, rather than provoked by something said.
// Same prompt and same click handling as the conversational path — the only
// difference is that there may be no utterances to draw on, which the payload
// says explicitly so the model leans on the page text and illustration instead.
router.post('/api/generate-question-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const t0 = Date.now();
    const tlog = (label) => console.log(`[gen-question] +${Date.now() - t0}ms ${label}`);

    const {
        currentPageQuestion,
        bookText,
        currentPageNumber,
        imageDescription,
        userAttention,
        lastGeneratedQuestion,
        systemQuestions,
        formattedUtterances,
        ttsVoiceName,
        book,
        clickTags,
    } = req.body;

    try {
        const { clickMode, clickLabels, wanted: wantsClick } = resolveClickMode(clickTags);
        if (wantsClick && !clickMode) {
            tlog(`coin flip wanted a click question but no usable tags (${(clickTags || []).length} received) — falling back to a spoken question`);
        }

        const messages = buildQuestionMessages({
            book,
            currentPageNumber,
            currentPageQuestion,
            bookText,
            imageDescription,
            userAttention,
            formattedUtterances,
            lastGeneratedQuestion,
            systemQuestions,
            clickTags,
            clickMode,
        });

        res.write(`data: ${JSON.stringify({
            type: 'question_prompt',
            messages: sanitizeMessagesForDebug(messages),
        })}\n\n`);

        tlog(`requesting a question on demand (clickMode=${clickMode}, utterances=${formattedUtterances ? 'yes' : 'none'})`);
        const result = await offscript.chat.completions.create({
            model: OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 512,
            reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
            verbosity: 'low',
            response_format: { type: 'json_object' },
            prompt_cache_key: OPENAI_PROMPT_CACHE_KEY,
            prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
            messages,
        });
        logOpenAIUsage('gen-question', result?.usage);

        const { generatedQuestion, expectedAnswer, answerLabel, answerBox } = resolveQuestion(
            result?.choices?.[0]?.message?.content,
            { clickMode, clickTags, clickLabels, log: tlog },
        );

        if (!generatedQuestion) {
            tlog('no usable question produced');
        }
        res.write(`data: ${JSON.stringify({ type: 'done', generatedQuestion, expectedAnswer, answerLabel, answerBox })}\n\n`);

        await streamQuestionAudio(res, {
            text: generatedQuestion,
            voiceName: ttsVoiceName,
            tag: 'gen-question',
            log: tlog,
        });

        res.end();
        tlog(`complete (question=${!!generatedQuestion})`);
    } catch (error) {
        console.error('Error in /api/generate-question-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
