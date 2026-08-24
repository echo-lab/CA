import { gptDebugLog } from "./debugMonitor";
import * as studyLog from "./studyLog";

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
    clickTags
) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, questionHistory, systemQuestions, ttsVoiceName, book, clickTags };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/categorize-utterances-stream', payload });

    const t0 = performance.now();
    let tFirstItem = null;
    let tLastItem = null;
    let tFirstAudioChunk = null;

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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const items = [];
        let generatedQuestion = null;
        let questionPrompt = null;
        let buffer = '';
        // The question and its audio are held here until the stream says the audio
        // is complete, then handed over in one call. Nothing reaches the UI early,
        // so a question can never be shown — or clicked — before it can be spoken,
        // and two streams racing each other cannot interleave their chunks.
        let pending = null;
        let pendingChunks = [];
        let delivered = false;
        const deliver = (reason) => {
            if (delivered || !pending) return;
            delivered = true;
            if (typeof onQuestionReady !== 'function') return;
            try { onQuestionReady(pending.question, pending.expectedAnswer, pending.click, pendingChunks, reason); }
            catch (cbErr) { console.error('onQuestionReady callback error:', cbErr); }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop(); // keep incomplete last event

            for (const event of events) {
                const dataLine = event.split('\n').find(l => l.startsWith('data: '));
                if (!dataLine) continue;
                try {
                    const parsed = JSON.parse(dataLine.slice(6));
                    if (parsed.type === 'question_prompt') {
                        questionPrompt = parsed.messages;
                    } else if (parsed.type === 'item') {
                        if (tFirstItem === null) tFirstItem = performance.now();
                        tLastItem = performance.now();
                        items.push(parsed.item);
                    } else if (parsed.type === 'done') {
                        generatedQuestion = parsed.generatedQuestion;
                        if (generatedQuestion) {
                            // answerBox is the tag's own region — the click hit test
                            // uses it verbatim, so it must survive to the caller.
                            pending = {
                                question: generatedQuestion,
                                expectedAnswer: parsed.expectedAnswer ?? null,
                                click: {
                                    answerLabel: parsed.answerLabel ?? null,
                                    answerBox: parsed.answerBox ?? null,
                                },
                            };
                        }
                        if (!generatedQuestion) {
                            const reason = items.length === 0
                                ? 'aborted — no categorization items parsed'
                                : 'aborted — no ON_TOPIC utterances';
                            gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances-stream/question', data: reason });
                            // Records that generation ran and produced nothing,
                            // which is otherwise indistinguishable from never
                            // having been attempted.
                            studyLog.pushQuestion({
                                question_id: '',
                                question_type: 'generated',
                                event: 'generated_none',
                                reason,
                            });
                        }
                    } else if (parsed.type === 'audio_chunk') {
                        if (tFirstAudioChunk === null) tFirstAudioChunk = performance.now();
                        if (parsed.audioContent) pendingChunks.push({ seq: parsed.seq, audioContent: parsed.audioContent, durationMs: parsed.durationMs });
                    } else if (parsed.type === 'audio_end') {
                        deliver('audio_ready');
                    } else if (parsed.type === 'audio_error') {
                        // The question still gets shown; it simply cannot be spoken.
                        pendingChunks = [];
                        if (typeof onAudioError === 'function') {
                            try { onAudioError(parsed.message); } catch (cbErr) { console.error('onAudioError callback error:', cbErr); }
                        }
                        deliver('audio_failed');
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {
                    console.error('Error parsing SSE event:', e);
                }
            }
        }

        // No audio_end arrived (no TTS voice configured, or the body was cut short).
        // The question is still worth showing, just silent.
        deliver('stream_closed');

        const tDone = performance.now();
        const ms = (a, b) => a == null || b == null ? null : Math.round(b - a);
        const timings = {
            requestToFirstItemMs: ms(t0, tFirstItem),
            requestToLastItemMs: ms(t0, tLastItem),
            categorizationItemsMs: ms(tFirstItem, tLastItem),
            requestToDoneMs: ms(t0, tDone),
            lastItemToQuestionMs: ms(tLastItem, tDone),
            requestToFirstAudioChunkMs: ms(t0, tFirstAudioChunk),
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acknowledgement = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const event of events) {
                const dataLine = event.split('\n').find(l => l.startsWith('data: '));
                if (!dataLine) continue;
                try {
                    const parsed = JSON.parse(dataLine.slice(6));
                    if (parsed.type === 'done') {
                        if (tVerdict === null) tVerdict = performance.now();
                        acknowledgement = parsed.acknowledgement || null;
                        if (typeof onAcknowledgementReady === 'function') {
                            onAcknowledgementReady(acknowledgement || '');
                        }
                    } else if (parsed.type === 'audio_chunk') {
                        if (tFirstAudioChunk === null) tFirstAudioChunk = performance.now();
                        if (parsed.audioContent && typeof onAudioChunk === 'function') {
                            onAudioChunk(parsed.seq, parsed.audioContent, parsed.durationMs);
                        }
                    } else if (parsed.type === 'audio_end') {
                        tAudioEnd = performance.now();
                        if (typeof onAudioEnd === 'function') onAudioEnd();
                    } else if (parsed.type === 'audio_error') {
                        if (typeof onAudioError === 'function') onAudioError(parsed.message);
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {
                    console.error('Error parsing acknowledgement SSE event:', e);
                }
            }
        }

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
    try {
        const response = await fetch(`${BASE_URL}/api/generate-question-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let generatedQuestion = null;
        let questionPrompt = null;
        // Same atomic hand-over as the categorize stream: held until the audio is
        // complete, so the mate never swaps in a question it cannot yet speak.
        let pending = null;
        let pendingChunks = [];
        let delivered = false;
        const deliver = (reason) => {
            if (delivered || !pending) return;
            delivered = true;
            if (typeof onQuestionReady !== 'function') return;
            try { onQuestionReady(pending.question, pending.expectedAnswer, pending.click, pendingChunks, reason); }
            catch (cbErr) { console.error('onQuestionReady callback error:', cbErr); }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const event of events) {
                const dataLine = event.split('\n').find(l => l.startsWith('data: '));
                if (!dataLine) continue;
                try {
                    const parsed = JSON.parse(dataLine.slice(6));
                    if (parsed.type === 'question_prompt') {
                        questionPrompt = parsed.messages;
                    } else if (parsed.type === 'done') {
                        generatedQuestion = parsed.generatedQuestion;
                        if (generatedQuestion) {
                            pending = {
                                question: generatedQuestion,
                                expectedAnswer: parsed.expectedAnswer ?? null,
                                click: {
                                    answerLabel: parsed.answerLabel ?? null,
                                    answerBox: parsed.answerBox ?? null,
                                },
                            };
                        }
                        if (!generatedQuestion) {
                            studyLog.pushQuestion({
                                question_id: '',
                                question_type: 'generated',
                                event: 'generated_none',
                                reason: 'manual request produced no usable question',
                            });
                        }
                    } else if (parsed.type === 'audio_chunk') {
                        if (parsed.audioContent) pendingChunks.push({ seq: parsed.seq, audioContent: parsed.audioContent, durationMs: parsed.durationMs });
                    } else if (parsed.type === 'audio_end') {
                        deliver('audio_ready');
                    } else if (parsed.type === 'audio_error') {
                        pendingChunks = [];
                        if (typeof onAudioError === 'function') onAudioError(parsed.message);
                        deliver('audio_failed');
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {
                    console.error('Error parsing SSE event:', e);
                }
            }
        }

        deliver('stream_closed');

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
    }
};

export { categorizeOffScriptUtterancesStreaming, streamAcknowledgement, generateQuestionOnDemand };
