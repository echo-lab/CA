// Questions that involve a region of the page image never answer to free text. The
// model only ever picks a label; the coordinates come from the tag it named, so a
// question can never point at a box that does not exist. Two kinds use this:
// a click question, whose box is the ANSWER the child must find, and a pointing
// question, whose box is the SUBJECT the question is about. They are opposites, so
// a turn is one or the other and never both.
const { parseJsonFromModelText } = require('./modelParsing');

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

const MODES = { CLICK: 'click', POINT: 'point', SPOKEN: 'spoken' };

// The mix of question kinds, as cumulative shares of one turn. Tunable in one
// place: raising POINT's share means more circled questions and fewer plain ones.
// CLICK keeps the half it had before pointing questions existed, so its frequency
// is unchanged by this feature.
const MODE_WEIGHTS = [
    [MODES.CLICK, 0.5],
    [MODES.POINT, 0.75],
    [MODES.SPOKEN, 1],
];

// Which kind a turn gets is decided HERE, before the question is written — never
// detected afterwards from the words it happens to use. A pointing question has to
// be commissioned so its referent is a required output of the model: a question
// that says "this balloon" with nothing circled is unanswerable, and detection
// cannot rule that out.
//
// Both image modes need real tags. Without them there is nothing to circle or
// click, so the turn falls back to a plain spoken question rather than asking
// something the child cannot answer.
function resolveQuestionMode(tags) {
    const labels = tagLabels(tags);
    const roll = Math.random();
    const wanted = (MODE_WEIGHTS.find(([, ceiling]) => roll < ceiling) || [MODES.SPOKEN])[0];
    const mode = (wanted !== MODES.SPOKEN && labels.length === 0) ? MODES.SPOKEN : wanted;
    return { mode, labels, wanted };
}

// Renders the label list the prompt tells the model to copy from.
function buildTappableObjectsBlock(tags) {
    const labels = tagLabels(tags);
    if (!labels.length) return '';
    return `<tappable_objects>\n${labels.map((l) => `- "${l}"`).join('\n')}\n</tappable_objects>\n`;
}

// The same list under a different name for pointing questions. Kept separate from
// the tappable block rather than parameterised: the block name is what tells the
// model whether picking a label means "the answer to find" or "the thing to ask
// about", and those must not be one edit away from each other.
function buildVisibleObjectsBlock(tags) {
    const labels = tagLabels(tags);
    if (!labels.length) return '';
    return `<visible_objects>\n${labels.map((l) => `- "${l}"`).join('\n')}\n</visible_objects>\n`;
}

// Case- and whitespace-insensitive only. No fuzzy matching: a near miss means the
// model was not copying from the list, and guessing which tag it meant would put
// the box somewhere the child was never pointed at.
function matchTagByLabel(wanted, tags) {
    const key = String(wanted || '').trim().toLowerCase();
    if (!key) return null;
    return usableTags(tags).find((t) => String(t.label).trim().toLowerCase() === key) || null;
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

    const tag = matchTagByLabel(wanted, tags);
    if (!tag) return null;

    return {
        question,
        answerLabel: String(tag.label).trim(),
        answerBox: tag.box_2d.slice(0, 4).map(Number),
    };
}

// The pointing equivalent. Unlike a click question the expected answer is spoken,
// so it is whatever the model wrote — the tag only supplies the region to circle.
// Still returns null on an unmatched label: "what colour is this balloon?" with no
// balloon circled is worse than no question at all.
function resolvePointReferent(rawModelText, tags) {
    const parsed = parseJsonFromModelText(rawModelText, null);
    const question = String(parsed?.question || '').trim();
    const wanted = String(parsed?.referent_label ?? '').trim();
    if (!question || !wanted) return null;

    const tag = matchTagByLabel(wanted, tags);
    if (!tag) return null;

    const expected = parsed?.expected_answer;
    return {
        question,
        expectedAnswer: (expected == null || expected === '') ? null : String(expected).trim(),
        referentLabel: String(tag.label).trim(),
        referentBox: tag.box_2d.slice(0, 4).map(Number),
    };
}

module.exports = {
    MODES,
    usableTags,
    tagLabels,
    matchTagByLabel,
    resolveQuestionMode,
    buildTappableObjectsBlock,
    buildVisibleObjectsBlock,
    resolveClickAnswer,
    resolvePointReferent,
};
