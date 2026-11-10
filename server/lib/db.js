const { MongoClient } = require('mongodb');

// 5s, not the driver's 30s default: with the DB down a request should 503 quickly so the client requeues.
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 });
const db = client.db(process.env.MONGODB_DB || 'jennie');

// The unique indexes are what dedupe retried log batches, so the server must not serve without them.
async function connect() {
    await client.connect();
    await Promise.all([
        db.collection('sessions').createIndex({ user_id: 1, session_id: 1 }, { unique: true }),
        db.collection('events').createIndex({ user_id: 1, session_id: 1, event_seq: 1 }, { unique: true }),
        db.collection('transcript').createIndex({ user_id: 1, session_id: 1, utt_seq: 1 }, { unique: true }),
        db.collection('questions').createIndex({ user_id: 1, session_id: 1, q_seq: 1 }, { unique: true }),
        db.collection('image_tags').createIndex({ book: 1, page: 1, model: 1, version: 1, page_text_hash: 1 }, { unique: true }),
        db.collection('legacy_events').createIndex({ source_file: 1, row: 1 }, { unique: true }),
    ]);
    console.log(`[db] connected to ${db.databaseName}`);
}

module.exports = { db, client, connect };
