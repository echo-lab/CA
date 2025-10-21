const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const OpenAI = require('openai');
require('dotenv').config({ path: '.env.local' });
const { registerLiveTtsRoutes } = require('./liveTTS'); 

const { startPruner } = require('./cache/prune');
startPruner();

const GOOGLE_API_KEY = process.env.GOOGLEAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});
console.log(keyPath);
console.log(certPath);
const corsOptions = {
    origin: ['https://talemate.cs.vt.edu', 'https://128.173.237.12','https://localhost:3000', 'https://talemate.cs.vt.edu:3001', 'https://talemate.cs.vt.edu:5001'],
    methods: 'POST',
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
registerLiveTtsRoutes(app);


app.post('/synthesize', async (req, res) => {
    try {
        // Log the incoming request body
        console.log('/synthesize request body:', JSON.stringify(req.body, null, 2));
        
        const fetch = (await import('node-fetch')).default;
        let sanitizedText = req.body.text.replace(/(\*)+/g, '');
        sanitizedText = sanitizedText.replace(/'/g, '"');
        //console.log(sanitizedText)
        const ssmlText = `<speak>${sanitizedText}</speak>`;
        const request = {
            input: { ssml: ssmlText },
            voice: req.body.voice,
            audioConfig: { audioEncoding: 'MP3' , speakingRate: 0.8},
            
        };

        // Log the exact payload sent to Google
        console.log('TTS API request payload:', JSON.stringify(request, null, 2));

        const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_API_KEY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        });

        const raw = await response.text();
        if (!response.ok) {
            console.error('TTS API responded with status', response.status);
            console.error('TTS API error body:', raw);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        let data;
        try {
            data = JSON.parse(raw);
        } catch (parseErr) {
            console.error('Failed to parse TTS API JSON:', raw);
            return res.status(500).json({ message: 'Invalid JSON from TTS API' });
        }

        console.log('TTS API success payload (truncated):', raw.slice(0, 100));
        return res.json(data);
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

app.post('/generate-image', async (req, res) => {
    try {
        console.log('Received /generate-image request with body:', req.body);
        if (!OPENAI_API_KEY) {
            return res.status(500).json({ 
                message: 'OPENAI_API_KEY not set in environment variables' 
            });
        }

        const prompt = req.body.prompt || `
Create an educational illustration that visually explains the concept of [insert mathematical concept here, e.g., 'Pythagorean theorem' or 'exponential growth'] in a completely new real-world context. The image should feature two friendly characters (a teacher and a student) discussing and interacting with the concept in a fun, story-like scene. Do not use the same example as [briefly describe the original example, e.g., 'triangles on a chalkboard' or 'bacteria in a petri dish']. Instead, use a different metaphorical situation — for example, [suggest an alternative, e.g., 'measuring distances between treehouses' or 'tracking how fast a balloon inflates over time']. The style should be bright, clear, and visually engaging, like an educational textbook illustration.
Excerpt: ${req.body.excerpt}`.trim();
        const result = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            size: "1024x1024",
            quality: "standard",
            n: 1
        });
        console.log('OpenAI image generation result:', result);

        const imageUrl = result.data[0].url;
        return res.json({ 
            imageUrl: imageUrl,
            success: true 
        });

    } catch (error) {
        console.error('Error generating image:', error);
        return res.status(500).json({ 
            message: error.message || 'Failed to generate image',
            error: error.toString()
        });
    }
});

if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}
else{

    const port = process.env.REACT_APP_PORT || 5000;
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Server started on https://localhost:${port}`);
    });
}