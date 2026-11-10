// One-time import of the file-based study data into MongoDB. Safe to re-run: the same unique
// indexes the live routes use skip anything already imported, and nothing on disk is deleted.
//   cd server && node scripts/import-logs.js
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(SERVER, '.env.local') });
const { db, client, connect } = require('../lib/db');
const { normalizeId } = require('../lib/participants');

const LOGS = path.join(SERVER, 'logs');
const SEQ_FIELD = { events: 'event_seq', transcript: 'utt_seq', questions: 'q_seq' };
// Ids that look numeric (e.g. session 1109142417) must stay strings to match live data.
const KEEP_STRING = new Set(['session_id', 'user_id', 'book_id', 'question_id']);

// Fields may contain commas, escaped quotes, and newlines (transcript text, JSON columns).
function parseCsv(text) {
    const records = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; }
                else quoted = false;
            } else field += c;
            continue;
        }
        if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }
    return records.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

// Rows keyed by header name, numeric-looking cells as Numbers.
function readRows(file) {
    const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
    if (!header) return [];
    return rows.map((cells) => Object.fromEntries(header.map((h, i) => {
        const v = cells[i] ?? '';
        return [h, !KEEP_STRING.has(h) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v];
    })));
}

const counts = {};
const tally = (name, inserted, skipped) => {
    counts[name] = counts[name] || { inserted: 0, skipped: 0 };
    counts[name].inserted += inserted;
    counts[name].skipped += skipped;
};

// insertMany that treats duplicate keys as "already imported".
async function insertAll(name, docs) {
    if (!docs.length) return;
    try {
        tally(name, (await db.collection(name).insertMany(docs, { ordered: false })).insertedCount, 0);
    } catch (err) {
        const writeErrors = [].concat(err.writeErrors || []);
        if (!writeErrors.length || !writeErrors.every((e) => e.code === 11000)) throw err;
        const inserted = err.insertedCount ?? err.result?.insertedCount ?? 0;
        tally(name, inserted, docs.length - inserted);
    }
}

async function upsertNew(name, filter, doc) {
    const r = await db.collection(name).updateOne(filter, { $setOnInsert: doc }, { upsert: true });
    tally(name, r.upsertedCount, r.upsertedCount ? 0 : 1);
}

const participantDirs = () => (fs.existsSync(LOGS) ? fs.readdirSync(LOGS, { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory()).map((e) => path.join(LOGS, e.name));

async function importUsers() {
    const file = path.join(SERVER, 'participants.json');
    if (!fs.existsSync(file)) return;
    for (const entry of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        // Accept both "P001" and { user_id: "P001", ... } rows, as the old roster loader did.
        const record = typeof entry === 'string' ? { user_id: entry } : entry;
        const key = normalizeId(record?.user_id);
        if (!key) continue;
        await upsertNew('users', { _id: key }, { ...record, user_id: String(record.user_id).trim(), created_at: new Date() });
    }
}

async function importSessions() {
    const files = participantDirs().map((d) => path.join(d, 'sessions.csv'))
        .concat(path.join(SERVER, 'sessions.csv.migrated'))
        .filter((f) => fs.existsSync(f));
    for (const file of files) {
        for (const row of readRows(file)) {
            if (!row.session_id || !row.user_id) continue;
            // Empty cells are skipped, as the live route does.
            const doc = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ''));
            await upsertNew('sessions', { user_id: row.user_id, session_id: row.session_id },
                { ...doc, imported_from: path.relative(SERVER, file), created_at: new Date() });
        }
    }
}

async function importStreams() {
    for (const dir of participantDirs()) {
        for (const name of fs.readdirSync(dir)) {
            const m = name.match(/^session_(.+)_(events|transcript|questions)\.csv$/);
            if (!m) continue;
            const [, sessionId, stream] = m;
            const seqField = SEQ_FIELD[stream];
            const docs = readRows(path.join(dir, name))
                .filter((r) => Number.isFinite(Number(r[seqField])) && r[seqField] !== '')
                .map((r) => ({ ...r, [seqField]: Number(r[seqField]), session_id: String(r.session_id || sessionId) }));
            await insertAll(stream, docs);
        }
    }
}

async function importLegacy() {
    if (!fs.existsSync(LOGS)) return;
    for (const name of fs.readdirSync(LOGS).filter((n) => /^session_\d+\.csv$/.test(n)).sort()) {
        const source = `logs/${name}`;
        await insertAll('legacy_events', readRows(path.join(LOGS, name)).map((r, i) => ({ ...r, source_file: source, row: i })));
    }
    const setupLog = path.join(SERVER, 'session-log.csv');
    if (fs.existsSync(setupLog)) {
        await insertAll('legacy_events', readRows(setupLog).map((r, i) => ({ ...r, source_file: 'session-log.csv', row: i })));
    }
}

// Old tag files carry no version/model/page-text key, so they are archived under version 'legacy'
// and never match a live read (each page re-tags once).
async function importImageTags() {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const dir = path.join(SERVER, 'cache', 'image');
    if (!fs.existsSync(dir)) return;
    for (const file of walk(dir).filter((f) => f.endsWith('.json'))) {
        const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(entry?.data?.tags)) continue;
        await upsertNew('image_tags',
            { book: String(entry.book), page: String(entry.page), model: 'gemini-2.5-flash', version: 'legacy', page_text_hash: null },
            { tags: entry.data.tags, created_at: new Date(entry.createdAt || Date.now()), imported_from: path.relative(SERVER, file) });
    }
}

(async () => {
    await connect();
    await importUsers();
    await importSessions();
    await importStreams();
    await importLegacy();
    await importImageTags();
    console.table(counts);
})()
    .catch((err) => { console.error('import failed:', err); process.exitCode = 1; })
    .finally(() => client.close());
