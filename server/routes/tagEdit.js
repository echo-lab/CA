// Tag box editor — dev tool. Overwrites the cached tags for one page so hand-adjusted
// boxes survive a reload. To remove: delete this file and its two lines in server.js.
const express = require('express');
const imageCache = require('../lib/cache/imageCache');

const router = express.Router();
// Must match the model /tag-image uses, or buildKey resolves to a different file.
const MODEL = 'gemini-2.5-flash';

function cleanTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const out = [];
  for (const t of tags) {
    if (!t || typeof t.label !== 'string') return null;
    if (!Array.isArray(t.box_2d) || t.box_2d.length !== 4) return null;
    const box = t.box_2d.map(Number).map(Math.round);
    if (!box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
    if (box[2] <= box[0] || box[3] <= box[1]) return null;
    out.push({ ...t, box_2d: box });
  }
  return out;
}

router.post('/save-tags', async (req, res) => {
  try {
    const { book, page, pageText, tags } = req.body;
    if (!book || !page) return res.status(400).json({ message: 'Provide book and page' });

    const cleaned = cleanTags(tags);
    if (!cleaned) return res.status(400).json({ message: 'Bad tags: need label + box_2d [y0,x0,y1,x1] within 0-1000, y1>y0, x1>x0' });

    const { base } = imageCache.buildKey({
      kind: 'tag',
      book: String(book),
      page: String(page),
      model: MODEL,
      pageText,
    });

    // Refuse to create a phantom cache file: if the key does not already resolve to
    // one, the pageText differs from the tagging request and the write would never
    // be read back. Failing loudly here beats a silent no-op.
    const existing = await imageCache.readIfFresh(base);
    if (existing.state === 'MISS') {
      return res.status(404).json({ message: 'No cached tags for this book/page/pageText — nothing overwritten' });
    }

    await imageCache.write(base, { ...(existing.data || {}), tags: cleaned }, { book: String(book), page: String(page) });
    res.json({ ok: true, count: cleaned.length });
  } catch (error) {
    console.error('Error in /save-tags:', error);
    res.status(500).json({ message: error.toString() });
  }
});

module.exports = router;
