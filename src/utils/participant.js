// Participant identity for the study.
//
// IDs are provisioned by hand in server/participants.json — nothing here ever
// creates one. The ID reaches the app either by being typed at /Signup or via a
// ?pid=<id> query param on any route, is verified against the server, and is
// then held in sessionStorage.
//
// sessionStorage (not localStorage) is deliberate: a shared study iPad must not
// carry participant A's ID into participant B's session after a tab close.

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5001";

const STORAGE_KEY = "jennie.participant";

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch (err) {
    // Safari private mode throws on access rather than returning null.
    return null;
  }
}

// The verified participant record ({ user_id, ... }) or null.
export function getParticipant() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.user_id ? parsed : null;
  } catch (err) {
    return null;
  }
}

export function getParticipantId() {
  return getParticipant()?.user_id || "";
}

export function setParticipant(record) {
  const storage = getStorage();
  if (!storage || !record?.user_id) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn("[participant] could not persist:", err?.message || err);
  }
}

export function clearParticipant() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (err) {
    /* nothing useful to do */
  }
}

// Reads ?pid=<id> from the current URL. Lets a session be started from a
// handed-out link with no typing — the lower-risk path with young children on
// a shared tablet.
export function getPidFromUrl() {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("pid")?.trim() || "";
  } catch (err) {
    return "";
  }
}

// Resolves to the roster record, or throws with a message fit to show a user.
export async function verifyParticipant(id) {
  const trimmed = String(id || "").trim();
  if (!trimmed) throw new Error("Please enter a participant ID.");

  let res;
  try {
    res = await fetch(`${API_BASE}/api/participants/${encodeURIComponent(trimmed)}`);
  } catch (err) {
    throw new Error("Could not reach the server. Check the connection and try again.");
  }

  if (res.status === 404) {
    throw new Error(`"${trimmed}" is not a registered participant ID.`);
  }
  if (!res.ok) {
    throw new Error(`Verification failed (${res.status}). Try again.`);
  }

  const data = await res.json();
  if (!data?.participant?.user_id) {
    throw new Error("Server returned an unexpected response.");
  }
  return data.participant;
}

// Verify + persist a ?pid= value if one is present and no participant is set
// yet. Returns the active record (existing or newly resolved), or null.
export async function resolveParticipantFromUrl() {
  const existing = getParticipant();
  const pid = getPidFromUrl();
  if (!pid) return existing;
  if (existing && existing.user_id.toUpperCase() === pid.toUpperCase()) return existing;

  const record = await verifyParticipant(pid);
  setParticipant(record);
  return record;
}
