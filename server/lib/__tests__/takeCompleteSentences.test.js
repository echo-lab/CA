// Guards the sentence segmentation that decides what gets sent to TTS while the
// model is still generating (server/routes/acknowledgement.js). The failure that
// matters: emitting a fragment that the next token would have changed, or never
// emitting at all and silently falling back to whole-reply synthesis.
const assert = require('assert');
const { takeCompleteSentences } = require('../modelParsing');

// Replays a reply token by token the way the SSE loop does, collecting what would
// have been spoken. Returns [segments, leftover].
function drain(tokens, minChars) {
    let raw = '';
    let spokenUpTo = 0;
    const spoken = [];
    for (const token of tokens) {
        raw += token;
        const segment = takeCompleteSentences(raw.slice(spokenUpTo), minChars);
        if (segment) {
            spoken.push(segment.trim());
            spokenUpTo += segment.length;
        }
    }
    return [spoken, raw.slice(spokenUpTo)];
}

// A sentence is not spoken until whitespace confirms it ended.
assert.strictEqual(takeCompleteSentences('That is exactly right.'), '');
assert.strictEqual(takeCompleteSentences('That is exactly right. ').trim(), 'That is exactly right.');

// Fragments below the floor wait for more text instead of paying a round-trip.
assert.strictEqual(takeCompleteSentences('Yes! '), '');
assert.strictEqual(takeCompleteSentences('Yes! ', 3).trim(), 'Yes!');

// Several sentences arriving together go out as one segment, not one call each.
assert.strictEqual(
    takeCompleteSentences('Good thinking! The parrot is red. ').trim(),
    'Good thinking! The parrot is red.',
);

// Closing quotes and brackets stay attached to the sentence they end.
assert.strictEqual(
    takeCompleteSentences('She said "look at the bird." ').trim(),
    'She said "look at the bird."',
);

// Decimals and mid-word dots do not split, since no whitespace follows them.
assert.strictEqual(takeCompleteSentences('There are 3.5 apples here'), '');

// Streaming a two-sentence reply speaks the first while the second is still being
// written, and leaves the unterminated tail for the caller to flush.
const [spoken, leftover] = drain([
    'That is ', 'exactly ', 'right! ', 'The parrot ', 'is red ', 'and loud', '.',
]);
assert.deepStrictEqual(spoken, ['That is exactly right!']);
// The separating whitespace stays with the tail; the caller trims before speaking.
assert.strictEqual(leftover.trim(), 'The parrot is red and loud.');

// Nothing speakable yet must report nothing rather than throwing.
for (const empty of [undefined, null, '', '   ']) {
    assert.strictEqual(takeCompleteSentences(empty), '');
}

console.log('takeCompleteSentences: all assertions passed');
