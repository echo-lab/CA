// Generate educational question based on conversation transcript
// Creates a Realtime API session configured for educational questions
const generateQuestion = async (transcript) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

        const tokenResponse = await fetch("https://api.openai.com/v1/realtime/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-realtime-preview-2024-12-17",
                voice: "alloy",
                instructions: `You are an educator helping children learn about patterns. There are people having a conversation about a book to learn about patterns.

Here is the conversation transcript:
"${transcript}"

Based on this conversation, immediately generate and ask ONE brief educational question about patterns to help the children learn. After asking your question, wait quietly for the user to answer. Do not say anything else until they respond directly to the question.`,
            })
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error(`Token generation error (${tokenResponse.status}):`, errorText);
            throw new Error(`Failed to generate token: ${errorText}`);
        }

        const { client_secret } = await tokenResponse.json();

        return {
            success: true,
            client_secret,
            transcript
        };
    } catch (error) {
        console.error("Generate educational question error:", error);
        throw error;
    }
};

// Setup educational question routes
const setupEducationalQuestionRoutes = (app) => {
    app.post('/api/educational-question/token', async (req, res) => {
        try {
            const { transcript } = req.body;

            if (!transcript) {
                return res.status(400).json({ error: 'Transcript is required' });
            }

            const result = await generateQuestion(transcript);
            res.json(result);
        } catch (error) {
            console.error('Educational question token error:', error);
            res.status(500).json({
                error: 'Failed to generate token',
                detail: error.message
            });
        }
    });
};

module.exports = {
    generateQuestion,
    setupEducationalQuestionRoutes
};
