// Admin API: roster management and log-file browsing.
//
// Every route here is behind requireAdmin. Removing a participant drops their
// roster row but never touches their collected data — deleting human-subjects
// records on a button press is not something this endpoint will do.
const express = require('express');
const fs = require('fs');
const path = require('path');
const participants = require('../lib/participants');
const { requireAdmin } = require('../lib/adminAuth');

const router = express.Router();
const { LOGS_DIR, normalizeId, readRoster, writeRoster } = participants;

// Same shape the roster already uses for folder names, so an id can never walk
// out of logs/ or produce a row that later code cannot map to a directory.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

router.use('/api/admin', requireAdmin);

// Lets the page tell "wrong token" from "server unreachable" before it renders.
router.get('/api/admin/session', (req, res) => res.json({ ok: true }));

router.get('/api/admin/participants', (req, res) => {
    try {
        res.json({ participants: readRoster() });
    } catch (err) {
        res.status(500).json({ message: `Could not read the roster: ${err.message}` });
    }
});

router.post('/api/admin/participants', (req, res) => {
    const body = req.body || {};
    const userId = String(body.user_id || '').trim();
    if (!USER_ID_RE.test(userId)) {
        return res.status(400).json({ message: 'user_id must be 1-64 chars: letters, digits, _ or - only.' });
    }
    try {
        const rows = readRoster();
        // Case-insensitive, matching how lookup() resolves ids at sign-in.
        if (rows.some((r) => normalizeId(typeof r === 'string' ? r : r?.user_id) === normalizeId(userId))) {
            return res.status(409).json({ message: `"${userId}" is already on the roster.` });
        }
        const record = { ...body, user_id: userId };
        rows.push(record);
        writeRoster(rows);
        // Give them a log folder now rather than at first write, so the admin
        // page shows the participant immediately instead of after their session.
        participants.ensureParticipantDir(userId);
        console.log(`[admin] added participant ${userId}`);
        res.status(201).json({ participant: record, participants: rows });
    } catch (err) {
        res.status(500).json({ message: `Could not update the roster: ${err.message}` });
    }
});

router.delete('/api/admin/participants/:id', (req, res) => {
    const target = normalizeId(req.params.id);
    if (!target) return res.status(400).json({ message: 'Missing participant id.' });
    try {
        const rows = readRoster();
        const kept = rows.filter((r) => normalizeId(typeof r === 'string' ? r : r?.user_id) !== target);
        if (kept.length === rows.length) {
            return res.status(404).json({ message: `"${req.params.id}" is not on the roster.` });
        }
        writeRoster(kept);
        console.log(`[admin] removed participant ${req.params.id} (log files left on disk)`);
        res.json({ removed: req.params.id, logsKept: true, participants: kept });
    } catch (err) {
        res.status(500).json({ message: `Could not update the roster: ${err.message}` });
    }
});

// Everything under logs/, flattened, with the owning participant folder named.
router.get('/api/admin/logs', (req, res) => {
    if (!fs.existsSync(LOGS_DIR)) return res.json({ files: [] });
    const files = participants.collectLogFiles(() => true).map((abs) => {
        const rel = path.relative(LOGS_DIR, abs);
        const stat = fs.statSync(abs);
        const dir = path.dirname(rel);
        return {
            file: rel,
            participant: dir === '.' ? null : dir,
            bytes: stat.size,
            modified: stat.mtimeMs,
        };
    });
    res.json({ files });
});

router.get('/api/admin/logs/download', (req, res) => {
    const requested = String(req.query.file || '');
    if (!requested) return res.status(400).json({ message: 'Missing ?file=' });

    // The path comes from the client, so resolve it and confirm it really lands
    // inside logs/ — a relative path is otherwise free to climb out with "..".
    const root = path.resolve(LOGS_DIR);
    const abs = path.resolve(root, requested);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        return res.status(400).json({ message: 'Path is outside the logs directory.' });
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ message: 'No such log file.' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(abs).replace(/[^A-Za-z0-9_.-]/g, '_')}`);
    fs.createReadStream(abs).pipe(res);
});

module.exports = router;
