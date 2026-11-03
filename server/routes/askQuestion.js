const express = require('express');
const {
    openai,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_OFFSCRIPT_REASONING_EFFORT,
    logOpenAIUsage,
    bedrockOffscript,
    BEDROCK_OFFSCRIPT_MODEL,
} = require('../lib/openai');
const { parseAskRequest, buildAskMessages, parseAskReply } = require('../lib/askQuestion');
const { streamQuestionAudio } = require('../lib/questionGen');

const router = express.Router();

const USE_BEDROCK = process.env.OFFSCRIPT_PROVIDER === 'bedrock';
const offscript = USE_BEDROCK ? bedrockOffscript : openai;

const UNSURE_ANSWER = "Hmm, I'm not sure what that is.";

// The child pressed Ask and tapped the picture. The spoken answer streams back in the
// same SSE shape as an acknowledgement, and the client plays it the same way.
router.post('/api/ask-question-stream', async (req, res) => {
    const request = parseAskRequest(req.body);
    if (!request) return res.status(400).json({ error: 'Invalid ask request' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const t0 = Date.now();
    const tlog = (label) => console.log(`[ask-question] +${Date.now() - t0}ms ${label}`);

    try {
        const messages = await buildAskMessages(request, tlog);
        tlog('images ready');

        const result = await offscript.chat.completions.create({
            model: USE_BEDROCK ? BEDROCK_OFFSCRIPT_MODEL : OPENAI_OFFSCRIPT_MODEL,
            max_completion_tokens: 512,
            reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
            verbosity: 'low',
            response_format: { type: 'json_object' },
            messages,
        });
        logOpenAIUsage('ask-question', result?.usage);

        const { answer, object } = parseAskReply(result?.choices?.[0]?.message?.content);
        tlog(`answer ready (object=${object})`);
        // An unusable reply still gets a spoken line: silence would look like the
        // app ignoring the child.
        const acknowledgement = answer || UNSURE_ANSWER;
        res.write(`data: ${JSON.stringify({ type: 'done', acknowledgement, object })}\n\n`);

        await streamQuestionAudio(res, {
            text: acknowledgement,
            voiceName: request.ttsVoiceName,
            tag: 'ask-question',
            log: tlog,
        });
        res.end();
    } catch (error) {
        console.error('Error in /api/ask-question-stream:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
