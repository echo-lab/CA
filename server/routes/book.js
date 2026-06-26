const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const GOOGLE_API_KEY = process.env.GOOGLEAPI_KEY;

function stripSSML(text) {
    return text.replace(/<\/?[^>]+(>|$)/g, '').replace(/\s+/g, ' ').trim();
}

// --- Book data loader for test page ---
function loadBookData(bookId) {
    const bookFiles = {
        1: path.join(__dirname, '..', '..', 'src', 'Book', 'Book1.js'),
        2: path.join(__dirname, '..', '..', 'src', 'Book', 'Book2.js'),
        3: path.join(__dirname, '..', '..', 'src', 'Book', 'Book3.js'),
    };
    const filePath = bookFiles[bookId];
    if (!filePath) return null;
    let src = fs.readFileSync(filePath, 'utf-8');
    // Strip require() calls (images) and export keyword
    src = src.replace(/require\([^)]+\)/g, 'null');
    src = src.replace(/^export\s+const\s+data\s*=/, 'var __data =');
    // Evaluate and extract
    const vm = require('vm');
    const ctx = {};
    vm.runInNewContext(src, ctx);
    return ctx.__data && ctx.__data[0] ? ctx.__data[0].Book : null;
}

async function synthesizeSpeech({ text, voice }) {
    if (!text || !voice) throw new Error('synthesizeSpeech: text and voice required');
    const fetch = (await import('node-fetch')).default;
    const sanitizedText = String(text).replace(/(\*)+/g, '').replace(/'/g, '"');
    const ssmlText = `<speak>${sanitizedText}</speak>`;
    const request = {
        input: { ssml: ssmlText },
        voice,
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.8 },
    };
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    const raw = await response.text();
    if (!response.ok) {
        console.error('TTS API responded with status', response.status);
        console.error('TTS API error body:', raw);
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return JSON.parse(raw);
}

// API: get book metadata (page names, text, questions)
router.get('/api/book-data/:bookId', (req, res) => {
    const book = loadBookData(parseInt(req.params.bookId));
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const pageEntries = Object.entries(book.Pages).map(([key, page], i) => ({
        key,
        index: i,
        question: page.question || '',
        text: (page.text || []).map(l => ({ Character: l.Character, Dialogue: stripSSML(l.Dialogue) })),
    }));

    res.json({ name: book.Name, pages: pageEntries });
});

router.post('/synthesize', async (req, res) => {
    try {
        console.log('/synthesize request body:', JSON.stringify(req.body, null, 2));
        const data = await synthesizeSpeech({ text: req.body.text, voice: req.body.voice });
        return res.json(data);
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
        res.status(500).json({ message: error.toString() });
    }
});

module.exports = router;
