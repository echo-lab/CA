/**
 * Calculates the relevancy of a user's utterance to the current reading context
 * @param {Object|Array} bookContent - The book content (pages, text, etc.)
 * @param {string} currentLine - The current line being read
 * @param {string} utterance - The user's spoken utterance
 * @returns {Promise<Object>} Object containing isRelevant, confidence, reason, and suggestedResponse
 */
const calculateRelevancy = async (bookContent, currentLine, utterances, utterance) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    try {
        const response = await fetch(`${BASE_URL}/api/check-relevancy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bookContent,
                currentLine,
                utterances,
                utterance
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error calculating relevancy:', error);
        // Return a default "not relevant" response in case of error
        return {
            isRelevant: false,
            confidence: 0,
            reason: `Error checking relevancy: ${error.message}`,
            suggestedResponse: null
        };
    }
};

// const classifyUtterance = async (bookContent, currentLine, utterances, utterance) => {
//     const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

//     try { 
//         const response = await fetch(`${BASE_URL}/api/classify-utterance`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//             },
//             body: JSON.stringify({
//                 bookContent,
//                 currentLine,
//                 utterances,
//                 utterance
//             })
//         });

//         if (!response.ok) {
//             const errorData = await response.json();
//             throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
//         }
        
//         const result = await response.json();
//         return result;
//     } catch (error) {
//         console.error('Error classifying utterance:', error);
//     }
//     return { classification: 'UNKNOWN' };
// };

const categorizeOffScriptUtterances = async (formattedUtterances, bookPageText, currentPageQuestion, bookText, currentPageNumber) => {
    const BASE_URL = process.env.REACT_APP_API_BASE || 'https://localhost:5001';

    try {
        const response = await fetch(`${BASE_URL}/api/categorize-utterances`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ formattedUtterances, bookPageText, currentPageQuestion, bookText, currentPageNumber })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error('Error categorizing off-script utterances:', error);
        return null;
    }
};

export { calculateRelevancy, categorizeOffScriptUtterances };