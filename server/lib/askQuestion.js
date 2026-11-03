// A child's own question: they tapped something on the page and asked what it is.
const { JENNIE_SHARED_PROMPT_PREFIX, buildChildQuestionPrompt } = require('./prompts');
const { resolveImagePath, buildPageImageMessage } = require('./pageImage');
const { isValidTap, renderRingedPage, renderTapCrop } = require('./annotateImage');
const { parseJsonFromModelText } = require('./modelParsing');

const DEFAULT_QUESTION = 'What is this?';
// Both images use this long edge. Chosen by scripts/ask-eval.js: the crop lets the page
// go this small with no loss of accuracy, at about a third of the 1024px page's bytes.
const IMAGE_EDGE = 384;
const MAX_TRANSCRIPT_CHARS = 500;
const MAX_BOOK_TEXT_CHARS = 4000;

// Returns the cleaned request, or null if it can't be served. Book and page end up in
// a file path, so they must be plain numbers.
function parseAskRequest(body) {
    const { book, currentPageNumber, tap, transcript, bookText, ttsVoiceName } = body || {};
    if (!/^\d{1,3}$/.test(String(book))) return null;
    if (!Number.isInteger(currentPageNumber) || currentPageNumber < 1 || currentPageNumber > 999) return null;
    if (!isValidTap(tap)) return null;
    const spoken = typeof transcript === 'string' ? transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS) : '';
    return {
        book: String(book),
        currentPageNumber,
        tap: { x: tap.x, y: tap.y },
        // A tap with nothing transcribed still means "what is this?".
        question: spoken || DEFAULT_QUESTION,
        bookText: typeof bookText === 'string' ? bookText.slice(0, MAX_BOOK_TEXT_CHARS) : '',
        ttsVoiceName: typeof ttsVoiceName === 'string' ? ttsVoiceName : null,
    };
}

// The ringed page and close-up, or null when they can't be drawn (ImageMagick missing,
// say). The caller falls back so that a child still gets an answer.
async function renderTapImages({ book, currentPageNumber, tap }, log) {
    const page = currentPageNumber - 1; // UI page numbers are one ahead of file numbers
    try {
        const [ringed, crop] = await Promise.all([
            renderRingedPage({ imagePath: resolveImagePath(book, page), tap, edge: IMAGE_EDGE }),
            renderTapCrop({ imagePath: resolveImagePath(book, page, { fullRes: true }), tap, edge: IMAGE_EDGE }),
        ]);
        return [ringed, crop];
    } catch (err) {
        log(`annotation failed, using plain page: ${err?.message || err}`);
        return null;
    }
}

async function buildAskMessages(request, log = () => {}) {
    const { book, currentPageNumber, tap, question, bookText } = request;
    const images = await renderTapImages(request, log);
    const imageMessage = images
        ? { role: 'user', content: images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })) }
        : buildPageImageMessage(book, currentPageNumber);
    const whereTapped = images
        ? ''
        : `\n\nNo ring is drawn on this image. The child tapped ${Math.round(tap.x / 10)}% of the way across and ${Math.round(tap.y / 10)}% of the way down it.`;

    return [
        { role: 'developer', content: JENNIE_SHARED_PROMPT_PREFIX },
        { role: 'developer', content: buildChildQuestionPrompt(book) },
        ...(imageMessage ? [imageMessage] : []),
        { role: 'user', content: `Page text: ${bookText}\n\nThe child asked: "${question}"${whereTapped}` },
    ];
}

// The model's reply as { answer, object }, or nulls when it gave nothing usable.
function parseAskReply(raw) {
    const parsed = parseJsonFromModelText(String(raw || ''), null);
    const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    return { answer: clean(parsed?.answer), object: clean(parsed?.object) };
}

module.exports = { parseAskRequest, buildAskMessages, parseAskReply };
