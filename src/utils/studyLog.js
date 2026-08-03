import { getParticipantId } from "./participant";

const API_BASE =
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
  "http://localhost:5001";

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_ROWS = 25;
const MAX_REQUEUED_ROWS = 2000;
const KEEPALIVE_BUDGET_BYTES = 50 * 1024;

const STREAMS = ["events", "transcript", "questions"];
const SEQ_FIELD = { events: "event_seq", transcript: "utt_seq", questions: "q_seq" };

let sessionId = "";
let bookId = "";
let buffers = { events: [], transcript: [], questions: [] };
let seqs = { events: 0, transcript: 0, questions: 0 };
let context = {};
let manualInterventions = 0;
let flushTimer = null;
let sessionMeta = null;
let inFlight = false;

export const state = { lastError: null, lastFlushAt: null };

function now() {
  return Date.now();
}

function userId() {
  return getParticipantId() || "";
}

function mintSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

export function setContext(patch) {
  if (patch && typeof patch === "object") context = { ...context, ...patch };
}

function push(stream, row) {
  if (!STREAMS.includes(stream)) return;
  seqs[stream] += 1;
  buffers[stream].push({
    ...row,
    [SEQ_FIELD[stream]]: seqs[stream],
    session_id: sessionId,
    user_id: userId(),
    book_id: row.book_id ?? bookId,
    timestamp: row.timestamp ?? now(),
  });
  if (buffers[stream].length >= FLUSH_AT_ROWS) flush();
}

function toPageNumber(pageIndex) {
  return Number.isInteger(pageIndex) ? pageIndex + 1 : "";
}

function toLineIndex(lineIndex) {
  if (!Number.isInteger(lineIndex) || lineIndex < 1) return "";
  return lineIndex;
}

export function pushEvent(row) {
  push("events", {
    ...row,
    role: row.role ?? "",
    manual_interventions: row.manual_interventions ?? manualInterventions,
    page_number: row.page_number ?? toPageNumber(row.page_index ?? context.page_index),
    line_index: toLineIndex(row.line_index ?? context.line_index),
  });
}

export function pushTranscript(row) {
  push("transcript", {
    ...row,
    page_number: toPageNumber(context.page_index),
    line_index: toLineIndex(context.line_index),
    expected_character: context.expected_character ?? "",
    expected_role: context.expected_role ?? "",
    expected_role_kind: context.expected_role_kind ?? "",
  });
}

export function pushQuestion(row) {
  push("questions", {
    ...row,
    page_number: row.page_number ?? toPageNumber(row.page_index ?? context.page_index),
    line_index: toLineIndex(row.line_index ?? context.line_index),
  });
}

let lastDecisionAt = null;

// Marks the instant the app decided to auto-advance, so the resulting page_turn can report how long the turn actually took. 
export function noteAiDecision() {
  lastDecisionAt = now();
}

// One-shot read: a decision times exactly one page turn.
export function consumeDecisionLatency() {
  if (lastDecisionAt === null) return "";
  const latency = now() - lastDecisionAt;
  lastDecisionAt = null;
  return latency;
}

// Returns the new total so callers can attach it to the event they are logging.
export function noteManualIntervention(source) {
  manualInterventions += 1;
  pushEvent({
    event_type: "manual_intervention",
    intervention_source: source || "",
    manual_interventions: manualInterventions,
  });
  return manualInterventions;
}

function totalBuffered() {
  return STREAMS.reduce((n, s) => n + buffers[s].length, 0);
}

// Puts rejected rows back at the FRONT so seq order is preserved on retry.
function requeue(snapshot) {
  for (const stream of STREAMS) {
    if (!snapshot[stream]?.length) continue;
    buffers[stream] = [...snapshot[stream], ...buffers[stream]];
    const overflow = buffers[stream].length - MAX_REQUEUED_ROWS;
    if (overflow > 0) {
      buffers[stream] = buffers[stream].slice(overflow);
      console.error(`[studyLog] dropped ${overflow} buffered ${stream} rows (retry cap)`);
    }
  }
}

function trimForKeepalive(snapshot) {
  let bytes = JSON.stringify(snapshot).length;
  if (bytes <= KEEPALIVE_BUDGET_BYTES) return snapshot;

  const trimmed = { events: [], transcript: [], questions: [] };
  const leftover = { events: [], transcript: [], questions: [] };
  bytes = 0;
  // Events first — they are the smallest rows and the most load-bearing.
  for (const stream of ["events", "questions", "transcript"]) {
    for (const row of snapshot[stream]) {
      const size = JSON.stringify(row).length;
      if (bytes + size > KEEPALIVE_BUDGET_BYTES) leftover[stream].push(row);
      else {
        trimmed[stream].push(row);
        bytes += size;
      }
    }
  }
  requeue(leftover);
  return trimmed;
}

export async function flush({ keepalive = false } = {}) {
  if (!sessionId) return;
  if (inFlight && !keepalive) return;
  if (totalBuffered() === 0) return;

  let snapshot = {
    events: buffers.events,
    transcript: buffers.transcript,
    questions: buffers.questions,
  };
  buffers = { events: [], transcript: [], questions: [] };
  if (keepalive) snapshot = trimForKeepalive(snapshot);
  if (STREAMS.every((s) => snapshot[s].length === 0)) return;

  inFlight = true;
  try {
    const res = await fetch(`${API_BASE}/api/study-log/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, userId: userId(), streams: snapshot }),
      keepalive,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[studyLog] batch rejected ${res.status}:`, body);
      state.lastError = { status: res.status, body, at: now() };
      requeue(snapshot);
      return;
    }
    state.lastError = null;
    state.lastFlushAt = now();
  } catch (err) {
    console.warn("[studyLog] flush failed:", err?.message || err);
    state.lastError = { status: 0, body: String(err?.message || err), at: now() };
    requeue(snapshot);
  } finally {
    inFlight = false;
  }
}

async function postSessionRow(extra) {
  if (!sessionMeta) return;
  const session = { ...sessionMeta, ...extra, user_id: userId() };
  try {
    const res = await fetch(`${API_BASE}/api/study-log/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
      keepalive: Boolean(extra?.ended_at),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[studyLog] session row rejected ${res.status}:`, body);
      state.lastError = { status: res.status, body, at: now() };
    }
  } catch (err) {
    console.warn("[studyLog] session row failed:", err?.message || err);
  }
}

// characterRoles is the selectedOptions array from CharacterSelecter.
function encodeRoles(characterRoles) {
  const list = Array.isArray(characterRoles) ? characterRoles : [];
  const row = {};
  list.slice(0, 3).forEach((entry, i) => {
    const n = i + 1;
    row[`character_${n}_name`] = entry?.Character ?? "";
    row[`character_${n}_role`] = entry?.role ?? "";
  });
  return row;
}

export function startSession({ bookId: book, bookName, isTraining, characterRoles } = {}) {
  sessionId = mintSessionId();
  bookId = book === null || book === undefined ? "" : String(book);
  buffers = { events: [], transcript: [], questions: [] };
  seqs = { events: 0, transcript: 0, questions: 0 };
  manualInterventions = 0;
  context = {};
  state.lastError = null;

  sessionMeta = {
    session_id: sessionId,
    user_id: userId(),
    book_id: bookId,
    book_name: bookName ?? "",
    is_training: isTraining ? "true" : "false",
    started_at: now(),
    ended_at: "",
    duration_ms: "",
    manual_interventions_total: "",
    pages_reached: "",
    ...encodeRoles(characterRoles),
  };

  postSessionRow();
  pushEvent({ event_type: "session_start" });

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  return sessionId;
}

export function endSession({ pagesReached } = {}) {
  if (!sessionId) return;
  pushEvent({ event_type: "session_end" });

  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  postSessionRow({
    ended_at: now(),
    duration_ms: now() - (sessionMeta?.started_at ?? now()),
    manual_interventions_total: manualInterventions,
    pages_reached: pagesReached ?? context.page_index ?? "",
  });
  flush({ keepalive: true });
}

if (typeof window !== "undefined") {
  window.jennieStudyLog = {
    flush,
    get buffers() { return buffers; },
    get state() { return state; },
    get sessionId() { return sessionId; },
    get context() { return context; },
    get manualInterventions() { return manualInterventions; },
  };
}
