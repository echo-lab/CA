const express = require('express');
const fs = require('fs');
const path = require('path');

const participants = require('../lib/participants');
const { escape, appendRows, concatBodies } = require('../lib/csv');

const { collectLogFiles, filterToParticipant } = participants;

const router = express.Router();

// Resolve paths relative to the server/ root (this file lives in server/routes/).
const SERVER_ROOT = path.join(__dirname, '..');

// Participant lookup — the client calls this before letting anyone into the
// study flow. IDs are provisioned by hand in server/participants.json; there is
// deliberately no endpoint that creates one.
router.get('/api/participants/:id', (req, res) => {
    const record = participants.lookup(req.params.id);
    if (!record) {
        return res.status(404).json({ message: 'Unknown participant ID' });
    }
    // Create the participant's log folder at sign-in, so it exists before any
    // rows are written instead of appearing only on the first batch flush.
    participants.ensureParticipantDir(record.user_id);
    res.json({ participant: record });
});

router.post('/api/log-session', (req, res) => {
    const { name, book, sessionId, rows } = req.body || {};

    // Shape 2: per-session event log
    if (sessionId && Array.isArray(rows)) {
        if (rows.length === 0) {
            return res.status(400).json({ message: 'rows must be non-empty' });
        }
        // Reject unknown participants outright. A dropped ID would otherwise
        // surface as a hole in the data long after the session is over, so it
        // is better for the client to fail loudly while the study is running.
        if (participants.isEnforced()) {
            const unknown = [...new Set(rows.map((r) => r && r.user_id))]
                .filter((id) => !participants.lookup(id));
            if (unknown.length) {
                console.warn(`[log-session events] rejected — unknown user_id(s): ${unknown.map((u) => JSON.stringify(u)).join(', ')}`);
                return res.status(400).json({
                    message: 'Rows contain user_id values that are not in participants.json',
                    unknown
                });
            }
        }
        const headers = [
            'session_id', 'user_id', 'book_id', 'event_type', 'timestamp',
            'page_number', 'latency_ms', 'manual_interventions',
            'line_index', 'direction', 'trigger'
        ];
        // Write the roster's spelling of user_id, not whatever case/spacing the
        // client sent, so grouping at analysis time is exact.
        const canonicalId = (id) => participants.lookup(id)?.user_id ?? id;
        const csvRows = rows.map((r) => headers.map((h) => (
            escape(h === 'user_id' ? canonicalId(r[h]) : r[h])
        )).join(','));
        const csv = headers.join(',') + '\n' + csvRows.join('\n') + '\n';

        const logsDir = path.join(SERVER_ROOT, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const csvPath = path.join(logsDir, `session_${sessionId}.csv`);
        fs.writeFileSync(csvPath, csv);

        console.log(`[log-session events] wrote ${rows.length} rows → ${csvPath}`);
        return res.json({ success: true, count: rows.length, path: `logs/session_${sessionId}.csv` });
    }

    // Shape 1: study-setup metadata row
    if (!name || !book) {
        return res.status(400).json({
            message: 'Provide either {name, book} or {sessionId, rows}'
        });
    }
    // `name` carries the participant ID in this shape too.
    const record = participants.lookup(name);
    if (participants.isEnforced() && !record) {
        return res.status(400).json({ message: `Unknown participant ID: ${name}` });
    }
    const participantId = record?.user_id ?? name;

    const csvPath = path.join(SERVER_ROOT, 'session-log.csv');
    const timestamp = new Date().toISOString();
    const header = 'timestamp,name,book\n';
    const row = `${timestamp},${participantId},${book}\n`;

    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, header + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }
    console.log(`[session-log] ${participantId}, book ${book}`);
    res.json({ success: true });
});

// Download session log CSV
router.get('/api/log-session/download', (req, res) => {
    const csvPath = path.join(SERVER_ROOT, 'session-log.csv');
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ message: 'No session log found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=session-log.csv');
    res.sendFile(csvPath);
});

// Download all per-session event logs concatenated into one CSV.
// Each row carries session_id so they can be unambiguously grouped at analysis.
router.get('/api/log-events/download', (req, res) => {
    const logsDir = path.join(SERVER_ROOT, 'logs');
    if (!fs.existsSync(logsDir)) {
        return res.status(404).json({ message: 'No event logs found' });
    }
    // Legacy single-schema logs only. The study-log streams also live in this
    // directory as session_<id>_events.csv etc. with different headers, and
    // concatenating those in here would silently produce a ragged CSV.
    const files = fs.readdirSync(logsDir)
        .filter((f) => (
            f.startsWith('session_') &&
            f.endsWith('.csv') &&
            !/_(events|transcript|questions)\.csv$/.test(f)
        ))
        .sort();
    if (files.length === 0) {
        return res.status(404).json({ message: 'No event logs found' });
    }

    let header = null;
    const bodies = [];
    for (const f of files) {
        const content = fs.readFileSync(path.join(logsDir, f), 'utf8');
        const newlineIdx = content.indexOf('\n');
        if (newlineIdx === -1) continue;
        const fileHeader = content.slice(0, newlineIdx);
        const fileBody = content.slice(newlineIdx + 1);
        if (header === null) header = fileHeader;
        if (fileBody.trim()) bodies.push(fileBody.endsWith('\n') ? fileBody : fileBody + '\n');
    }
    if (!header) {
        return res.status(404).json({ message: 'No event log content' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=event-logs.csv');
    res.send(header + '\n' + bodies.join(''));
});

module.exports = router;
