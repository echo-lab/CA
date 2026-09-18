// A click or pointing question is only usable if the label the model picked maps to
// a real tag box. These cover the ways the model can hand back something that does not.
const assert = require('assert');
const {
    MODES,
    usableTags,
    tagLabels,
    resolveQuestionMode,
    buildTappableObjectsBlock,
    buildVisibleObjectsBlock,
    resolveClickAnswer,
    resolvePointReferent,
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

t('the three modes hold their shares, and are mutually exclusive by construction', () => {
    const N = 6000;
    const seen = { click: 0, point: 0, spoken: 0 };
    for (let i = 0; i < N; i++) seen[resolveQuestionMode(TAGS).mode]++;
    // ~50/25/25; the windows are wide enough that a fair roll effectively never trips them.
    assert.ok(seen.click > N * 0.44 && seen.click < N * 0.56, `click fired ${seen.click}/${N}`);
    assert.ok(seen.point > N * 0.20 && seen.point < N * 0.30, `point fired ${seen.point}/${N}`);
    assert.ok(seen.spoken > N * 0.20 && seen.spoken < N * 0.30, `spoken fired ${seen.spoken}/${N}`);
    // One roll returns one mode, so a turn can never be both click and point — that
    // would put an ellipse on the answer the child is supposed to find.
    assert.strictEqual(seen.click + seen.point + seen.spoken, N);

    // No usable tags -> spoken every time, however the roll lands.
    for (let i = 0; i < 300; i++) {
        assert.strictEqual(resolveQuestionMode([]).mode, MODES.SPOKEN);
        assert.strictEqual(resolveQuestionMode(null).mode, MODES.SPOKEN);
        assert.strictEqual(resolveQuestionMode([{ label: 'reversed', box_2d: [400, 400, 100, 100] }]).mode, MODES.SPOKEN);
    }
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

t('the visible list carries the same labels under its own block name', () => {
    assert.strictEqual(buildVisibleObjectsBlock([]), '');
    const block = buildVisibleObjectsBlock(TAGS);
    assert.ok(block.includes('<visible_objects>'));
    assert.ok(!block.includes('tappable'), 'a pointing prompt must not be told these are answers');
    assert.ok(block.includes('- "Clara"'));
    assert.ok(!block.includes('reversed'));
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

// --- pointing questions: the box is the SUBJECT, not the answer ---

t('a referent resolves to that tag\'s own coordinates', () => {
    const r = resolvePointReferent(
        '{"question":"What colour is this plate?","referent_label":"the purple plate","expected_answer":"purple"}',
        TAGS,
    );
    assert.strictEqual(r.question, 'What colour is this plate?');
    assert.strictEqual(r.referentLabel, 'the purple plate');
    assert.deepStrictEqual(r.referentBox, [500, 100, 600, 250]);
});

t('the spoken answer is kept, and is not the label', () => {
    const r = resolvePointReferent(
        '{"question":"What colour is this plate?","referent_label":"the purple plate","expected_answer":"purple"}',
        TAGS,
    );
    // A click question answers with the label; a pointing question answers in words
    // about the circled thing, so the two must never be conflated.
    assert.strictEqual(r.expectedAnswer, 'purple');
    assert.notStrictEqual(r.expectedAnswer, r.referentLabel);
});

t('an open-ended referent question keeps a null answer rather than an empty string', () => {
    const r = resolvePointReferent('{"question":"How does this one feel?","referent_label":"Clara","expected_answer":""}', TAGS);
    assert.strictEqual(r.expectedAnswer, null);
    assert.deepStrictEqual(r.referentBox, [100, 200, 300, 400]);
});

t('referent matching ignores case and padding', () => {
    const r = resolvePointReferent('{"question":"What is this?","referent_label":"  CLARA "}', TAGS);
    assert.strictEqual(r.referentLabel, 'Clara', 'returns the tag\'s own casing');
});

t('an invented or degenerate referent is rejected, never guessed at', () => {
    // Rejecting matters more here than for a click: "what colour is this balloon?"
    // with no balloon circled is a question the child cannot answer at all.
    assert.strictEqual(resolvePointReferent('{"question":"What colour is this balloon?","referent_label":"balloon"}', TAGS), null);
    assert.strictEqual(resolvePointReferent('{"question":"What is this?","referent_label":"purple plate"}', TAGS), null);
    assert.strictEqual(resolvePointReferent('{"question":"What is this?","referent_label":"reversed"}', TAGS), null);
});

t('a pointing question with no referent at all is rejected', () => {
    assert.strictEqual(resolvePointReferent('{"question":"What colour is this?"}', TAGS), null);
    assert.strictEqual(resolvePointReferent('{"question":"What colour is this?","referent_label":""}', TAGS), null);
    assert.strictEqual(resolvePointReferent('{"referent_label":"Clara"}', TAGS), null);
    assert.strictEqual(resolvePointReferent('', TAGS), null);
});

t('answer_label is not accepted as a referent', () => {
    // The click prompt's key must not leak a box into a pointing question: it names
    // the thing to find, which is the opposite of the thing to ask about.
    assert.strictEqual(resolvePointReferent('{"question":"What is this?","answer_label":"Clara"}', TAGS), null);
});

console.log(`click-answer: ${pass}/${pass + fail} OK`);
if (fail) process.exit(1);
