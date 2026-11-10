// Admin API (roster + recent sessions), all behind requireAdmin; removing a participant never deletes their data.
const express = require('express');
const participants = require('../lib/participants');
const { db } = require('../lib/db');
const { requireAdmin } = require('../lib/adminAuth');

const router = express.Router();

// Letters, digits, _ and - only, so ids stay safe to use as keys and in URLs.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

router.use('/api/admin', requireAdmin);

// Lets the page tell "wrong token" from "server unreachable" before it renders.
router.get('/api/admin/session', (req, res) => res.json({ ok: true }));

router.get('/api/admin/participants', async (req, res) => {
    try {
        res.json({ participants: await participants.list() });
    } catch (err) {
        res.status(503).json({ message: `Could not read the roster: ${err.message}` });
    }
});

router.post('/api/admin/participants', async (req, res) => {
    const body = req.body || {};
    const userId = String(body.user_id || '').trim();
    if (!USER_ID_RE.test(userId)) {
        return res.status(400).json({ message: 'user_id must be 1-64 chars: letters, digits, _ or - only.' });
    }
    try {
        const record = await participants.add({ ...body, user_id: userId });
        console.log(`[admin] added participant ${userId}`);
        res.status(201).json({ participant: record, participants: await participants.list() });
    } catch (err) {
        // Duplicate _id: the id is already on the roster in some spelling.
        if (err.code === 11000) return res.status(409).json({ message: `"${userId}" is already on the roster.` });
        res.status(503).json({ message: `Could not update the roster: ${err.message}` });
    }
});

router.delete('/api/admin/participants/:id', async (req, res) => {
    if (!participants.normalizeId(req.params.id)) return res.status(400).json({ message: 'Missing participant id.' });
    try {
        if (!(await participants.remove(req.params.id))) {
            return res.status(404).json({ message: `"${req.params.id}" is not on the roster.` });
        }
        console.log(`[admin] removed participant ${req.params.id} (logged data kept in the database)`);
        res.json({ removed: req.params.id, logsKept: true, participants: await participants.list() });
    } catch (err) {
        res.status(503).json({ message: `Could not update the roster: ${err.message}` });
    }
});

// The most recent sessions, so a researcher can confirm a session landed without opening mongosh.
router.get('/api/admin/sessions', async (req, res) => {
    try {
        const sessions = await db.collection('sessions')
            .find({}, { projection: { _id: 0, user_id: 1, session_id: 1, book_name: 1, is_training: 1, started_at: 1, ended_at: 1, pages_reached: 1 } })
            .sort({ created_at: -1 })
            .limit(500)
            .toArray();
        res.json({ sessions });
    } catch (err) {
        res.status(503).json({ message: `Could not read sessions: ${err.message}` });
    }
});

module.exports = router;
