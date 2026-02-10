const BASE_URL = process.env.REACT_APP_API_BASE;

export async function say({
  text,
  voiceName,
  emotion = "neutral",
}) {
  if (!BASE_URL) {
    throw new Error("REACT_APP_TTSURL not defined in .env.local");
  }
  if (!text || !text.trim()) throw new Error("Missing text");

  const res = await fetch(`${BASE_URL}/live/say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceName, emotion }),
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
  const audio = new Audio(url);

  // Cleanup URL after playback
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));

  await audio.play();
  return { audio, url };
}