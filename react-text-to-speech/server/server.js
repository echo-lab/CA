const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
require('dotenv').config({ path: '.env.local' });
const GOOGLE_API_KEY = process.env.GOOGLEAPI_KEY;
const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;
console.log(keyPath);
console.log(certPath);
console.log(GOOGLE_API_KEY);
const corsOptions = {
    origin: ['https://talemate.cs.vt.edu', 'https://128.173.237.12','http://localhost:3000', 'https://talemate-new.cs.vt.edu' ],
    methods: 'POST',
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
app.use(express.json());




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

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5000;
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