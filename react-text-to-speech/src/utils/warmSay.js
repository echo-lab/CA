const BASE_URL = process.env.REACT_APP_API_BASE;

export async function warmSay({ text, voiceName, emotion = "neutral" }) {
  try {
    if (!BASE_URL || !text?.trim() || !voiceName) return;

    const res = await fetch(`${BASE_URL}/live/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceName, emotion }),
    });

    // Drain and discard so HTTP connection can be reused
    if (res.ok) {
      try { await res.arrayBuffer(); } catch {}
    }
  } catch (err) {
    console.warn("warmSay failed:", err);
  }
}