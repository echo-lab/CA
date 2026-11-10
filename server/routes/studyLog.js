const express = require('express');
const { execSync } = require('child_process');

const participants = require('../lib/participants');
const { db } = require('../lib/db');
const imageCache = require('../lib/cache/imageCache');
const {
    PROMPT_VERSION, OPENAI_OFFSCRIPT_MODEL, OPENAI_OFFSCRIPT_REASONING_EFFORT, BEDROCK_OFFSCRIPT_MODEL,
} = require('../lib/openai');

const router = express.Router();

const SCHEMA_VERSION = 1;

const SEQ_FIELD = { events: 'event_seq', transcript: 'utt_seq', questions: 'q_seq' };

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const envValue = (name) => (process.env[name] || '').split('#')[0].trim();
const gitSha = (() => {
    try { return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return envValue('GIT_SHA'); }
})();
const useBedrock = process.env.OFFSCRIPT_PROVIDER === 'bedrock';

// What this server process runs with; stamped once on each new session so analysis can tell configurations apart.
const RUN_SETTINGS = {
    tts_backend: (envValue('TTS_BACKEND') || 'gemini').toLowerCase(),
    tts_model: envValue('VERTEX_MODEL') || 'gemini-3.8-flash-lite-tts',
    gemini_tts_model: envValue('GEMINI_LIVE_MODEL') || 'gemini-2.5-flash-preview-tts',
    child_voice_id: envValue('VERTEX_CHILD_VOICE_ID'),
    offscript_provider: useBedrock ? 'bedrock' : 'openai',
    offscript_model: useBedrock ? BEDROCK_OFFSCRIPT_MODEL : OPENAI_OFFSCRIPT_MODEL,
    offscript_reasoning_effort: OPENAI_OFFSCRIPT_REASONING_EFFORT,
    prompt_version: PROMPT_VERSION,
    image_tag_model: 'gemini-2.5-flash',
    image_cache_version: imageCache.CFG.version,
    stt_model: 'nova-3',
    git_sha: gitSha,
};

// Resolves the roster record for a user id, or an error response payload.
async function resolveUser(userId) {
    const record = await participants.lookup(userId);
    if (!record && await participants.isEnforced()) {
        return { error: { message: `Unknown participant ID: ${userId}`, unknown: [userId] } };
    }
    return { userId: record?.user_id ?? userId };
}

// 503 tells the client to requeue and retry, so a DB outage loses nothing.
function dbUnavailable(res, where, err) {
    console.error(`[study-log ${where}] database error:`, err.message);
    res.status(503).json({ message: 'Database unavailable' });
}

router.post('/api/study-log/session', async (req, res) => {
    const session = req.body?.session;
    if (!session || typeof session !== 'object') {
        return res.status(400).json({ message: 'Provide {session}' });
    }
    if (!SESSION_ID_RE.test(String(session.session_id || ''))) {
        return res.status(400).json({ message: 'Invalid session_id' });
    }

    try {
        const resolved = await resolveUser(session.user_id);
        if (resolved.error) return res.status(400).json(resolved.error);

        const { _id, question_voice, ...fields } = session;
        // Empty fields are skipped so a late or repeated start row can't blank ended_at.
        const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v != null));
        Object.assign(set, { user_id: resolved.userId, schema_version: SCHEMA_VERSION, updated_at: new Date() });

        const result = await db.collection('sessions').updateOne(
            { user_id: resolved.userId, session_id: String(session.session_id) },
            {
                $set: set,
                $setOnInsert: { run_settings: { ...RUN_SETTINGS, question_voice: question_voice || null }, created_at: new Date() },
            },
            { upsert: true }
        );
        const outcome = result.upsertedCount ? 'created' : 'updated';
        console.log(`[study-log session] ${outcome} ${resolved.userId}/${session.session_id} (book ${session.book_id})`);
        res.json({ success: true, outcome });
    } catch (err) {
        dbUnavailable(res, 'session', err);
    }
});

router.post('/api/study-log/batch', async (req, res) => {
    const { sessionId, userId, streams } = req.body || {};

    if (!SESSION_ID_RE.test(String(sessionId || ''))) {
        return res.status(400).json({ message: 'Invalid or missing sessionId' });
    }
    if (!streams || typeof streams !== 'object') {
        return res.status(400).json({ message: 'Provide {sessionId, userId, streams}' });
    }

    try {
        const resolved = await resolveUser(userId);
        if (resolved.error) return res.status(400).json(resolved.error);

        const counts = {};
        for (const [stream, seqField] of Object.entries(SEQ_FIELD)) {
            const rows = streams[stream];
            if (!Array.isArray(rows) || rows.length === 0) continue;

            const docs = rows
                .filter((r) => r && Number.isFinite(Number(r[seqField])))
                .map(({ _id, ...r }) => ({ ...r, [seqField]: Number(r[seqField]), session_id: String(sessionId), user_id: resolved.userId }));
            if (docs.length === 0) { counts[stream] = 0; continue; }

            try {
                counts[stream] = (await db.collection(stream).insertMany(docs, { ordered: false })).insertedCount;
            } catch (err) {
                // Duplicate keys are retried rows that are already stored; anything else is a real failure.
                const writeErrors = [].concat(err.writeErrors || []);
                if (!writeErrors.length || !writeErrors.every((e) => e.code === 11000)) throw err;
                counts[stream] = err.insertedCount ?? err.result?.insertedCount ?? 0;
            }
        }

        const written = Object.values(counts).reduce((a, b) => a + b, 0);
        if (written) console.log(`[study-log batch] ${resolved.userId}/${sessionId} ${JSON.stringify(counts)}`);
        res.json({ success: true, counts });
    } catch (err) {
        dbUnavailable(res, 'batch', err);
    }
});

module.exports = router;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.RUN_SETTINGS = RUN_SETTINGS;
