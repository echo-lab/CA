require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

let client;
let db;

async function connect() {
  if (db) return db;
  // defaulted to name in MONGODB_URI:..../name
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  // returns a handle for the databse
  // a handle lets you interact with the database
  db = client.db();
  await ensureIndexes();
  console.log(`[mongo] connected to ${db.databaseName}`);
  return db;
}

function getDb() {
  if (!db) throw new Error("Mongo not connected - call connect() first");
  return db;
}

async function ensureIndexes() {
  // a collection is a set of documents
  // a document is a set of key: values pair
  // an index is like unique index in SQL
  // an index can be compound
  await db
    .collection("sessions")
    .createIndex({ session_id: 1 }, { unique: true });
  await db
    .collection("events")
    .createIndex({ session_id: 1, event_seq: 1 }, { unique: true });
  await db
    .collection("transcript")
    .createIndex({ session_id: 1, utt_seq: 1 }, { unique: true });
  await db
    .collection("questions")
    .createIndex({ session_id: 1, q_seq: 1 }, { unique: true });

  for (const name of ["sessions", "events", "transcript", "questions"]) {
    await db.collection(name).createIndex({ user_id: 1 });
  }
}

async function close() {
  if (client) await client.close();
}

module.exports = { connect, getDb, close };
