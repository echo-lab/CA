// What the ask route accepts, and how it behaves when the images can't be drawn.
const assert = require('assert');
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'unused-in-these-tests'; // the client requires one to load
const { parseAskRequest, buildAskMessages, parseAskReply } = require('./lib/askQuestion');

let pass = 0, fail = 0;
const t = async (name, fn) => {
    try { await fn(); pass++; }
    catch (err) { fail++; console.error(`FAIL: ${name}\n  ${err.message}`); }
};

const VALID = { book: 1, currentPageNumber: 2, tap: { x: 500, y: 500 }, transcript: 'What is that?', bookText: 'Text', ttsVoiceName: 'kore' };
const imageCount = (messages) => messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).length;

(async () => {
    await t('a valid request comes through cleaned', () => {
        const r = parseAskRequest(VALID);
        assert.strictEqual(r.book, '1');
        assert.strictEqual(r.question, 'What is that?');
        assert.deepStrictEqual(r.tap, { x: 500, y: 500 });
    });

    await t('a tap with nothing transcribed means "What is this?"', () => {
        for (const transcript of [undefined, '', '   ', 42]) {
            assert.strictEqual(parseAskRequest({ ...VALID, transcript }).question, 'What is this?');
        }
    });

    await t('a long transcript is cut down', () => {
        assert.strictEqual(parseAskRequest({ ...VALID, transcript: 'a'.repeat(5000) }).question.length, 500);
    });

    await t('anything that could reach a file path as more than a number is rejected', () => {
        for (const book of ['../../etc', '1/../..', '1 & echo', null, undefined, '']) {
            assert.strictEqual(parseAskRequest({ ...VALID, book }), null, String(book));
        }
        for (const currentPageNumber of ['2', 0, -1, 1.5, 1000, '../1', null]) {
            assert.strictEqual(parseAskRequest({ ...VALID, currentPageNumber }), null, String(currentPageNumber));
        }
    });

    await t('a request with no valid tap is rejected', () => {
        for (const tap of [undefined, null, {}, { x: 1001, y: 5 }, { x: '5', y: 5 }]) {
            assert.strictEqual(parseAskRequest({ ...VALID, tap }), null, JSON.stringify(tap));
        }
        assert.strictEqual(parseAskRequest(null), null);
    });

    await t('replies parse, and unusable ones become nulls', () => {
        assert.deepStrictEqual(parseAskReply('{"object":"a hat","answer":"It is a hat."}'), { answer: 'It is a hat.', object: 'a hat' });
        assert.deepStrictEqual(parseAskReply('not json'), { answer: null, object: null });
        assert.deepStrictEqual(parseAskReply(''), { answer: null, object: null });
        assert.deepStrictEqual(parseAskReply('{"object":"","answer":"  "}'), { answer: null, object: null });
    });

    await t('normally the model gets the ringed page and the close-up', async () => {
        const messages = await buildAskMessages(parseAskRequest(VALID));
        assert.strictEqual(imageCount(messages), 2);
        assert.ok(!messages[messages.length - 1].content.includes('No ring'));
    });

    await t('if drawing fails, the model gets the plain page and the tap in words', async () => {
        const savedPath = process.env.PATH;
        const savedSystem = process.env.Path;
        process.env.PATH = '';
        process.env.Path = '';
        try {
            const messages = await buildAskMessages(parseAskRequest({ ...VALID, currentPageNumber: 4, tap: { x: 250, y: 800 } }));
            assert.strictEqual(imageCount(messages), 1);
            const text = messages[messages.length - 1].content;
            assert.ok(text.includes('No ring'));
            assert.ok(text.includes('25% of the way across') && text.includes('80% of the way down'), text);
        } finally {
            process.env.PATH = savedPath;
            process.env.Path = savedSystem;
        }
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
