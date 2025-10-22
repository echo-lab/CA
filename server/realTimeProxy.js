// import express from "express";

// const app = express();

// // Parse raw SDP payloads posted from the browser
// app.use(express.text({ type: ["application/sdp", "text/plain"] }));

// const sessionConfig = JSON.stringify({
//     type: "realtime",
//     model: "gpt-realtime",
//     audio: { output: { voice: "marin" } }
// });

// // ============================================================================
// // API endpoints
// // ============================================================================
// app.get("/api/realtime-token", async (req, res) => {
//     try {
//         console.log("Fetching realtime token from OpenAI...");
//         const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
//             method: "POST",
//             headers: {
//                 Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//                 "Content-Type": "application/json",
//             },
//             body: JSON.stringify({
//                 session: {
//                     type: "realtime",
//                     model: "gpt-realtime",    // or "gpt-4o-realtime-preview-2024-12-17" etc.
//                     audio: {
//                         output: {
//                             voice: "marin",            // any supported voice
//                         },
//                     },
//                 }
//             })
//         });
        
//         if (!r.ok) {
//             const errorText = await r.text();
//             console.error(`OpenAI error (${r.status}):`, errorText);
//             return res.status(r.status).json({ 
//                 error: "Failed to generate token", 
//                 detail: errorText 
//             });
//         }
        
//         // Return the full JSON response from OpenAI
//         const tokenData = await r.json();
//         res.json(tokenData);
//     } catch (error) {
//         console.error("Token generation error:", error);
//         res.status(500).json({ error: "Request failed", detail: error.message });
//     }
// });

// app.listen(3000);