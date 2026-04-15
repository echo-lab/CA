import { gptDebugLog } from "./debugMonitor";

const categorizeOffScriptUtterances = async (formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention, signal) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, currentPageQuestion, bookText, currentPageNumber, imageDescription, userAttention };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/categorize-utterances', payload });

    try {
        const response = await fetch(`${BASE_URL}/api/categorize-utterances`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances', data: result });
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            gptDebugLog({ type: 'gpt_aborted', endpoint: '/api/categorize-utterances' });
            return null;
        }
        console.error('Error categorizing off-script utterances:', error);
        gptDebugLog({ type: 'gpt_error', endpoint: '/api/categorize-utterances', error: error.message });
        return null;
    }
};

export { categorizeOffScriptUtterances };