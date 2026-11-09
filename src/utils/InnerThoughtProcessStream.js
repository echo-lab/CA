import { gptDebugLog } from "./debugMonitor";
import * as studyLog from "./studyLog";

// Reads an SSE body and passes each event's JSON to onEvent; bad events are logged and skipped.
async function readSSE(response, onEvent, errorLabel) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) return;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop(); // keep incomplete last event

        for (const event of events) {
            const dataLine = event.split('\n').find(l => l.startsWith('data: '));
            if (!dataLine) continue;
            try { onEvent(JSON.parse(dataLine.slice(6))); }
            catch (e) { console.error(errorLabel, e); }
        }
    }
}

// Hands the question over on its first audio chunk (audioComplete false while more is coming), so it's never shown before it can be spoken.
function createQuestionHandoff({ onQuestionReady, onAudioChunk, onAudioError }) {
    let pending = null;
    const pendingChunks = [];
    let delivered = false;

    const deliver = (reason, audioComplete) => {
        if (delivered || !pending) return;
        delivered = true;
        if (typeof onQuestionReady !== 'function') return;
        try { onQuestionReady(pending.question, pending.expectedAnswer, pending.click, pendingChunks, reason, audioComplete); }
        catch (cbErr) { console.error('onQuestionReady callback error:', cbErr); }
    };

    return {
        deliver,
        // answerBox is the tag's own region — the click hit test uses it
        // verbatim, so it must survive to the caller.
        setQuestion(parsed) {
            pending = {
                question: parsed.generatedQuestion,
                expectedAnswer: parsed.expectedAnswer ?? null,
                click: {
                    answerLabel: parsed.answerLabel ?? null,
                    answerBox: parsed.answerBox ?? null,
                },
            };
        },
        audioChunk(parsed) {
            if (delivered) {
                // Already on screen — feed the live player directly.
                if (typeof onAudioChunk === 'function') {
                    try { onAudioChunk(parsed.seq, parsed.audioContent, parsed.durationMs); }
                    catch (cbErr) { console.error('onAudioChunk callback error:', cbErr); }
                }
            } else {
                pendingChunks.push({ seq: parsed.seq, audioContent: parsed.audioContent, durationMs: parsed.durationMs });
                deliver('audio_started', false);
            }
        },
        // Empty in place, not rebound: the caller may hold this array, and a leftover fragment would play and hang.
        audioError(message) {
            pendingChunks.length = 0;
            if (typeof onAudioError === 'function') {
                try { onAudioError(message); } catch (cbErr) { console.error('onAudioError callback error:', cbErr); }
            }
            deliver('audio_failed', true);
        },
    };
}

const categorizeOffScriptUtterancesStreaming = async (
    formattedUtterances,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    questionHistory,
    ttsVoiceName,
    onAudioError,
    onQuestionReady,
    signal,
    book,
    systemQuestions,
    clickTags,
    onAudioChunk,
    onAudioEnd
) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, questionHistory, systemQuestions, ttsVoiceName, book, clickTags };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/categorize-utterances-stream', payload });

    const t0 = performance.now();
    let tFirstItem = null;
    let tLastItem = null;
    let tFirstAudioChunk = null;
    let tAudioEnd = null;

    // Exactly one terminal audio signal must reach the player, or the audio lock stays held and Next goes dead.
    let audioStarted = false;
    let audioSettled = false;
    const settleAudio = () => {
        if (audioSettled) return;
        audioSettled = true;
        if (typeof onAudioEnd !== 'function') return;
        try { onAudioEnd(); } catch (cbErr) { console.error('onAudioEnd callback error:', cbErr); }
    };

    try {
        const response = await fetch(`${BASE_URL}/api/categorize-utterances-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const items = [];
        let generatedQuestion = null;
        let questionPrompt = null;
        const handoff = createQuestionHandoff({ onQuestionReady, onAudioChunk, onAudioError });

        await readSSE(response, (parsed) => {
            if (parsed.type === 'question_prompt') {
                questionPrompt = parsed.messages;
            } else if (parsed.type === 'item') {
                if (tFirstItem === null) tFirstItem = performance.now();
                tLastItem = performance.now();
                items.push(parsed.item);
            } else if (parsed.type === 'done') {
                generatedQuestion = parsed.generatedQuestion;
                if (generatedQuestion) {
                    handoff.setQuestion(parsed);
                } else {
                    const reason = items.length === 0
                        ? 'aborted — no categorization items parsed'
                        : 'aborted — no ON_TOPIC utterances';
                    gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances-stream/question', data: reason });
                }
            } else if (parsed.type === 'audio_chunk') {
                if (tFirstAudioChunk === null) tFirstAudioChunk = performance.now();
                if (parsed.audioContent) {
                    audioStarted = true;
                    handoff.audioChunk(parsed);
                }
            } else if (parsed.type === 'audio_end') {
                if (tAudioEnd === null) tAudioEnd = performance.now();
                // Covers the case where no chunk ever arrived (no TTS voice).
                handoff.deliver('audio_ready', true);
                settleAudio();
            } else if (parsed.type === 'audio_error') {
                // onAudioError finishes the playback itself, so it is this
                // stream's terminal audio signal.
                audioSettled = true;
                handoff.audioError(parsed.message);
            } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
            }
        }, 'Error parsing SSE event:');

        // No audio_end arrived (no TTS voice configured, or the body was cut short).
        // The question is still worth showing, just silent.
        handoff.deliver('stream_closed', true);

        const tDone = performance.now();
        const ms = (a, b) => a == null || b == null ? null : Math.round(b - a);
        const timings = {
            requestToFirstItemMs: ms(t0, tFirstItem),
            requestToLastItemMs: ms(t0, tLastItem),
            categorizationItemsMs: ms(tFirstItem, tLastItem),
            requestToDoneMs: ms(t0, tDone),
            lastItemToQuestionMs: ms(tLastItem, tDone),
            requestToFirstAudioChunkMs: ms(t0, tFirstAudioChunk),
            // Time until the speech finishes arriving; the question is already shown at requestToFirstAudioChunkMs.
            requestToAudioEndMs: ms(t0, tAudioEnd),
            itemCount: items.length,
            generatedQuestion: !!generatedQuestion,
        };
        console.log('[categorize-stream] timings (ms):', timings);

        const result = { items, generatedQuestion };
        // questionPrompt is what the server actually sent to the question call,
        // dumped as-is.
        gptDebugLog({
            type: 'gpt_response',
            endpoint: '/api/categorize-utterances-stream',
            data: { ...result, questionPrompt, timings },
        });
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            gptDebugLog({ type: 'gpt_aborted', endpoint: '/api/categorize-utterances-stream' });
            return null;
        }
        console.error('Error in streaming categorization:', error);
        gptDebugLog({ type: 'gpt_error', endpoint: '/api/categorize-utterances-stream', error: error.message });
        return null;
    } finally {
        // Only once audio actually started: a stream that produced none never
        // took the lock, and its own no-audio path has already settled the turn.
        if (audioStarted) settleAudio();
    }
};

const streamAcknowledgement = async ({
    question,
    reply,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    book,
    imageDescription,
    userAttention,
    acknowledgementHistory,
    expectedAnswer,
    ttsVoiceName,
    onAcknowledgementReady,
    onAudioChunk,
    onAudioEnd,
    onAudioError,
    signal,
    imageWaitMs = null,
}) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';
    const payload = {
        question,
        reply,
        currentPageQuestion,
        bookText,
        currentPageNumber,
        book,
        imageDescription,
        userAttention,
        acknowledgementHistory,
        expectedAnswer,
        ttsVoiceName,
    };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/acknowledgement-stream', payload });

    const t0 = performance.now();
    let tVerdict = null;
    let tFirstAudioChunk = null;
    let tAudioEnd = null;

    // Exactly one terminal audio signal must reach the player, or the audio lock stays held and Next goes dead.
    let audioStarted = false;
    let audioSettled = false;
    const settleAudio = () => {
        if (audioSettled) return;
        audioSettled = true;
        if (typeof onAudioEnd !== 'function') return;
        try { onAudioEnd(); } catch (cbErr) { console.error('onAudioEnd callback error:', cbErr); }
    };

    try {
        const response = await fetch(`${BASE_URL}/api/acknowledgement-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }

        let acknowledgement = null;

        await readSSE(response, (parsed) => {
            if (parsed.type === 'done') {
                if (tVerdict === null) tVerdict = performance.now();
                acknowledgement = parsed.acknowledgement || null;
                if (typeof onAcknowledgementReady === 'function') {
                    onAcknowledgementReady(acknowledgement || '');
                }
            } else if (parsed.type === 'audio_chunk') {
                if (tFirstAudioChunk === null) tFirstAudioChunk = performance.now();
                if (parsed.audioContent) {
                    audioStarted = true;
                    if (typeof onAudioChunk === 'function') onAudioChunk(parsed.seq, parsed.audioContent, parsed.durationMs);
                }
            } else if (parsed.type === 'audio_end') {
                tAudioEnd = performance.now();
                settleAudio();
            } else if (parsed.type === 'audio_error') {
                // onAudioError finishes the turn itself — terminal.
                audioSettled = true;
                if (typeof onAudioError === 'function') onAudioError(parsed.message);
            } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
            }
        }, 'Error parsing acknowledgement SSE event:');

        const ms = (a, b) => (a == null || b == null ? null : Math.round(b - a));
        const timings = {
            imageDescriptionWaitMs: imageWaitMs,
            requestToVerdictMs: ms(t0, tVerdict),
            requestToFirstAudioChunkMs: ms(t0, tFirstAudioChunk),
            requestToAudioEndMs: ms(t0, tAudioEnd),
            verdictToFirstAudioChunkMs: ms(tVerdict, tFirstAudioChunk),
            requestToDoneMs: ms(t0, performance.now()),
        };
        console.log('[ack-stream] client timings (ms):', timings);
        gptDebugLog({ type: 'gpt_response', endpoint: '/api/acknowledgement-stream', data: { acknowledgement, timings } });
        return { acknowledgement };
    } catch (error) {
        if (error.name === 'AbortError') {
            gptDebugLog({ type: 'gpt_aborted', endpoint: '/api/acknowledgement-stream' });
            return null;
        }
        console.error('Error in acknowledgement streaming:', error);
        gptDebugLog({ type: 'gpt_error', endpoint: '/api/acknowledgement-stream', error: error.message });
        return null;
    } finally {
        // Only once audio actually started: a stream that produced none never
        // took the lock, and its own no-audio path has already settled the turn.
        if (audioStarted) settleAudio();
    }
};

// Asks for a question directly, with no utterance to provoke it — the mate was
// tapped. Same SSE shape as the categorize stream, minus the categorization half.
const generateQuestionOnDemand = async ({
    book,
    currentPageNumber,
    currentPageQuestion,
    bookText,
    imageDescription,
    userAttention,
    questionHistory,
    systemQuestions,
    formattedUtterances,
    ttsVoiceName,
    clickTags,
    onQuestionReady,
    onAudioChunk,
    onAudioEnd,
    onAudioError,
    signal,
}) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';
    const payload = {
        book, currentPageNumber, currentPageQuestion, bookText, imageDescription,
        userAttention, questionHistory, systemQuestions, formattedUtterances,
        ttsVoiceName, clickTags,
    };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/generate-question-stream', payload });

    const t0 = performance.now();
    // Exactly one terminal audio signal must reach the player, or the audio lock stays held and Next goes dead.
    let audioStarted = false;
    let audioSettled = false;
    const settleAudio = () => {
        if (audioSettled) return;
        audioSettled = true;
        if (typeof onAudioEnd !== 'function') return;
        try { onAudioEnd(); } catch (cbErr) { console.error('onAudioEnd callback error:', cbErr); }
    };

    try {
        const response = await fetch(`${BASE_URL}/api/generate-question-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        let generatedQuestion = null;
        let questionPrompt = null;
        // Same first-chunk hand-off as the categorize stream.
        const handoff = createQuestionHandoff({ onQuestionReady, onAudioChunk, onAudioError });

        await readSSE(response, (parsed) => {
            if (parsed.type === 'question_prompt') {
                questionPrompt = parsed.messages;
            } else if (parsed.type === 'done') {
                generatedQuestion = parsed.generatedQuestion;
                if (generatedQuestion) {
                    handoff.setQuestion(parsed);
                } else {
                    studyLog.pushQuestion({
                        question_id: '',
                        question_type: 'generated',
                        event: 'generated_none',
                        reason: 'manual request produced no usable question',
                    });
                }
            } else if (parsed.type === 'audio_chunk') {
                if (parsed.audioContent) {
                    audioStarted = true;
                    handoff.audioChunk(parsed);
                }
            } else if (parsed.type === 'audio_end') {
                handoff.deliver('audio_ready', true);
                settleAudio();
            } else if (parsed.type === 'audio_error') {
                // onAudioError finishes the playback itself — terminal.
                audioSettled = true;
                handoff.audioError(parsed.message);
            } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
            }
        }, 'Error parsing SSE event:');

        handoff.deliver('stream_closed', true);

        gptDebugLog({
            type: 'gpt_response',
            endpoint: '/api/generate-question-stream',
            data: { generatedQuestion, questionPrompt, timings: { requestToDoneMs: Math.round(performance.now() - t0) } },
        });
        return { generatedQuestion };
    } catch (error) {
        if (error.name === 'AbortError') {
            gptDebugLog({ type: 'gpt_aborted', endpoint: '/api/generate-question-stream' });
            return null;
        }
        console.error('Error generating question on demand:', error);
        gptDebugLog({ type: 'gpt_error', endpoint: '/api/generate-question-stream', error: error.message });
        return null;
    } finally {
        // Only once audio actually started: a stream that produced none never
        // took the lock, and its own no-audio path has already settled the turn.
        if (audioStarted) settleAudio();
    }
};

export { categorizeOffScriptUtterancesStreaming, streamAcknowledgement, generateQuestionOnDemand };
