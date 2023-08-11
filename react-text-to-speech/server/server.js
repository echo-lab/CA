const express = require('express');
const fs = require('fs');
const cors = require('cors');
const corsOptions = {
    origin: 'http://talemate.cs.vt.edu:3000',
    methods: 'POST',
    credentials: true
  };


const app = express();
app.use(cors(corsOptions));
app.use(express.json());

let rawData = fs.readFileSync('server/key/key.json'); // replace with the path to your .json keyfile
let keyData = JSON.parse(rawData);
const GOOGLE_API_KEY = keyData.key; 

app.post('/synthesize', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        
        const request = {
            input: { text: req.body.text },
            voice: req.body.voice,
            audioConfig: { audioEncoding: 'MP3' },
        };

        const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_API_KEY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server started on port ${port}`));
