import { gptDebugLog } from "./debugMonitor";
import * as studyLog from "./studyLog";

const categorizeOffScriptUtterancesStreaming = async (
    formattedUtterances,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    pendingGeneratedQuestion,
    ttsVoiceName,
    onAudioChunk,
    onAudioEnd,
    onAudioError,
    onQuestionReady,
    signal,
    book,
    systemQuestions
) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, pendingGeneratedQuestion, systemQuestions, ttsVoiceName, book };
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
        let buffer = '';

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
                    if (parsed.type === 'item') {
                        if (tFirstItem === null) tFirstItem = performance.now();
                        tLastItem = performance.now();
                        items.push(parsed.item);
                    } else if (parsed.type === 'done') {
                        generatedQuestion = parsed.generatedQuestion;
                        if (generatedQuestion && typeof onQuestionReady === 'function') {
                            try { onQuestionReady(generatedQuestion, parsed.expectedAnswer ?? null); }
                            catch (cbErr) { console.error('onQuestionReady callback error:', cbErr); }
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
                        console.log(`Chunk ${(parsed.seq ?? 0) + 1} received`);
                        if (parsed.audioContent && typeof onAudioChunk === 'function') {
                            try { onAudioChunk(parsed.seq, parsed.audioContent, parsed.durationMs); }
                            catch (cbErr) { console.error('onAudioChunk callback error:', cbErr); }
                        }
                    } else if (parsed.type === 'audio_end') {
                        if (typeof onAudioEnd === 'function') {
                            try { onAudioEnd(); } catch (cbErr) { console.error('onAudioEnd callback error:', cbErr); }
                        }
                    } else if (parsed.type === 'audio_error') {
                        if (typeof onAudioError === 'function') {
                            try { onAudioError(parsed.message); } catch (cbErr) { console.error('onAudioError callback error:', cbErr); }
                        }
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {
                    console.error('Error parsing SSE event:', e);
                }
            }
        }

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
        gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances-stream', data: { ...result, timings } });
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
        let correct = true;

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
                        correct = parsed.correct === false ? false : true;
                        if (typeof onAcknowledgementReady === 'function') {
                            onAcknowledgementReady(acknowledgement || '', correct);
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
            correct,
        };
        console.log('[ack-stream] client timings (ms):', timings);
        gptDebugLog({ type: 'gpt_response', endpoint: '/api/acknowledgement-stream', data: { acknowledgement, correct, timings } });
        return { acknowledgement, correct };
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

export { categorizeOffScriptUtterancesStreaming, streamAcknowledgement };
