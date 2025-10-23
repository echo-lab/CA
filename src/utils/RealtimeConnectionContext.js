import { createContext, useContext, useRef, useState, useEffect } from 'react';

const BASE_URL = process.env.REACT_APP_API_BASE;

export const RealtimeConnectionContext = createContext(null);

export function RealtimeConnectionProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [isAIResponding, setIsAIResponding] = useState(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const dataChannelRef = useRef(null);
  const messageQueueRef = useRef([]);

  const connect = async () => {
    try {
      console.log("Starting connection…");
      setError(null);
      
      const tokenResp = await fetch(`${BASE_URL}/api/rt-connection`);
      console.log("Response status:", tokenResp.status);
      
      if (!tokenResp.ok) {
        const errorText = await tokenResp.text();
        console.error(`Failed to get token (${tokenResp.status}):`, errorText.substring(0, 500));
        throw new Error(`Server error: ${tokenResp.status}`);
      }
      
      const contentType = tokenResp.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const responseText = await tokenResp.text();
        console.error("Expected JSON but got:", contentType);
        throw new Error(`Server returned ${contentType} instead of JSON`);
      }

      const tokenJson = await tokenResp.json();
      const clientSecret = tokenJson?.value;
      
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        console.log("ontrack event received! Streams:", e.streams);
        if (remoteAudioRef.current) {
          console.log("Setting remote audio srcObject");
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play()
            .then(() => console.log("Remote audio playing successfully"))
            .catch((err) => console.error("Error playing remote audio:", err));
        } else {
          console.error("remoteAudioRef.current is null!");
        }
      };

      // Connection state changes
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          setConnected(false);
          setError("Connection failed or closed");
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          console.warn("ICE connection issues detected");
        }
      };

      const initialContext = "You are helping toddlers learn about patterns.";

      // Get user media FIRST
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = ms;
      ms.getAudioTracks().forEach((t) => pc.addTrack(t, ms));

      // Create data channel AFTER adding tracks
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log("DataChannel opened");
        setConnected(true);

        // Send system instruction immediately when channel opens
        const systemInstruction = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are a helpful assistant. You have access to the following document context:\n\n${initialContext || "No context loaded yet"}\n\nWhen answering user questions:\n1. Always base your answers on the provided context above and any additional context sent with questions\n2. If the context doesn't contain relevant information, say so clearly\n3. Keep your answers concise (1-2 sentences)\n4. Once you have answered the question, be quiet and wait for the next question`,
              },
            ],
          },
        };
        dc.send(JSON.stringify(systemInstruction));
        console.log("System instruction sent");

        // Flush any queued messages
        if (messageQueueRef.current.length > 0) {
          console.log(`Flushing ${messageQueueRef.current.length} queued messages`);
          messageQueueRef.current.forEach(msg => {
            dc.send(JSON.stringify(msg));
          });
          messageQueueRef.current = [];
        }
      };

      dc.onclose = () => {
        console.log("DataChannel closed");
        setConnected(false);
        messageQueueRef.current = [];
      };

      dc.onerror = (event) => {
        console.error("DataChannel error:", event);
        if (event.error) {
          console.error("Error details:", event.error.message);
          // User-Initiated Abort is usually not critical, just log it
          if (event.error.message.includes("User-Initiated Abort")) {
            console.warn("Connection was aborted - this may happen during disconnect");
          } else {
            setError(`Data channel error: ${event.error.message}`);
          }
        }
      };

      dc.onmessage = (evt) => {
        console.log(`EVENT: ${evt.data}`);

        try {
          const event = JSON.parse(evt.data);

          // Track when AI starts responding
          if (event.type === 'response.created' || event.type === 'response.output_item.added') {
            console.log("AI started responding");
            setIsAIResponding(true);
          }

          // Track when AI finishes responding
          if (event.type === 'response.done' || event.type === 'response.completed') {
            console.log("AI finished responding");
            setIsAIResponding(false);
          }

          // Also handle error cases
          if (event.type === 'response.failed' || event.type === 'error') {
            console.log("AI response failed or error occurred");
            setIsAIResponding(false);
          }
        } catch (err) {
          console.warn("Failed to parse event data:", err);
        }
      };

      // Create and set local description
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      // Exchange SDP with OpenAI
      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResp.ok) {
        throw new Error(`SDP exchange failed: ${sdpResp.status}`);
      }

      const answer = { type: "answer", sdp: await sdpResp.text() };
      await pc.setRemoteDescription(answer);

      console.log("WebRTC connection setup complete");
      
    } catch (err) {
      console.error("Error: " + (err?.message || err));
      setError(err.message);
      setConnected(false);
    }
  };

  const disconnect = () => {
    console.log("Disconnecting...");

    // Clear any queued messages first
    messageQueueRef.current = [];
    setConnected(false);

    // Close data channel gracefully
    if (dataChannelRef.current) {
      try {
        if (dataChannelRef.current.readyState === 'open' || dataChannelRef.current.readyState === 'connecting') {
          dataChannelRef.current.close();
        }
        dataChannelRef.current = null;
      } catch (err) {
        console.warn("Error closing data channel:", err);
      }
    }

    // Close peer connection
    if (pcRef.current) {
      try {
        pcRef.current.close();
        pcRef.current = null;
      } catch (err) {
        console.warn("Error closing peer connection:", err);
      }
    }

    // Stop all media tracks
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      } catch (err) {
        console.warn("Error stopping media tracks:", err);
      }
    }

    console.log("Disconnected");
  };

  const sendMessage = (message) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      // Channel is open, send immediately
      dataChannelRef.current.send(JSON.stringify(message));
      console.log("Message sent immediately");
    } else if (dataChannelRef.current && dataChannelRef.current.readyState === 'connecting') {
      // Channel is still connecting, queue the message
      console.log("Channel connecting, queueing message");
      messageQueueRef.current.push(message);
    } else {
      // Channel doesn't exist or is closed
      console.warn("Cannot send message: channel not available. Please connect first.");
    }
  };

  // Send content-based message to ask questions
  const sendContentMessage = (content, instruction = "Generate and ask an educational question to teach toddlers about patterns based on this content") => {
    const message = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${instruction}\n\nContent: ${JSON.stringify(content)}`,
          },
        ],
      },
    };

    // Send the message using the existing sendMessage function
    sendMessage(message);

    // Set responding state to true before triggering response
    setIsAIResponding(true);

    // Trigger a response from the assistant
    const responseCreate = {
      type: "response.create",
    };

    sendMessage(responseCreate);
    console.log("Content message and response trigger sent");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const value = {
    connected,
    error,
    isAIResponding,
    connect,
    disconnect,
    sendMessage,
    sendContentMessage,
    remoteAudioRef,
  };

  return (
    <RealtimeConnectionContext.Provider value={value}>
      {children}
    </RealtimeConnectionContext.Provider>
  );
}

export const useRealtimeConnection = () => {
  const context = useContext(RealtimeConnectionContext);
  if (!context) {
    throw new Error('useRealtimeConnection must be used within RealtimeConnectionProvider');
  }
  return context;
};