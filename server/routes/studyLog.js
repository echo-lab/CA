const express = require('express');
const fs = require('fs');
const path = require('path');

const participants = require('../lib/participants');
const { appendRows, upsertRow, concatBodies } = require('../lib/csv');

const router = express.Router();
const SERVER_ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(SERVER_ROOT, 'logs');

const SCHEMA_VERSION = 1;

const SESSION_HEADERS = [
    'session_id', 'user_id', 'book_id', 'book_name', 'is_training', 'schema_version',
    'started_at', 'ended_at', 'duration_ms', 'manual_interventions_total', 'pages_reached',
    'character_1_name', 'character_1_role', 'character_2_name', 'character_2_role', 'character_3_name', 'character_3_role'
];

const STREAM_HEADERS = {
    events: [
        'session_id', 'user_id', 'book_id', 'role', 'event_seq', 'event_type', 'timestamp',
        'page_number', 'line_index', 'latency_ms', 'manual_interventions',
        'intervention_source', 'direction', 'trigger', 'detail'
    ],
    transcript: [
        'session_id', 'user_id', 'book_id', 'utt_seq', 'timestamp', 'dg_start', 'dg_duration', 
        'speaker', 'speech_final', 'transcript', 'avg_confidence', 'page_number', 'line_index', 
        'expected_character', 'expected_role', 'expected_role_kind'
    ],
    questions: [
        'session_id', 'user_id', 'book_id', 'q_seq', 'timestamp', 'question_id', 
        'question_type', 'event', 'reason', 'question_text', 'expected_answer', 
        'page_number', 'line_index'
    ]
};

const SEQ_FIELD = { events: 'event_seq', transcript: 'utt_seq', questions: 'q_seq' };

// session_id reaches path.join, so it must be constrained before use.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const {
    participantDirName, participantDir, ensureParticipantDir,
    collectLogFiles, filterToParticipant,
} = participants;

const SESSIONS_FILE = 'sessions.csv';

function collectStreamFiles(stream) {
    const suffix = `_${stream}.csv`;
    return collectLogFiles((name) => name.startsWith('session_') && name.endsWith(suffix));
}

function collectSessionFiles() {
    return collectLogFiles((name) => name === SESSIONS_FILE);
}

const acceptedSeq = new Map();

function seqStateFor(sessionId) {
    if (!acceptedSeq.has(sessionId)) {
        acceptedSeq.set(sessionId, { events: 0, transcript: 0, questions: 0 });
    }
    return acceptedSeq.get(sessionId);
}

// Resolves the roster record for a user id, or an error response payload.
function resolveUser(userId) {
    const record = participants.lookup(userId);
    if (participants.isEnforced() && !record) {
        return { error: { message: `Unknown participant ID: ${userId}`, unknown: [userId] } };
    }
    return { userId: record?.user_id ?? userId };
}

router.post('/api/study-log/session', (req, res) => {
    const session = req.body?.session;
    if (!session || typeof session !== 'object') {
        return res.status(400).json({ message: 'Provide {session}' });
    }
    if (!SESSION_ID_RE.test(String(session.session_id || ''))) {
        return res.status(400).json({ message: 'Invalid session_id' });
    }

    const resolved = resolveUser(session.user_id);
    if (resolved.error) return res.status(400).json(resolved.error);

    ensureParticipantDir(resolved.userId);

    const row = { ...session, user_id: resolved.userId, schema_version: SCHEMA_VERSION };

    const outcome = upsertRow(
        path.join(participantDir(resolved.userId), SESSIONS_FILE),
        SESSION_HEADERS,
        row,
        'session_id'
    );

    console.log(`[study-log session] ${outcome} ${participantDirName(resolved.userId)}/${row.session_id} (book ${row.book_id})`);
    res.json({ success: true, outcome });
});

router.post('/api/study-log/batch', (req, res) => {
    const { sessionId, userId, streams } = req.body || {};

    if (!SESSION_ID_RE.test(String(sessionId || ''))) {
        return res.status(400).json({ message: 'Invalid or missing sessionId' });
    }
    if (!streams || typeof streams !== 'object') {
        return res.status(400).json({ message: 'Provide {sessionId, userId, streams}' });
    }

    const resolved = resolveUser(userId);
    if (resolved.error) return res.status(400).json(resolved.error);

    ensureParticipantDir(resolved.userId);

    const state = seqStateFor(sessionId);
    const counts = {};

    for (const [stream, headers] of Object.entries(STREAM_HEADERS)) {
        const rows = streams[stream];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const seqField = SEQ_FIELD[stream];
        const fresh = rows.filter((r) => Number(r?.[seqField]) > state[stream]);
        if (fresh.length === 0) {
            counts[stream] = 0;
            continue;
        }

        // The stream headers no longer carry schema_version; only sessions.csv
        // does. Anything not in `headers` is dropped by appendRows anyway.
        const stamped = fresh.map((r) => ({
            ...r,
            session_id: sessionId,
            user_id: resolved.userId,
        }));

        const filePath = path.join(participantDir(resolved.userId), `session_${sessionId}_${stream}.csv`);
        counts[stream] = appendRows(filePath, headers, stamped);
        state[stream] = Math.max(state[stream], ...fresh.map((r) => Number(r[seqField]) || 0));
    }

    const written = Object.values(counts).reduce((a, b) => a + b, 0);
    if (written) {
        console.log(`[study-log batch] ${participantDirName(resolved.userId)}/${sessionId} ${JSON.stringify(counts)}`);
    }
    res.json({ success: true, counts, accepted_seq: { ...state } });
});

router.get('/api/study-log/download/:stream', (req, res) => {
    const { stream } = req.params;
    const headers = STREAM_HEADERS[stream];
    if (!headers) {
        return res.status(404).json({ message: `Unknown stream: ${stream}` });
    }
    if (!fs.existsSync(LOGS_DIR)) {
        return res.status(404).json({ message: 'No logs found' });
    }

    // ?participant=T001 exports just that participant's folder.
    const participant = req.query.participant;
    let files = collectStreamFiles(stream);
    if (participant) files = filterToParticipant(files, participant);
    if (files.length === 0) {
        return res.status(404).json({
            message: participant
                ? `No ${stream} logs found for ${participant}`
                : `No ${stream} logs found`
        });
    }

    const filename = participant
        ? `${participantDirName(participant)}-${stream}-logs.csv`
        : `${stream}-logs.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(headers.join(',') + '\n' + concatBodies(files));
});

// Session metadata, concatenated across every participant folder. There is no
// longer a single global sessions.csv on disk — this endpoint is what rebuilds
// the cross-participant view on demand.
router.get('/api/study-log/download-sessions', (req, res) => {
    const participant = req.query.participant;
    let files = collectSessionFiles();
    if (participant) files = filterToParticipant(files, participant);
    if (files.length === 0) {
        return res.status(404).json({
            message: participant
                ? `No sessions log found for ${participant}`
                : 'No sessions log found'
        });
    }

    const filename = participant
        ? `${participantDirName(participant)}-sessions.csv`
        : 'sessions.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(SESSION_HEADERS.join(',') + '\n' + concatBodies(files));
});

module.exports = router;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
