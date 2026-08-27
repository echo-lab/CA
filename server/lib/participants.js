const fs = require('fs');
const path = require('path');

// The roster is edited by hand (server/participants.json) — add a row per
// participant before their session. It is re-read whenever the file's mtime
// changes so new IDs go live without restarting the server.
//
// The file is gitignored: each deployment has its own real participant IDs and
// they should not travel through the repo. Copy participants.example.json to
// participants.json on a fresh checkout.
const ROSTER_PATH = path.join(__dirname, '..', 'participants.json');

let cache = { mtimeMs: -1, byId: new Map(), present: false };

// IDs are compared case- and whitespace-insensitively so "p001", "P001 " and
// "P001" are the same participant. The roster's own spelling is what gets
// logged, so the CSVs stay consistent regardless of what was typed.
function normalizeId(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().toUpperCase();
}

function loadRoster() {
    let stat;
    try {
        stat = fs.statSync(ROSTER_PATH);
    } catch (err) {
        cache = { mtimeMs: -1, byId: new Map(), present: false };
        return cache;
    }

    if (stat.mtimeMs === cache.mtimeMs) return cache;

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
    } catch (err) {
        console.warn(`[participants] failed to parse ${ROSTER_PATH}: ${err.message}`);
        // Keep serving the last good roster rather than locking everyone out
        // mid-study because of a stray comma.
        return cache;
    }

    if (!Array.isArray(parsed)) {
        console.warn('[participants] roster must be a JSON array; ignoring file');
        return cache;
    }

    const byId = new Map();
    for (const entry of parsed) {
        // Accept both "P001" and { user_id: "P001", ... } rows.
        const record = typeof entry === 'string' ? { user_id: entry } : entry;
        if (!record || typeof record !== 'object') continue;
        const key = normalizeId(record.user_id);
        if (!key) continue;
        if (byId.has(key)) {
            console.warn(`[participants] duplicate user_id "${record.user_id}" — keeping the first`);
            continue;
        }
        byId.set(key, { ...record, user_id: String(record.user_id).trim() });
    }

    cache = { mtimeMs: stat.mtimeMs, byId, present: true };
    console.log(`[participants] loaded ${byId.size} participant(s) from participants.json`);
    return cache;
}

// Returns the roster record for an id, or null. Callers get the roster's own
// spelling of user_id back and should log that rather than the raw input.
function lookup(userId) {
    const key = normalizeId(userId);
    if (!key) return null;
    return loadRoster().byId.get(key) || null;
}

// False when the roster file is missing or empty, in which case the log
// endpoints stay permissive so local development isn't blocked by setup.
function isEnforced() {
    const roster = loadRoster();
    return roster.present && roster.byId.size > 0;
}

// Each participant's logs live in their own folder under server/logs/.
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// The id reaches path.join, so anything that could escape the directory is
// replaced rather than trusted, even though ids normally come from the roster.
function participantDirName(userId) {
    const cleaned = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    return cleaned || '_unknown';
}

function participantDir(userId) {
    return path.join(LOGS_DIR, participantDirName(userId));
}

// Creates the participant's log folder if it does not exist yet. Called when a
// participant is verified and again when their session starts, so the folder is
// in place before any rows are written rather than appearing only once the
// first batch happens to flush.
function ensureParticipantDir(userId) {
    const dir = participantDir(userId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[participants] created log folder ${participantDirName(userId)}/`);
    }
    return dir;
}

// Walks logs/ and returns every file whose basename passes `matches`, across
// all participant folders (plus any left at the top level by older versions).
// Sorted by full path, so a participant's files stay contiguous.
function collectLogFiles(matches) {
    if (!fs.existsSync(LOGS_DIR)) return [];
    const found = [];

    for (const entry of fs.readdirSync(LOGS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const dir = path.join(LOGS_DIR, entry.name);
            for (const name of fs.readdirSync(dir)) {
                if (matches(name)) found.push(path.join(dir, name));
            }
        } else if (matches(entry.name)) {
            found.push(path.join(LOGS_DIR, entry.name));
        }
    }
    return found.sort();
}

// Narrows a collectLogFiles result to one participant's folder. Accepts any
// spelling of the id the roster recognizes.
function filterToParticipant(files, participant) {
    const canonical = lookup(participant)?.user_id ?? participant;
    const dir = (participantDir(canonical) + path.sep).toLowerCase();
    return files.filter((f) => f.toLowerCase().startsWith(dir));
}

// --- roster writes (admin only) -------------------------------------------
// loadRoster() returns a normalized Map for lookups; these two work on the raw
// array so hand-written fields survive a round trip. Every write is atomic and
// bumps mtime, which is what makes loadRoster pick the change up with no restart.
function readRoster() {
    try {
        const parsed = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;   // a malformed roster must not be silently overwritten
    }
}

function writeRoster(rows) {
    // One record per line, matching how the file is written by hand — an admin
    // edit should not reflow every row and bury the real change in a diff.
    const body = rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n');
    const tmp = `${ROSTER_PATH}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `[\n${body}\n]\n`);
    fs.renameSync(tmp, ROSTER_PATH);
}

module.exports = {
    lookup,
    isEnforced,
    normalizeId,
    readRoster,
    writeRoster,
    LOGS_DIR,
    participantDirName,
    participantDir,
    ensureParticipantDir,
    collectLogFiles,
    filterToParticipant,
};
