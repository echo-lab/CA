// A click question is only usable if its answer maps to a real tag box. These
// cover the ways the model can hand back something that does not.
const assert = require('assert');
const {
    isClickQuestionBook,
    usableTags,
    tagLabels,
    buildTappableObjectsBlock,
    resolveClickAnswer,
} = require('./lib/clickAnswer');

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; }
    catch (err) { fail++; console.error(`FAIL: ${name}\n  ${err.message}`); }
};

const TAGS = [
    { label: 'Clara', box_2d: [100, 200, 300, 400] },
    { label: 'the purple plate', box_2d: [500, 100, 600, 250] },
    { label: 'broken', box_2d: [10, 10, 10, 400] },   // zero height
    { label: 'reversed', box_2d: [400, 400, 100, 100] }, // corners swapped
    { label: '', box_2d: [0, 0, 100, 100] },           // no label
    { label: 'short', box_2d: [0, 0] },                 // truncated box
];

t('book 2 is the click book, others are not', () => {
    assert.strictEqual(isClickQuestionBook(2), true);
    assert.strictEqual(isClickQuestionBook('2'), true);
    assert.strictEqual(isClickQuestionBook(1), false);
    assert.strictEqual(isClickQuestionBook(3), false);
    assert.strictEqual(isClickQuestionBook(undefined), false);
});

t('degenerate boxes are not offered as answers', () => {
    assert.deepStrictEqual(tagLabels(TAGS), ['Clara', 'the purple plate']);
    assert.strictEqual(usableTags(null).length, 0);
});

t('the tappable list is empty when nothing is usable', () => {
    assert.strictEqual(buildTappableObjectsBlock([]), '');
    assert.ok(buildTappableObjectsBlock(TAGS).includes('- "Clara"'));
    assert.ok(!buildTappableObjectsBlock(TAGS).includes('reversed'));
});

t('a valid label resolves to that tag\'s own coordinates', () => {
    const r = resolveClickAnswer('{"question":"Click Clara!","answer_label":"Clara"}', TAGS);
    assert.strictEqual(r.question, 'Click Clara!');
    assert.strictEqual(r.answerLabel, 'Clara');
    assert.deepStrictEqual(r.answerBox, [100, 200, 300, 400]);
});

t('label matching ignores case and padding', () => {
    const r = resolveClickAnswer('{"question":"Tap it","answer_label":"  THE PURPLE PLATE "}', TAGS);
    assert.deepStrictEqual(r.answerBox, [500, 100, 600, 250]);
    assert.strictEqual(r.answerLabel, 'the purple plate', 'returns the tag\'s own casing');
});

t('an invented object is rejected rather than guessed at', () => {
    assert.strictEqual(resolveClickAnswer('{"question":"Tap the pillow","answer_label":"the pillow"}', TAGS), null);
});

t('a near miss is rejected, never fuzzy-matched', () => {
    assert.strictEqual(resolveClickAnswer('{"question":"Tap it","answer_label":"purple plate"}', TAGS), null);
});

t('a label naming a degenerate tag is rejected', () => {
    assert.strictEqual(resolveClickAnswer('{"question":"Tap it","answer_label":"reversed"}', TAGS), null);
});

t('expected_answer is accepted as a fallback key', () => {
    const r = resolveClickAnswer('{"question":"Tap Clara","expected_answer":"Clara"}', TAGS);
    assert.deepStrictEqual(r.answerBox, [100, 200, 300, 400]);
});

t('fenced json still parses', () => {
    const r = resolveClickAnswer('```json\n{"question":"Tap Clara","answer_label":"Clara"}\n```', TAGS);
    assert.strictEqual(r.answerLabel, 'Clara');
});

t('prose, empty output and a missing question are all rejected', () => {
    assert.strictEqual(resolveClickAnswer('Click on Clara!', TAGS), null);
    assert.strictEqual(resolveClickAnswer('', TAGS), null);
    assert.strictEqual(resolveClickAnswer('{"answer_label":"Clara"}', TAGS), null);
});

console.log(`click-answer: ${pass}/${pass + fail} OK`);
if (fail) process.exit(1);
