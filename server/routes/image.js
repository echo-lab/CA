const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const imageCache = require('../lib/cache/imageCache');
const {
  GEMINI_IMAGE_CHARACTER_RULES,
  GEMINI_IMAGE_ANALYSIS_PROMPT,
  buildGeminiImageTaggingPrompt,
} = require('../lib/prompts');
const { parseJsonFromModelText } = require('../lib/modelParsing');

const router = express.Router();
const ANALYZE_IMAGE_ENABLED = process.env.ANALYZE_IMAGE === '1';

const GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC = Number(process.env.GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC || 60 * 60);

const geminiImageContextCache = new Map();

function normalizePageTextForCache(pageText) {
    return String(pageText || '').replace(/\s+/g, ' ').trim();
}

function buildGeminiImageContextKey({ book, page, model, pageText, imageData }) {
    return JSON.stringify({
        v: imageCache.CFG.version,
        book: String(book),
        page: String(page),
        model,
        pageText: normalizePageTextForCache(pageText),
        imageHash: crypto.createHash('sha256').update(imageData).digest('hex'),
    });
}

async function getGeminiImageContextCache({ ai, model, book, page, pageText, imageData }) {
    const key = buildGeminiImageContextKey({ book, page, model, pageText, imageData });
    const now = Date.now();
    const existing = geminiImageContextCache.get(key);
    if (existing && existing.expiresAt > now) {
        return existing.promise;
    }

    const contents = [{
        role: 'user',
        parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageData } },
            {
                text: `${GEMINI_IMAGE_CHARACTER_RULES}
Shared page context for later image analysis and tagging requests.
${pageText ? `Page text:\n${pageText}` : 'No page text provided.'}`,
            },
        ],
    }];
    const promise = ai.caches.create({
        model,
        config: {
            displayName: `jennie-image-context-book-${book}-page-${page}`,
            contents,
            ttl: `${GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC}s`,
        },
    }).then(cache => {
        console.log('[image-context-cache] READY', {
            book,
            page,
            model,
            cacheName: cache.name,
            usageMetadata: cache.usageMetadata || cache.usage_metadata,
        });
        return cache;
    }).catch(err => {
        geminiImageContextCache.delete(key);
        console.warn('[image-context-cache] unavailable, falling back to inline image:', err?.message || err);
        return null;
    });

    geminiImageContextCache.set(key, {
        expiresAt: now + (GEMINI_IMAGE_CONTEXT_CACHE_TTL_SEC * 1000),
        promise,
    });
    return promise;
}

function buildInlineImageContents({ imageData, pageText, taskText }) {
    return [{
        role: 'user',
        parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageData } },
            { text: `${taskText}${pageText ? `\n\nPage text:\n${pageText}` : ''}` },
        ],
    }];
}

router.post('/analyze-image', async (req, res) => {
  try {
    const { book, page, question, pageText } = req.body;
    if (!book || !page || !question) {
      return res.status(400).json({ message: 'Provide book, page, and question' });
    }

    const MODEL = 'gemini-2.5-flash';
    const bypass = req.headers[imageCache.CFG.bypassHeader] === '1';
    const { base } = imageCache.buildKey({
      kind: 'tagging', 
      book: String(book),
      page: String(page),
      model: MODEL,
      pageText,
      question,
    });
    if (!bypass) {
      const cached = await imageCache.readIfFresh(base);
      if (cached.state === 'HIT') {
        res.setHeader('x-cache', 'HIT');
        return res.json(cached.data);
      }
    }

    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!PROJECT_ID) {
      return res.status(500).json({ message: 'VERTEX_PROJECT_ID not set' });
    }

    const fileName = String(book) === '3'
      ? `${page} Library.jpg`
      : `Page_${page}.jpg`;
    const imgPath = path.join(__dirname, '..', '..', 'src', 'Pictures', `book${book}`, fileName);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ message: `Image not found: ${fileName}` });
    }

    const imageData = fs.readFileSync(imgPath).toString('base64');

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    const contextCache = await getGeminiImageContextCache({ ai, model: MODEL, book, page, pageText, imageData });
    const request = contextCache
      ? {
          model: MODEL,
          contents: [{
            role: 'user',
            parts: [{ text: `${GEMINI_IMAGE_ANALYSIS_PROMPT}\n\nQuestion:\n${question}` }],
          }],
          config: {
            cachedContent: contextCache.name,
          },
        }
      : {
          model: MODEL,
          contents: buildInlineImageContents({ imageData, pageText, taskText: question }),
          config: {
            systemInstruction: GEMINI_IMAGE_ANALYSIS_PROMPT,
          },
        };
    const response = await ai.models.generateContent({
      ...request,
    });
    if (response.usageMetadata || response.usage_metadata) {
      console.log('[image-analysis] Gemini usage', response.usageMetadata || response.usage_metadata);
    }

    const payload = { answer: response.text ?? '' };
    imageCache.write(base, payload).catch(err => console.warn('[image cache] analyze write failed', err));
    res.setHeader('x-cache', 'MISS');
    res.json(payload);
  } catch (error) {
    console.error('Error in /analyze-image:', error);
    res.status(500).json({ message: error.toString() });
  }
});

router.post('/tag-image', async (req, res) => {
  try {
    const { book, page, pageText } = req.body;
    if (!book || !page) {
      return res.status(400).json({ message: 'Provide book and page' });
    }

    const MODEL = 'gemini-2.5-flash';
    const bypass = req.headers[imageCache.CFG.bypassHeader] === '1';
    const { base } = imageCache.buildKey({
      kind: 'tag',
      book: String(book),
      page: String(page),
      model: MODEL,
      pageText,
    });
    if (!bypass) {
      const cached = await imageCache.readIfFresh(base);
      if (cached.state === 'HIT') {
        res.setHeader('x-cache', 'HIT');
        return res.json(cached.data);
      }
    }

    const PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!PROJECT_ID) {
      return res.status(500).json({ message: 'VERTEX_PROJECT_ID not set' });
    }

    const fileName = String(book) === '3'
      ? `${page} Library.jpg`
      : `Page_${page}.jpg`;
    const imgPath = path.join(__dirname, '..', '..', 'src', 'Pictures', `book${book}`, fileName);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ message: `Image not found: ${fileName}` });
    }

    const imageData = fs.readFileSync(imgPath).toString('base64');

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    const contextCache = await getGeminiImageContextCache({ ai, model: MODEL, book, page, pageText, imageData });
    const taggingPrompt = buildGeminiImageTaggingPrompt({ pageText });
    const request = contextCache
      ? {
          model: MODEL,
          contents: [{
            role: 'user',
            parts: [{
              text: `${taggingPrompt}

Return a JSON array only. Each item must be:
{"label":"object name","box_2d":[y_min,x_min,y_max,x_max]}`,
            }],
          }],
          config: {
            cachedContent: contextCache.name,
          },
        }
      : {
          model: MODEL,
          contents: buildInlineImageContents({
            imageData,
            pageText,
            taskText: 'Tag this image using the required JSON schema.',
          }),
          config: {
            systemInstruction: taggingPrompt,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'array',
              items: {
                type: 'object',
                required: ["label", "box_2d", "importance", "confidence"],
                properties: {
                  label: {
                    type: "string",
                    description:
                      "Short, child-friendly label for the detected character or story-relevant object."
                  },
                  box_2d: {
                    type: "array",
                    description:
                      "Bounding box in [y_min, x_min, y_max, x_max] format, normalized 0–1000.",
                    minItems: 4,
                    maxItems: 4,
                    items: {
                      type: "integer",
                      minimum: 0,
                      maximum: 1000
                    }
                  },
                  importance: {
                    type: "integer",
                    description:
                      "Story relevance from 1 to 10. Characters and interacted-with objects should be highest.",
                    minimum: 1,
                    maximum: 10
                  },
                  confidence: {
                    type: "number",
                    description:
                      "Confidence that the label and bounding box are correct.",
                    minimum: 0,
                    maximum: 1
                  }
                },
              },
            },
          },
        };
    const response = await ai.models.generateContent({
      ...request,
    });
    if (response.usageMetadata || response.usage_metadata) {
      console.log('[image-tagging] Gemini usage', response.usageMetadata || response.usage_metadata);
    }

    const tags = parseJsonFromModelText(response.text, []);
    const payload = { tags };
    imageCache.write(base, payload).catch(err => console.warn('[image cache] tag write failed', err));
    res.setHeader('x-cache', 'MISS');
    res.json(payload);
  } catch (error) {
    console.error('Error in /tag-image:', error);
    res.status(500).json({ message: error.toString() });
  }
});

module.exports = router;
