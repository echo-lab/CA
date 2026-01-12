import { useRef, useState } from "react";

export default function App() {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  function pushLog(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 200));
  }

  async function start() {
    try {
      pushLog("Starting connection…");
      // 1) Ask your server for a short‑lived client token
      const tokenResp = await fetch("/api/realtime-token");
      let tokenJson: any;
      try {
        tokenJson = await tokenResp.json();
      } catch (jsonErr) {
        throw new Error("Failed to parse JSON from /api/realtime-token");
      }
      console.log(tokenJson);
      const clientSecret = tokenJson?.value;
      if (!clientSecret) throw new Error("No client secret returned");

      // 2) Build a peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3) Play remote audio
      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {/* autoplay block */});
        }
      };

      // 4) Create a data channel for text events
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      dc.onopen = () => pushLog("DataChannel opened");
      dc.onmessage = (evt) => {
        // Model emits JSON events and text deltas; show raw for simplicity.
        pushLog(`EVENT: ${evt.data}`);
      };

      // 5) Get mic and send it to the model
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = ms;
      ms.getAudioTracks().forEach((t) => pc.addTrack(t, ms));

      // 6) Create the SDP offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      // 7) Exchange SDP with OpenAI using the client secret
      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp"
        }
      });
      const answer = { type: "answer", sdp: await sdpResp.text() } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      try {
        await fetch("api/index");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        pushLog("Error fetching index data: " + errorMessage);
      }

      setConnected(true);
      pushLog("Connected to OpenAI Realtime ✨");
      
      const initialContext = await fetchRAGContext("overview main topics summary");
      
      // Send initial system instruction after connection with context
      setTimeout(() => {
        const systemInstruction = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{
              type: "input_text",
              text: `You are a helpful assistant. You have access to the following document context: ${initialContext || "No context loaded yet"}
When answering user questions:
1. Always base your answers on the provided context above and any additional context sent with questions
2. If the context doesn't contain relevant information, say so clearly
3. Keep your answers concise (1-2 sentences)
4. Once you have answered the question, be quiet and wait for the next question`
            }]
          }
        };
        dataChannelRef.current?.send(JSON.stringify(systemInstruction));
      }, 500);
    } catch (err: any) {
      pushLog("Error: " + err.message);
      console.error(err);
    }
  }

  function stop() {
    setConnected(false);
    dataChannelRef.current?.close();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    dataChannelRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
  }

  function sendTextMessage(text: string) {
    // First, fetch RAG context
    fetchRAGContext(text).then(context => {
      const payload = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [ { type: "input_text", text: context ? `Context: ${context}\n\nUser question: ${text}` : text } ]
        }
      };
      dataChannelRef.current?.send(JSON.stringify(payload));

      // Tell the server to actually respond (manual turn‑taking)
      const responseTrigger = { type: "response.create" };
      dataChannelRef.current?.send(JSON.stringify(responseTrigger));
    });
  }

  async function fetchRAGContext(query: string): Promise<string> {
    try {
      const response = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, k: 3 })
      });
      
      if (!response.ok) {
        pushLog("Warning: RAG context fetch failed");
        return "";
      }
      
      const data = await response.json();
      if (data.context && data.context.length > 0) {
        const contextText = data.context
          .map((item: any, i: number) => `[${i + 1}] ${item.text}`)
          .join("\n\n");
        return contextText;
      }
      return "";
    } catch (err) {
      pushLog("Warning: RAG context fetch error");
      return "";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">OpenAI Realtime — React starter</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-3 mb-4">
            {!connected ? (
              <button 
                className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium"
                onClick={start}
              >
                Start Connection
              </button>
            ) : (
              <button 
                className="px-6 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                onClick={stop}
              >
                Stop Connection
              </button>
            )}
            <button
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                muted 
                  ? 'bg-yellow-600 text-white hover:bg-yellow-700' 
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
              onClick={() => {
                const a = remoteAudioRef.current;
                if (!a) return;
                a.muted = !a.muted;
                setMuted(a.muted);
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          </div>

          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const input = form.elements.namedItem("msg") as HTMLInputElement;
              const text = input.value.trim();
              if (text) sendTextMessage(text);
              input.value = "";
            }}
          >
            <input 
              name="msg" 
              placeholder="Type a message…" 
              className="border border-gray-300 rounded-lg px-4 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
            />
            <button 
              className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              type="submit"
              disabled={!connected}
            >
              Send
            </button>
          </form>
        </div>

        <audio ref={remoteAudioRef} autoPlay playsInline />

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900">Event Log</h2>
          <pre className="text-sm bg-gray-100 border border-gray-200 rounded-lg p-4 max-h-80 overflow-auto font-mono text-gray-800 whitespace-pre-wrap">
            {log.length > 0 ? log.join("\n") : "No events yet..."}
          </pre>
        </div>
      </div>
    </div>
  );
}
