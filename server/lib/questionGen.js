// The question half of a turn, shared by the categorize stream and the manual button so they can't drift apart.
const {
    JENNIE_SHARED_PROMPT_PREFIX,
    FOLLOWUP_QUESTION_PROMPT,
    CLICK_QUESTION_PROMPT,
} = require('./prompts');
const { buildOpenAIDynamicPagePayload } = require('./payloads');
const { buildPageImageMessage } = require('./pageImage');
const { parseJsonFromModelText } = require('./modelParsing');
const {
    resolveClickMode,
    buildTappableObjectsBlock,
    resolveClickAnswer,
} = require('./clickAnswer');
const { generateGeminiTtsChunks } = require('../liveTTS');

// Utterance placeholder for a directly requested question: there was no conversation at all, not nothing worth using.
const NO_UTTERANCES = '(none — no conversation to draw on yet; use the page text and illustration)';

function buildQuestionMessages({
    book,
    currentPageNumber,
    currentPageQuestion,
    bookText,
    imageDescription,
    userAttention,
    formattedUtterances,
    questionHistory,
    systemQuestions,
    clickTags,
    clickMode,
}) {
    const pageImageMessage = buildPageImageMessage(book, currentPageNumber);
    return [
        { role: 'developer', content: JENNIE_SHARED_PROMPT_PREFIX },
        { role: 'developer', content: clickMode ? CLICK_QUESTION_PROMPT : FOLLOWUP_QUESTION_PROMPT },
        ...(pageImageMessage ? [pageImageMessage] : []),
        {
            role: 'user',
            content: buildOpenAIDynamicPagePayload({
                currentPageQuestion,
                bookText: clickMode && Math.random() < 0.5 ? '' : bookText,
                currentPageNumber,
                imageDescription,
                userAttention,
                utteranceTag: 'utterances',
                formattedUtterances: String(formattedUtterances || '').trim() || NO_UTTERANCES,
                questionHistory,
                systemQuestions,
            }) + (clickMode ? `\n${buildTappableObjectsBlock(clickTags)}` : ''),
        },
    ];
}

// The page image is a multi-MB base64 data URL, so it is named rather than
// inlined when the messages are echoed to the debug monitor.
function sanitizeMessagesForDebug(messages) {
    return messages.map((m) => (Array.isArray(m.content)
        ? { role: m.role, content: '[page image omitted]' }
        : m));
}

// Always returns the four fields (null when unusable); the click instruction is appended here so its wording never varies.
const CLICK_SUFFIX = 'Click it.';
function withClickSuffix(question) {
    const q = String(question || '').trim();
    if (!q) return q;
    if (/\bclick it[.!?]?$/i.test(q)) return q;  // model already ended with it
    return `${q} ${CLICK_SUFFIX}`;
}

function resolveQuestion(rawQuestion, { clickMode, clickTags, clickLabels, log = () => {} }) {
    const raw = String(rawQuestion || '').trim();
    const empty = { generatedQuestion: null, expectedAnswer: null, answerLabel: null, answerBox: null };
    if (!raw) return empty;

    if (clickMode) {
        // The answer is the tag's own box; a label that isn't a real tag drops the question.
        const click = resolveClickAnswer(raw, clickTags);
        if (!click) {
            console.warn('[questionGen] click question rejected — label not in tag list', {
                raw: raw.slice(0, 200),
                labels: clickLabels,
            });
            return empty;
        }
        const question = withClickSuffix(click.question);
        log(`click question -> "${question}" (answer: "${click.answerLabel}" at [${click.answerBox}])`);
        return {
            generatedQuestion: question,
            expectedAnswer: click.answerLabel,
            answerLabel: click.answerLabel,
            answerBox: click.answerBox,
        };
    }

    // Spoken question returns { question, expected_answer }. Fall back to treating
    // the whole output as the question if it isn't valid JSON.
    const parsed = parseJsonFromModelText(raw, null);
    if (parsed && typeof parsed.question === 'string') {
        const ea = parsed.expected_answer;
        return {
            ...empty,
            generatedQuestion: parsed.question.trim() || null,
            expectedAnswer: (ea == null || ea === '') ? null : String(ea).trim(),
        };
    }
    return { ...empty, generatedQuestion: raw };
}

// Streams the spoken question as SSE audio chunks; never throws (a TTS failure sends audio_error but keeps the question).
async function streamQuestionAudio(res, { text, voiceName, tag = 'question', log = () => {} }) {
    if (!text || !voiceName) return;
    const t0 = Date.now();
    let first = null;
    let chunks = 0;
    try {
        for await (const { seq, audioContent, sampleBytes } of generateGeminiTtsChunks({ text, voiceName })) {
            if (first === null) {
                first = Date.now();
                log(`tts first chunk after ${first - t0}ms`);
            }
            // PCM is 16-bit (2 bytes) mono at 24kHz → durationMs = (samples / 24)
            const durationMs = (sampleBytes / 2) / 24;
            res.write(`data: ${JSON.stringify({ type: 'audio_chunk', seq, audioContent, durationMs })}\n\n`);
            chunks++;
        }
        res.write(`data: ${JSON.stringify({ type: 'audio_end' })}\n\n`);
        log(`tts streaming complete in ${Date.now() - t0}ms (${chunks} chunks)`);
    } catch (ttsErr) {
        console.error(`[${tag}] streaming TTS failed:`, ttsErr);
        res.write(`data: ${JSON.stringify({ type: 'audio_error', message: String(ttsErr?.message || ttsErr) })}\n\n`);
    }
}

module.exports = {
    NO_UTTERANCES,
    resolveClickMode,
    buildQuestionMessages,
    sanitizeMessagesForDebug,
    resolveQuestion,
    streamQuestionAudio,
};
