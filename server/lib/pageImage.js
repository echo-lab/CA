const fs = require('fs');
const path = require('path');

const dataUrlCache = new Map(); // key: `${book}|${page}` -> dataUrl string | null

function resolveImagePath(book, page) {
    const fileName = String(book) === '3'
        ? `${page} Library.jpg`
        : `Page_${page}.jpg`;
    const dir = path.join(__dirname, '..', '..', 'src', 'Pictures', `book${book}`);
    // The model gets the downscaled copy from llm/ (1024px, ~135KB) instead of the
    // full-res original the UI displays (~2.3MB). Identical tile/token count, ~17x
    // less upload. Regenerate with scripts/make-llm-images.sh. Falls back to the
    // original so a missing llm/ copy degrades to the old behaviour, not a failure.
    const lowRes = path.join(dir, 'llm', fileName);
    return fs.existsSync(lowRes) ? lowRes : path.join(dir, fileName);
}

// Returns a base64 data URL for the page image, or null if unavailable.
function loadPageImageDataUrl(book, page) {
    if (book == null || page == null || Number.isNaN(Number(page))) return null;

    const key = `${book}|${page}`;
    if (dataUrlCache.has(key)) return dataUrlCache.get(key);

    let dataUrl = null;
    try {
        const imgPath = resolveImagePath(book, page);
        if (fs.existsSync(imgPath)) {
            const base64 = fs.readFileSync(imgPath).toString('base64');
            dataUrl = `data:image/jpeg;base64,${base64}`;
        } else {
            console.warn('[pageImage] image not found:', imgPath);
        }
    } catch (err) {
        console.warn('[pageImage] failed to load', book, page, err?.message || err);
    }

    dataUrlCache.set(key, dataUrl);
    return dataUrl;
}

function buildPageImageMessage(book, currentPageNumber) {
    const page = Number(currentPageNumber) - 1;
    const dataUrl = loadPageImageDataUrl(book, page);
    if (!dataUrl) {
        console.log(`[pageImage] no image sent (book=${book}, page=${page})`);
        return null;
    }
    // Log the exact file going to OpenAI so it can be opened/verified on disk.
    const imgPath = resolveImagePath(book, page);
    const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);
    console.log(`[pageImage] sending → ${imgPath} (book=${book}, page=${page}, ~${approxKb}KB)`);
    return {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: dataUrl } }],
    };
}

module.exports = { loadPageImageDataUrl, buildPageImageMessage };
