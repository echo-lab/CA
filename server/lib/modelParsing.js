// Shared parsers for loosely-formatted model text output.

function parseCategorizationLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;
    const jsonish = trimmed
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        const item = JSON.parse(jsonish);
        return item && typeof item === 'object' && typeof item.category === 'string' ? item : null;
    } catch {
        const match = jsonish.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                const item = JSON.parse(match[0]);
                return item && typeof item === 'object' && typeof item.category === 'string' ? item : null;
            } catch {}
        }
        return null;
    }
}

function parseJsonFromModelText(text, fallback) {
    const raw = String(text || '').trim();
    if (!raw) return fallback;
    const jsonish = raw
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(jsonish);
    } catch {
        const arrayMatch = jsonish.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]);
            } catch {}
        }
        const objectMatch = jsonish.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                return JSON.parse(objectMatch[0]);
            } catch {}
        }
        return fallback;
    }
}

// Pulls the leading run of finished sentences out of a partially-streamed reply, so
// it can be sent to TTS while the model is still writing the rest. Returns '' until
// there is something worth synthesising on its own.
//
// A sentence counts as finished only when whitespace follows its terminator, so a
// trailing "Yes." mid-stream waits for the next token instead of being spoken and
// then contradicted. The match is greedy: several sentences arriving in one chunk go
// out as a single segment rather than one synthesis call each. Fragments shorter than
// minChars also wait, since a two-word segment costs a full round-trip to speak.
function takeCompleteSentences(pending, minChars = 15) {
    const match = /^[\s\S]*[.!?…]["')\]]*(?=\s)/.exec(String(pending || ''));
    if (!match) return '';
    return match[0].trim().length >= minChars ? match[0] : '';
}

module.exports = {
    parseCategorizationLine,
    parseJsonFromModelText,
    takeCompleteSentences,
};
