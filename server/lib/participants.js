const { db } = require('./db');

// The participant roster lives in the `users` collection, keyed by the normalized id.
const users = db.collection('users');

// IDs match case/whitespace-insensitively; the roster's spelling is what gets logged.
function normalizeId(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().toUpperCase();
}

// Returns the roster record for an id, or null. Callers get the roster's own
// spelling of user_id back and should log that rather than the raw input.
async function lookup(userId) {
    const key = normalizeId(userId);
    if (!key) return null;
    return users.findOne({ _id: key }, { projection: { _id: 0 } });
}

// False when the roster is empty, in which case the log endpoints stay
// permissive so local development isn't blocked by setup.
async function isEnforced() {
    return (await users.estimatedDocumentCount()) > 0;
}

async function list() {
    return users.find({}, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
}

// Rejects with code 11000 when the id already exists in any spelling.
async function add(record) {
    const userId = String(record.user_id).trim();
    const doc = { ...record, user_id: userId, created_at: new Date(), _id: normalizeId(userId) };
    await users.insertOne(doc);
    const { _id, ...stored } = doc;
    return stored;
}

// Returns how many rows were removed (0 or 1). Logged data is never touched.
async function remove(userId) {
    return (await users.deleteOne({ _id: normalizeId(userId) })).deletedCount;
}

module.exports = { normalizeId, lookup, isEnforced, list, add, remove };
