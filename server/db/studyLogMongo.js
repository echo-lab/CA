// server/db/studyLogMongo.js
// Saves study-log stream rows (events, transcript, questions) and session rows into MongoDB.
// Duplicates are rejected by the unique indexes created in mongo.js
// ({ session_id, event_seq }, { session_id, utt_seq }, { session_id, q_seq }, { session_id }).
//
// The routes in server/routes/studyLog.js call mirrorBatch / mirrorSession after their
// CSV writes. Mongo is a mirror: a Mongo failure is logged and never changes the response.
// POST /api/study-log/batch body is
// { sessionId, userId, streams: { events: [...], transcript: [...], questions: [...] } }.

const { getDb } = require('./mongo');

// One entry per stream: which collection, which field is the sequence number,
// and which fields should be stored as numbers / booleans instead of text.
// Field lists come from the client code (src/utils/studyLog.js, AudioStreamControl.js).
const STREAMS = {
  events: {
    collection: 'events',
    seqField: 'event_seq',
    numberFields: ['event_seq', 'timestamp', 'page_number', 'page_index', 'line_index', 'latency_ms', 'manual_interventions'],
    booleanFields: [],
  },
  transcript: {
    collection: 'transcript',
    seqField: 'utt_seq',
    numberFields: ['utt_seq', 'timestamp', 'dg_start', 'dg_duration', 'speaker', 'speaker_confidence', 'avg_confidence', 'page_number', 'line_index'],
    booleanFields: ['speech_final'], // client sends "true"/"false" strings
  },
  questions: {
    collection: 'questions',
    seqField: 'q_seq',
    numberFields: ['q_seq', 'timestamp', 'page_number', 'line_index'],
    booleanFields: [],
  },
};

// Session rows (POST /api/study-log/session), one document per session_id.
// Fields come from startSession / endSession in src/utils/studyLog.js.
const SESSION_SPEC = {
  collection: 'sessions',
  numberFields: ['started_at', 'ended_at', 'duration_ms', 'manual_interventions_total', 'pages_reached', 'schema_version'],
  booleanFields: ['is_training'], // client sends "true"/"false" strings
};

const DUPLICATE_KEY = 11000;

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

// Returns a number, or undefined if the value can't be read as one.
function toNumber(value) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : undefined;
}

// Returns true/false, or undefined if the value isn't clearly either.
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

// True when mongo.connect() has run. If the connect at server startup failed,
// mirrorBatch / mirrorSession skip the Mongo write instead of logging an error
// every 5 seconds.
function isMongoReady() {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

// Copies a row, leaving out empty values and converting the spec's number/boolean
// fields. A value that can't be converted is kept as the original text.
function convertFields(row, spec) {
  const doc = {};
  for (const [key, value] of Object.entries(row)) {
    if (isEmpty(value)) continue;

    if (spec.numberFields.includes(key)) {
      const n = toNumber(value);
      doc[key] = n === undefined ? value : n;
    } else if (spec.booleanFields.includes(key)) {
      const b = toBoolean(value);
      doc[key] = b === undefined ? value : b;
    } else {
      doc[key] = value;
    }
  }
  return doc;
}

// Turns raw browser rows into Mongo documents.
// - ids = { session_id, user_id }: the route's validated values. They overwrite the row's own.
// - Empty values are left out instead of stored as "".
// - Number/boolean fields are converted. A value that can't be converted is kept
//   as the original text so nothing is lost; check for these in analysis.
// - A row whose sequence number isn't a whole number >= 1 is rejected, because
//   the unique index can't protect it.
// Returns { docs, invalid } where invalid is the count of rejected rows.
function toDocs(rows, streamName, ids) {
  const spec = STREAMS[streamName];
  if (!spec) throw new Error(`Unknown stream: ${streamName}`);
  if (!Array.isArray(rows)) return { docs: [], invalid: 0 };

  const receivedAt = new Date();
  const docs = [];
  let invalid = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      invalid++;
      continue;
    }

    const doc = convertFields(row, spec);

    // Server-side stamps, overwriting anything the client sent.
    doc.session_id = ids.session_id;
    doc.user_id = ids.user_id;
    doc.received_at = receivedAt;

    const seq = doc[spec.seqField];
    if (!Number.isInteger(seq) || seq < 1) {
      invalid++;
      continue;
    }

    docs.push(doc);
  }

  return { docs, invalid };
}

// Inserts docs, treating duplicate-key errors as "already saved".
// Any other error is thrown so the caller can log it.
// Returns { inserted, duplicates }.
async function insertStream(collectionName, docs) {
  if (docs.length === 0) return { inserted: 0, duplicates: 0 };

  const collection = getDb().collection(collectionName);

  try {
    const result = await collection.insertMany(docs, { ordered: false });
    return { inserted: result.insertedCount, duplicates: 0 };
  } catch (err) {
    // Not a bulk write error (e.g. network problem): pass it on.
    if (!err.writeErrors) throw err;

    const writeErrors = [].concat(err.writeErrors);
    const other = writeErrors.filter((e) => e.code !== DUPLICATE_KEY);
    if (other.length > 0) throw err;

    const inserted = err.insertedCount ?? err.result?.insertedCount ?? docs.length - writeErrors.length;
    return { inserted, duplicates: writeErrors.length };
  }
}

// Saves every stream in one batch.
// sessionId, userId: the route's validated values (use resolved.userId, not the raw body value).
// streams: req.body.streams, i.e. { events: [...], transcript: [...], questions: [...] }.
// Returns e.g. { events: { inserted, duplicates, invalid }, transcript: {...}, questions: {...} }
async function saveBatchToMongo(sessionId, userId, streams) {
  const ids = { session_id: sessionId, user_id: userId };
  const summary = {};

  for (const [streamName, spec] of Object.entries(STREAMS)) {
    const { docs, invalid } = toDocs(streams?.[streamName], streamName, ids);
    const { inserted, duplicates } = await insertStream(spec.collection, docs);
    summary[streamName] = { inserted, duplicates, invalid };
  }

  return summary;
}

// Creates or updates the session's document. The start row has empty end fields and
// the end row fills them in; empty values are left out of $set, so a later row never
// blanks out a field an earlier row set.
// row: the route's validated row (session_id checked, user_id resolved).
async function saveSessionToMongo(row) {
  const doc = convertFields(row, SESSION_SPEC);
  doc.updated_at = new Date();

  await getDb()
    .collection(SESSION_SPEC.collection)
    .updateOne({ session_id: row.session_id }, { $set: doc }, { upsert: true });
}

// Entry points for the routes: fire-and-forget, so the route's CSV logic and
// response stay exactly as they were. Skipped when Mongo isn't connected.
function mirrorBatch(sessionId, userId, streams) {
  if (!isMongoReady()) return;
  saveBatchToMongo(sessionId, userId, streams).catch((err) => {
    console.error(`[mongo] batch save failed for ${sessionId}:`, err.message || err);
  });
}

function mirrorSession(row) {
  if (!isMongoReady()) return;
  saveSessionToMongo(row).catch((err) => {
    console.error(`[mongo] session save failed for ${row.session_id}:`, err.message || err);
  });
}

module.exports = {
  STREAMS, toDocs, insertStream, saveBatchToMongo, saveSessionToMongo,
  isMongoReady, mirrorBatch, mirrorSession,
};
