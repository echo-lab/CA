const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const PlayHT = require('playht');
const { Buffer } = require('buffer');


const corsOptions = {
    origin: ['https://talemate.cs.vt.edu', 'https://128.173.237.12'],
    methods: 'POST',
    credentials: true
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// Load API key and user ID from key.json file
const keyPath = 'server/key/key.json';
let PLAYHT_API_KEY;
let PLAYHT_USER_ID;

try {
    const keyFile = fs.readFileSync(keyPath, 'utf8');
    const keys = JSON.parse(keyFile);
    PLAYHT_API_KEY = keys.apiKey;
    PLAYHT_USER_ID = keys.userId;
} catch (error) {
    console.error('Error reading or parsing key.json file:', error);
    process.exit(1); // Exit the application if there's an error
}

// Initialize PlayHT API with your credentials
PlayHT.init({
  apiKey: PLAYHT_API_KEY,
  userId: PLAYHT_USER_ID,
});

app.post('/synthesize', async (req, res) => {
    try {
        let sanitizedText = req.body.text.replace(/(\*)+/g, '');
        sanitizedText = sanitizedText.replace(/'/g, '"');

        const streamingOptions = {
            voiceEngine: "PlayHT2.0",
            voiceId: req.body.voice,
            sampleRate: 44100,
            outputFormat: 'mp3',
            speed: 1,
        };

        const stream = await PlayHT.stream(sanitizedText, streamingOptions);

        let audioData = [];
        stream.on('data', (chunk) => {
            audioData.push(chunk);
        });

        stream.on('end', () => {
            const audioBuffer = Buffer.concat(audioData);
            const audioBase64 = audioBuffer.toString('base64');
            res.json({ audioContent: audioBase64 });
        });

        stream.on('error', (error) => {
            throw new Error(`Stream error: ${error}`);
            res.status(500).json({ message: `Stream error: ${error.message}` });
        });

    } catch (error) {
        console.error('Error in Play.ht Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

const port = process.env.PORT || 5000;
const httpsOptions = {
    key: fs.readFileSync('/home/sangwonlee/TaleMate/cert/key3.pem'),
    cert: fs.readFileSync('/home/sangwonlee/TaleMate/cert/talemate.cs.vt.edu.crt')
}
https.createServer(httpsOptions, app).listen(port, () => {
    console.log(`Server started on https://localhost:${port}`);
});
