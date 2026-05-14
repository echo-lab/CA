import { gptDebugLog } from "./debugMonitor";

const categorizeOffScriptUtterancesStreaming = async (formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, pendingGeneratedQuestion, ttsVoice, onAudio, signal) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, pendingGeneratedQuestion, ttsVoice };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/categorize-utterances-stream', payload });

    const t0 = performance.now();
    let tFirstItem = null;
    let tLastItem = null;

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
                        if (!generatedQuestion) {
                            const reason = items.length === 0
                                ? 'aborted — no categorization items parsed'
                                : 'aborted — no ON_TOPIC utterances';
                            gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances-stream/question', data: reason });
                        }
                    } else if (parsed.type === 'audio') {
                        if (parsed.audioContent && typeof onAudio === 'function') {
                            try { onAudio(parsed.audioContent); } catch (cbErr) { console.error('onAudio callback error:', cbErr); }
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

export { categorizeOffScriptUtterancesStreaming };
