// Checks the MongoDB-backed roster and study log against a local mongod, in a throwaway database.
// Run: node test_db.js   (needs mongod on 127.0.0.1:27017; uses MONGODB_DB=jennie_test)
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = 'jennie_test';
// routes/studyLog reads model names from lib/openai, which builds a client at load; no API call is made.
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-placeholder';
const assert = require('assert');
const express = require('express');

const { db, client, connect } = require('./lib/db');
const participants = require('./lib/participants');

async function serve() {
    // Fresh copies of the routers, as after a server restart: no state carries over except the DB.
    for (const k of Object.keys(require.cache)) if (/routes[\\/](studyLog|logging)\.js$/.test(k)) delete require.cache[k];
    const app = express();
    app.use(express.json());
    app.use(require('./routes/studyLog'));
    app.use(require('./routes/logging'));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, body: await r.json() }));
    return { base, post, close: () => server.close() };
}
const events = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ event_seq: from + i, event_type: 'line_change', speaker_confidence: 0.9 }));

(async () => {
    await db.dropDatabase().catch(() => {});
    await connect();
    let ok = 0;
    const check = (cond, msg) => { assert.ok(cond, msg); ok++; };

    // Roster: case/whitespace-insensitive, roster spelling wins, duplicates rejected.
    await participants.add({ user_id: 'T001', child: 'Kid' });
    check((await participants.lookup(' t001 '))?.user_id === 'T001', 'lookup ignores case and spaces');
    await assert.rejects(participants.add({ user_id: 't001' }), (e) => e.code === 11000); ok++;
    check(await participants.isEnforced(), 'roster with a row is enforced');

    let srv = await serve();
    check((await fetch(`${srv.base}/api/participants/t001`)).status === 200, 'participant lookup route finds t001');
    check((await fetch(`${srv.base}/api/participants/nobody`)).status === 404, 'unknown participant is 404');
    check((await srv.post('/api/study-log/batch', { sessionId: 's1', userId: 'X9', streams: { events: events(1, 1) } })).status === 400, 'unknown id rejected');

    // A batch retried after a lost response is stored once.
    let r = await srv.post('/api/study-log/batch', { sessionId: 's1', userId: 't001', streams: { events: events(1, 3) } });
    check(r.status === 200 && r.body.counts.events === 3, 'first batch stores 3');
    r = await srv.post('/api/study-log/batch', { sessionId: 's1', userId: 't001', streams: { events: events(1, 3) } });
    check(r.status === 200 && r.body.counts.events === 0, 'retried batch stores 0');

    // Dedupe survives a server restart (the old in-memory watermark did not).
    srv.close();
    srv = await serve();
    r = await srv.post('/api/study-log/batch', { sessionId: 's1', userId: 'T001', streams: { events: events(2, 5) } });
    check(r.body.counts.events === 2, 'after restart only seq 4-5 are new');
    check(await db.collection('events').countDocuments({ user_id: 'T001', session_id: 's1' }) === 5, '5 events stored in total');
    const stored = await db.collection('events').findOne({ event_seq: 1 });
    check(stored.speaker_confidence === 0.9 && stored.user_id === 'T001', 'whole row kept, roster spelling logged');

    // Session row: start then end upsert one document; a late start can't blank ended_at.
    const start = { session_id: 's1', user_id: 't001', book_id: '1', started_at: 1000, ended_at: '', question_voice: 'Aoede' };
    check((await srv.post('/api/study-log/session', { session: start })).body.outcome === 'created', 'start creates');
    check((await srv.post('/api/study-log/session', { session: { ...start, ended_at: 2000, pages_reached: 4 } })).body.outcome === 'updated', 'end updates');
    await srv.post('/api/study-log/session', { session: start });
    const sessions = await db.collection('sessions').find({ session_id: 's1' }).toArray();
    check(sessions.length === 1 && sessions[0].ended_at === 2000, 'one session, ended_at kept');
    check(sessions[0].run_settings?.prompt_version && sessions[0].run_settings.question_voice === 'Aoede', 'run_settings stamped');

    // DB unavailable -> 503 so the client requeues.
    await client.close();
    r = await srv.post('/api/study-log/batch', { sessionId: 's1', userId: 'T001', streams: { events: events(6, 6) } });
    check(r.status === 503, 'batch is 503 when the DB is down');
    srv.close();

    await client.connect();
    await db.dropDatabase();
    await client.close();
    console.log(`db: ${ok}/${ok} OK`);
})().catch(async (err) => {
    console.error(err);
    await client.close().catch(() => {});
    process.exit(1);
});
