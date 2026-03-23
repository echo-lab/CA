const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const https = require('https');
require('dotenv').config({ path: '.env.local' });
const { registerLiveTtsRoutes } = require('./liveTTS'); 

const { startPruner } = require('./cache/prune');
startPruner();

const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;
console.log(keyPath);
console.log(certPath);
const corsOptions = {
	origin: ['https://talemate.cs.vt.edu', 'https://128.173.237.12','https://localhost:3000', 'https://talemate.cs.vt.edu:3001', 'https://talemate.cs.vt.edu:5001', 'https://talemate.cs.vt.edu:3002'],
    methods: 'POST',
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
app.use('/pictures', express.static(path.join(__dirname, '../src/Pictures')));
registerLiveTtsRoutes(app);

app.post('/analyze-image', async (req, res) => {
  try {
    const { book, page, question, pageText } = req.body;
    if (!book || !page || !question) {
      return res.status(400).json({ message: 'Provide book, page, and question' });
    }

    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!PROJECT_ID) {
      return res.status(500).json({ message: 'VERTEX_PROJECT_ID not set' });
    }

    const fileName = String(book) === '3'
      ? `${page} Library.jpg`
      : `Page_${page}.jpg`;
    const imgPath = path.join(__dirname, '../src/Pictures', `book${book}`, fileName);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ message: `Image not found: ${fileName}` });
    }

    const imageData = fs.readFileSync(imgPath).toString('base64');

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageData } },
          { text: question },
        ],
      }],
      config: {
        systemInstruction: `You are a narrator for a children's picture book.
The two characters in every image are:
- Zoe: the bird (any bird you see is always Zoe)
- Clara: the chameleon (any chameleon or lizard you see is always Clara)
Always call them by name — never say "the bird" or "the chameleon".
Give a SHORT answer of 1-2 sentences. Be similar to a parent answering a question to their kid. ${pageText ? `\n\nThe text on this page reads:\n${pageText}` : ''}`,
      },
    });

    res.json({ answer: response.text ?? '' });
  } catch (error) {
    console.error('Error in /analyze-image:', error);
    res.status(500).json({ message: error.toString() });
  }
});

if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}
else{

    const port = process.env.REACT_APP_PORT || 5001;
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Server started on https://localhost:${port}`);
    });
}
