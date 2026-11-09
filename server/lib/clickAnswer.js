// Click questions are answered by a tagged image region; the model only picks a label, never coordinates.
const { parseJsonFromModelText } = require('./modelParsing');

// A tag is usable only with a real, non-empty box, since the click hit test compares against it.
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

// Each generated question is spoken or click at random; click falls back to spoken when the page has no usable tags.
function resolveClickMode(clickTags) {
    const clickLabels = tagLabels(clickTags);
    const wanted = Math.random() < 0.5;
    return { clickMode: wanted && clickLabels.length > 0, clickLabels, wanted };
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

    // Case/whitespace-insensitive match only; no fuzzy matching, so a near-miss label is rejected rather than guessed.
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
    usableTags,
    tagLabels,
    resolveClickMode,
    buildTappableObjectsBlock,
    resolveClickAnswer,
};
