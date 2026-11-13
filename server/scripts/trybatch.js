// server/scripts/tryBatch.js
// Sends the same batch to Mongo twice to check duplicate handling.
// Run from the server folder:  node scripts/tryBatch.js
// (mongo.js loads .env.local itself, so no --env-file flag is needed.)
//
// Expected:
//   run 1 -> events inserted 3, transcript 2, questions 1, all invalid 0
//   run 2 -> inserted 0, duplicates 3 / 2 / 1
// Run the script again (fresh process = like a server restart): still all duplicates.
// That's the P6 fix: the duplicate check lives in the database, not in server memory.

const mongo = require('../db/mongo');
const { saveBatchToMongo } = require('../db/studyLogMongo');

// Same shape the client sends: src/utils/studyLog.js flush() ->
// { sessionId, userId, streams: { events, transcript, questions } }
const now = Date.now();
const body = {
  sessionId: 'test-tryBatch-0001',
  userId: 'T001',
  streams: {
    events: [
      { event_seq: 1, event_type: 'session_start', timestamp: now, page_number: 1, line_index: '', role: '', manual_interventions: 0, book_id: '1' },
      { event_seq: 2, event_type: 'page_turn', timestamp: now + 5000, page_index: 1, page_number: 2, line_index: '', direction: 'forward', trigger: 'manual', latency_ms: '', manual_interventions: 1, role: '', book_id: '1' },
      { event_seq: 3, event_type: 'session_end', timestamp: now + 9000, page_number: 2, line_index: '', role: '', manual_interventions: 1, book_id: '1' },
    ],
    transcript: [
      { utt_seq: 1, timestamp: now + 2000, dg_start: 1.2, dg_duration: 0.8, speaker: 0, speaker_confidence: 0.7, speech_final: 'true', transcript: 'Hello, "Clara"\nhow are you', avg_confidence: 0.92, page_number: 1, line_index: '', book_id: '1' },
      { utt_seq: 2, timestamp: now + 3000, dg_start: '', dg_duration: '', speaker: '', speech_final: 'false', transcript: 'I am fine', avg_confidence: '', page_number: 1, line_index: '', book_id: '1' },
    ],
    questions: [
      { q_seq: 1, timestamp: now + 6000, question_id: 'q1', question_type: 'generated', event: 'generated', question_text: 'What color was the balloon?', expected_answer: '', page_number: 2, line_index: '', book_id: '1' },
    ],
  },
};

async function main() {
  await mongo.connect(); // also creates the indexes

  const { sessionId, userId, streams } = body;
  console.log('run 1:', JSON.stringify(await saveBatchToMongo(sessionId, userId, streams)));
  console.log('run 2:', JSON.stringify(await saveBatchToMongo(sessionId, userId, streams)));

  const sample = await mongo.getDb().collection('transcript').findOne({ session_id: sessionId, utt_seq: 1 });
  console.log('stored doc:', sample);
  console.log('types:', { utt_seq: typeof sample.utt_seq, speech_final: typeof sample.speech_final, speaker: typeof sample.speaker });

  // Uncomment to delete the test rows so run 1 inserts again:
  // for (const c of ['events', 'transcript', 'questions']) await mongo.getDb().collection(c).deleteMany({ session_id: sessionId });

  await mongo.close();
}

main().catch(async (err) => {
  console.error(err);
  await mongo.close();
  process.exit(1);
});
