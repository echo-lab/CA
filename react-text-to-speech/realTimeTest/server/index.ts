import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load environment variables from parent folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const env_path = path.resolve(__dirname, "../.env");
dotenv.config({ path: env_path });

const app = express();
app.use(cors());
app.use(express.json());

// IMPORTANT: never ship your real API key to the client.
// This endpoint trades your server API key for a short‑lived client secret.
// See: POST https://api.openai.com/v1/realtime/client_secrets
// Model: use "gpt-realtime" (GA) or a specific snapshot.

app.get("/api/realtime-token", async (_req, res) => {
  try {
    // Avoid logging the raw key; just indicate presence for debugging.
    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",    // or "gpt-4o-realtime-preview-2024-12-17" etc.
          audio: {
            output: {
              voice: "marin",            // any supported voice
            },
          },
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({ error: `OpenAI error: ${errText}` });
    }

    const json = await r.json();
    // Returns { client_secret: { value: "ek_...", expires_at: ... }, ... }
    res.json(json);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Auth server up on http://localhost:${PORT}`));