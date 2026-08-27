// Shared-token auth for the admin routes.
//
// One token in server/.env.local (ADMIN_TOKEN), sent as `x-admin-token` or as a
// bearer token. Not a user system: this guards a single researcher's admin page,
// and the study data behind it, on a host that is otherwise open to the internet.
const crypto = require('crypto');

function configuredToken() {
    // Read per-request rather than at import: the server is often started before
    // .env.local is finished, and a stale empty value would lock the page out.
    return String(process.env.ADMIN_TOKEN || '');
}

// Length is compared first because timingSafeEqual throws on a mismatch. Length
// leaks, the token does not.
function tokensMatch(supplied, expected) {
    const a = Buffer.from(String(supplied));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
    const expected = configuredToken();
    // Fail closed. An unset token must never mean "let everyone in" — this
    // endpoint can read participant data and edit the roster.
    if (!expected) {
        console.warn('[admin] refused: ADMIN_TOKEN is not set');
        return res.status(503).json({ message: 'Admin API is disabled: ADMIN_TOKEN is not set on the server.' });
    }
    const supplied = req.get('x-admin-token')
        || String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!supplied || !tokensMatch(supplied, expected)) {
        return res.status(401).json({ message: 'Invalid or missing admin token.' });
    }
    return next();
}

module.exports = { requireAdmin };
