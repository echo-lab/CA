const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Resolve paths relative to the server/ root (this file lives in server/routes/).
const SERVER_ROOT = path.join(__dirname, '..');

// Two payload shapes share this endpoint:
//   1. {name, book}                — single-row session metadata (study setup)
//                                    appended to server/session-log.csv
//   2. {sessionId, rows}           — full event log for a session (from
//                                    src/logGeneration.js); overwrites
//                                    server/logs/session_<sessionId>.csv
router.post('/api/log-session', (req, res) => {
    const { name, book, sessionId, rows } = req.body || {};

    // Shape 2: per-session event log
    if (sessionId && Array.isArray(rows)) {
        if (rows.length === 0) {
            return res.status(400).json({ message: 'rows must be non-empty' });
        }
        const headers = [
            'session_id', 'user_id', 'book_id', 'event_type', 'timestamp',
            'page_number', 'latency_ms', 'manual_interventions',
            'line_index', 'direction', 'trigger'
        ];
        const escape = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csvRows = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
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
    const csvPath = path.join(SERVER_ROOT, 'session-log.csv');
    const timestamp = new Date().toISOString();
    const header = 'timestamp,name,book\n';
    const row = `${timestamp},${name},${book}\n`;

    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, header + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }
    console.log(`[session-log] ${name}, book ${book}`);
    res.json({ success: true });
});

// Survey responses — appended to server/survey-log.csv
// Payload: { name, book, answers }
// answers: { "0": 1..5, "1": 1..5, ... } (one entry per question index)
router.post('/api/log-survey', (req, res) => {
    const { name, book, answers } = req.body || {};
    if (!name || !book || !answers || typeof answers !== 'object') {
        return res.status(400).json({ message: 'Provide {name, book, answers}' });
    }

    const NUM_QUESTIONS = 9;
    const csvPath = path.join(SERVER_ROOT, 'survey-log.csv');
    const timestamp = new Date().toISOString();

    const qHeaders = Array.from({ length: NUM_QUESTIONS }, (_, i) => `q${i + 1}`).join(',');
    const header = `timestamp,name,book,${qHeaders}\n`;

    const qValues = Array.from({ length: NUM_QUESTIONS }, (_, i) => answers[i] ?? '').join(',');
    const row = `${timestamp},${name},${book},${qValues}\n`;

    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, header + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }
    console.log(`[survey-log] ${name}, book ${book}`);
    res.json({ success: true });
});

// Download survey log CSV
router.get('/api/log-survey/download', (req, res) => {
    const csvPath = path.join(SERVER_ROOT, 'survey-log.csv');
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ message: 'No survey log found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=survey-log.csv');
    res.sendFile(csvPath);
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
    const files = fs.readdirSync(logsDir)
        .filter((f) => f.startsWith('session_') && f.endsWith('.csv'))
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
