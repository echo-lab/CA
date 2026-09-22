const BASE_URL = process.env.REACT_APP_API_BASE;
let sharedAudio = null;
let currentUrl = null;
let unlocked = false;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function revokeCurrentUrl() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export function getTtsAudioElement() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
    sharedAudio.preload = "auto";
    sharedAudio.addEventListener("ended", revokeCurrentUrl);
    sharedAudio.addEventListener("error", revokeCurrentUrl);
  }
  return sharedAudio;
}

// Silences whatever is currently speaking. The element is a module singleton
// (one voice at a time, and one element to keep unlocked for autoplay), which
// also means nothing about unmounting React stops it — callers leaving a page
// have to say so.
export function stopTts() {
  if (!sharedAudio) return;
  sharedAudio.pause();
  // Order is the point: detach the element from the blob BEFORE revoking.
  // Revoking while src still points at the URL strands the element on a dead
  // source and the next say() aborts mid-load. removeAttribute + load() is the
  // spec'd detach; it fires emptied/abort, not error, and does not re-lock
  // autoplay, so the gesture unlock survives.
  sharedAudio.removeAttribute("src");
  sharedAudio.load();
  revokeCurrentUrl();
}

export async function unlockTtsAudio() {
  if (unlocked) return true;
  const audio = getTtsAudioElement();
  try {
    audio.muted = true;
    audio.src = SILENT_WAV;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    unlocked = true;
    return true;
  } catch (err) {
    console.warn("TTS audio unlock failed:", err?.name || err);
    return false;
  }
}

export async function say({
  text,
  voiceName,
  emotion = "neutral",
  role = null,
}) {
  if (!BASE_URL) {
    throw new Error("REACT_APP_API_BASE not defined in .env.local");
  }
  if (!text || !text.trim()) throw new Error("Missing text");

  const res = await fetch(`${BASE_URL}/live/say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceName, emotion, role }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.message) msg += `: ${err.message}`;
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = getTtsAudioElement();

  revokeCurrentUrl();
  currentUrl = url;
  audio.muted = false;
  audio.src = url;

  try {
    await audio.play();
  } catch (err) {
    if (err?.name === "NotAllowedError") {
      console.warn(
        "TTS play() blocked by autoplay policy (element not unlocked by a user gesture)."
      );
    }
    revokeCurrentUrl();
    throw err;
  }

  return { audio, url };
}
