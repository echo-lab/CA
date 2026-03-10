import { gptDebugLog } from "./debugMonitor";

const categorizeOffScriptUtterances = async (formattedUtterances, bookPageText, currentPageQuestion, bookText, currentPageNumber) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    const payload = { formattedUtterances, bookPageText, currentPageQuestion, bookText, currentPageNumber };
    gptDebugLog({ type: 'gpt_request', endpoint: '/api/categorize-utterances', payload });

    try {
        const response = await fetch(`${BASE_URL}/api/categorize-utterances`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        gptDebugLog({ type: 'gpt_response', endpoint: '/api/categorize-utterances', data: result });
        return result;
    } catch (error) {
        console.error('Error categorizing off-script utterances:', error);
        gptDebugLog({ type: 'gpt_error', endpoint: '/api/categorize-utterances', error: error.message });
        return null;
    }
};

export { categorizeOffScriptUtterances };