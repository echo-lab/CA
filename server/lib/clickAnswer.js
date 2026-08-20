// Click questions answer to a region of the page image, never to free text. The
// model only ever picks a label; the coordinates come from the tag it named, so a
// question can never point at a box that does not exist.
const { parseJsonFromModelText } = require('./modelParsing');

// Book 2 is the click-question book. Kept here so the route and any future caller
// agree on what "click book" means.
const CLICK_QUESTION_BOOKS = new Set(['2']);

function isClickQuestionBook(book) {
    return CLICK_QUESTION_BOOKS.has(String(book));
}

// A tag is only usable as an answer if it has a real, non-empty box: the hit test
// compares the click against these four numbers, so a malformed one would either
// never match or match everywhere.
function usableTags(tags) {
    return (Array.isArray(tags) ? tags : []).filter((t) => {
        if (!t || !String(t.label || '').trim()) return false;
        const b = t.box_2d;
        if (!Array.isArray(b) || b.length < 4) return false;
        const [y0, x0, y1, x1] = b.map(Number);
        return [y0, x0, y1, x1].every(Number.isFinite) && y1 > y0 && x1 > x0;
    });
}

function tagLabels(tags) {
    return usableTags(tags).map((t) => String(t.label).trim());
}

// Renders the label list the prompt tells the model to copy from.
function buildTappableObjectsBlock(tags) {
    const labels = tagLabels(tags);
    if (!labels.length) return '';
    return `<tappable_objects>\n${labels.map((l) => `- "${l}"`).join('\n')}\n</tappable_objects>\n`;
}

// Returns null when the model named something that is not a real tag — the caller
// drops the question rather than asking one with nothing to click.
function resolveClickAnswer(rawModelText, tags) {
    const parsed = parseJsonFromModelText(rawModelText, null);
    const question = String(parsed?.question || '').trim();
    // answer_label is the documented key; expected_answer is accepted because the
    // model occasionally falls back to the shape used by the spoken-question prompt.
    const wanted = String(parsed?.answer_label ?? parsed?.expected_answer ?? '').trim();
    if (!question || !wanted) return null;

    // Case- and whitespace-insensitive only. No fuzzy matching: a near miss means
    // the model was not copying from the list, and guessing which tag it meant
    // would put the answer box somewhere the child was never asked to click.
    const key = wanted.toLowerCase();
    const tag = usableTags(tags).find((t) => String(t.label).trim().toLowerCase() === key);
    if (!tag) return null;

    return {
        question,
        answerLabel: String(tag.label).trim(),
        answerBox: tag.box_2d.slice(0, 4).map(Number),
    };
}

module.exports = {
    isClickQuestionBook,
    usableTags,
    tagLabels,
    buildTappableObjectsBlock,
    resolveClickAnswer,
};
