const express = require('express');

const participants = require('../lib/participants');

const router = express.Router();

// Participant lookup used before entering the study; IDs are added through the Admin page (users collection).
router.get('/api/participants/:id', async (req, res) => {
    try {
        const record = await participants.lookup(req.params.id);
        if (!record) {
            return res.status(404).json({ message: 'Unknown participant ID' });
        }
        res.json({ participant: record });
    } catch (err) {
        console.error('[participants] lookup failed:', err.message);
        res.status(503).json({ message: 'Database unavailable' });
    }
});

module.exports = router;
