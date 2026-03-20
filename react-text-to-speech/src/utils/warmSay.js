const BASE_URL = process.env.REACT_APP_API_BASE;

export async function warmSay({ text, voiceName, emotion = "neutral", role = null }) {
  try {
    if (!BASE_URL || !text?.trim() || !voiceName) return;

    const res = await fetch(`${BASE_URL}/live/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceName, emotion, role }),
    });

    // Drain and discard so HTTP connection can be reused
    if (res.ok) {
      try { await res.arrayBuffer(); } catch {}
    }
  } catch (err) {
    console.warn("warmSay failed:", err);
  }
}