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

    // Exactly one terminal audio signal reaches the player, whatever becomes of
    // the stream. The player releases the audio lock only from its onEnded, and
    // onEnded needs end() — so a body cut short mid-speech, or an error event,
    // would otherwise strand it: lock held, Next button dead, no further TTS.
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const items = [];
        let generatedQuestion = null;
        let questionPrompt = null;
        let buffer = '';
        // The question is handed over on the FIRST audio chunk rather than the last,
        // so the child sees it while the rest of the speech is still synthesising.
        // The invariant that it can never be shown before it can be spoken still
        // holds — delivery is gated on audio having actually started — and the
        // `audioComplete: false` flag tells the caller more chunks are coming, so a
        // tap mid-stream plays what has arrived and keeps filling. Chunks after
        // delivery go to onAudioChunk, whose suppression flag is what stops two
        // racing streams from interleaving.
        let pending = null;
        let pendingChunks = [];
        let delivered = false;
        const deliver = (reason, audioComplete) => {
            if (delivered || !pending) return;
            delivered = true;
            if (typeof onQuestionReady !== 'function') return;
            // referent is appended last so existing argument positions are untouched.
            try { onQuestionReady(pending.question, pending.expectedAnswer, pending.click, pendingChunks, reason, audioComplete, pending.referent); }
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
                            // referentBox is the opposite: the region the question is
                            // ABOUT, circled while it is asked. The server sends at
                            // most one of the two, never both.
                            pending = {
                                question: generatedQuestion,
                                expectedAnswer: parsed.expectedAnswer ?? null,
                                click: {
                                    answerLabel: parsed.answerLabel ?? null,
                                    answerBox: parsed.answerBox ?? null,
                                },
                                referent: {
                                    referentLabel: parsed.referentLabel ?? null,
                                    referentBox: parsed.referentBox ?? null,
                                },
                            };
                        }
                        if (!generatedQuestion) {
                            const reason = items.length === 0
                                ? 'aborted — no categorization items parsed'
                                : 'aborted — no ON_TOPIC utterances';
                            gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances-stream/question', data: reason });
                        }
                    } else if (parsed.type === 'audio_chunk') {
                        if (tFirstAudioChunk === null) tFirstAudioChunk = performance.now();
                        if (parsed.audioContent) {
                            audioStarted = true;
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
                        }
                    } else if (parsed.type === 'audio_end') {
                        if (tAudioEnd === null) tAudioEnd = performance.now();
                        // Covers the case where no chunk ever arrived (no TTS voice).
                        deliver('audio_ready', true);
                        settleAudio();
                    } else if (parsed.type === 'audio_error') {
                        // onAudioError finishes the playback itself, so it is this
                        // stream's terminal audio signal.
                        audioSettled = true;
                        // The question still gets shown; it simply cannot be spoken.
                        // Emptied in place, not rebound: once delivery has happened the
                        // caller holds this exact array, and a fragment left in it would
                        // play half a question with no end() ever coming.
                        pendingChunks.length = 0;
                        if (typeof onAudioError === 'function') {
                            try { onAudioError(parsed.message); } catch (cbErr) { console.error('onAudioError callback error:', cbErr); }
                        }
                        deliver('audio_failed', true);
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
        deliver('stream_closed', true);

        const tDone = performance.now();
        const ms = (a, b) => a == null || b == null ? null : Math.round(b - a);
        const timings = {
            requestToFirstItemMs: ms(t0, tFirstItem),
            requestToLastItemMs: ms(t0, tLastItem),
            categorizationItemsMs: ms(tFirstItem, tLastItem),
            requestToDoneMs: ms(t0, tDone),
            lastItemToQuestionMs: ms(tLastItem, tDone),
            requestToFirstAudioChunkMs: ms(t0, tFirstAudioChunk),
            // What the child actually waits through: the question is now on screen at
            // requestToFirstAudioChunkMs, so the gap to this is speech still arriving,
            // not dead time. Before pipelining the two were the same moment.
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

    // Exactly one terminal audio signal reaches the player, whatever becomes of
    // the stream. The player releases the audio lock only from its onEnded, and
    // onEnded needs end() — so a body cut short mid-speech, or an error event,
    // would otherwise strand it: lock held, Next button dead, no further TTS.
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
    // Exactly one terminal audio signal reaches the player, whatever becomes of
    // the stream. The player releases the audio lock only from its onEnded, and
    // onEnded needs end() — so a body cut short mid-speech, or an error event,
    // would otherwise strand it: lock held, Next button dead, no further TTS.
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let generatedQuestion = null;
        let questionPrompt = null;
        // Same hand-over as the categorize stream: delivered on the first audio chunk,
        // so the mate never swaps in a question it cannot yet speak, but does not wait
        // out the whole synthesis before showing one it can.
        let pending = null;
        let pendingChunks = [];
        let delivered = false;
        const deliver = (reason, audioComplete) => {
            if (delivered || !pending) return;
            delivered = true;
            if (typeof onQuestionReady !== 'function') return;
            // referent is appended last so existing argument positions are untouched.
            try { onQuestionReady(pending.question, pending.expectedAnswer, pending.click, pendingChunks, reason, audioComplete, pending.referent); }
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
                                referent: {
                                    referentLabel: parsed.referentLabel ?? null,
                                    referentBox: parsed.referentBox ?? null,
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
                        if (parsed.audioContent) {
                            audioStarted = true;
                            if (delivered) {
                                if (typeof onAudioChunk === 'function') onAudioChunk(parsed.seq, parsed.audioContent, parsed.durationMs);
                            } else {
                                pendingChunks.push({ seq: parsed.seq, audioContent: parsed.audioContent, durationMs: parsed.durationMs });
                                deliver('audio_started', false);
                            }
                        }
                    } else if (parsed.type === 'audio_end') {
                        deliver('audio_ready', true);
                        settleAudio();
                    } else if (parsed.type === 'audio_error') {
                        // onAudioError finishes the playback itself — terminal.
                        audioSettled = true;
                        pendingChunks.length = 0;
                        if (typeof onAudioError === 'function') onAudioError(parsed.message);
                        deliver('audio_failed', true);
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {
                    console.error('Error parsing SSE event:', e);
                }
            }
        }

        deliver('stream_closed', true);

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
