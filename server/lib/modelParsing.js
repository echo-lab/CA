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

module.exports = {
    parseCategorizationLine,
    parseJsonFromModelText,
};
