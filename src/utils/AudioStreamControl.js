import { type } from '@testing-library/user-event/dist/type';
import { createContext, useContext, useRef, useState, useEffect } from 'react';

const BASE_URL = process.env.REACT_APP_API_BASE;

export const AudioStreamControlContext = createContext(null);

export function AudioStreamControlProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [isAIResponding, setIsAIResponding] = useState(false);
  const [userUtterance, setUserUtterance] = useState("");
  const [deepgramTranscript, setDeepgramTranscript] = useState("");
  const [speakerLabels, setSpeakerLabels] = useState([]);
  const [isMuted, setIsMuted] = useState(true); // Start muted by default
  const [deepgramConnected, setDeepgramConnected] = useState(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const dataChannelRef = useRef(null);
  const messageQueueRef = useRef([]);
  const deepgramSocketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const deepgramStreamRef = useRef(null);

  const connectToDeepgram = async () => {
    try {

      // Get user's microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Derive WebSocket URL from REACT_APP_API_BASE
      // ws:// for http, wss:// for https
      const base = new URL(BASE_URL);
      const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${base.host}/api/deepgram-proxy`;

      // Connect to our server's WebSocket proxy (no API key needed on client!)
      const ws = new WebSocket(wsUrl);
      deepgramSocketRef.current = ws;

      ws.onopen = async () => {
        console.log('Connected to Deepgram proxy server');
        setDeepgramConnected(true);
        deepgramStreamRef.current = stream;

        // Use AudioWorklet for raw PCM audio (non-deprecated alternative)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);

        // Create an AudioWorkletProcessor inline
        const processorCode = `
          class AudioProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (input && input[0]) {
                // Convert Float32 to Int16 PCM
                const float32Data = input[0];
                const int16Data = new Int16Array(float32Data.length);
                for (let i = 0; i < float32Data.length; i++) {
                  const s = Math.max(-1, Math.min(1, float32Data[i]));
                  int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.port.postMessage(int16Data.buffer);
              }
              return true;
            }
          }
          registerProcessor('audio-processor', AudioProcessor);
        `;

        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);

        try {
          await audioContext.audioWorklet.addModule(processorUrl);
          const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

          workletNode.port.onmessage = (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };

          source.connect(workletNode);
          workletNode.connect(audioContext.destination);

          mediaRecorderRef.current = { audioContext, workletNode, source };
          console.log('AudioWorklet started, sending PCM audio to Deepgram');
        } catch (err) {
          console.error('AudioWorklet setup failed:', err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle server status messages
          if (data.type === 'server_status') {
            console.log('Server status:', data.message);
            return;
          }

          // Handle transcription results from Deepgram (via server)
          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            const isFinal = data.is_final;
            const words = data.channel?.alternatives?.[0]?.words;

            if (transcript && transcript.trim()) {

              // Extract speaker information from words
              let currentSpeaker = null;
              if (words && words.length > 0) {
                // Get the most recent speaker (last word's speaker)
                const lastWord = words[words.length - 1];
                currentSpeaker = lastWord?.speaker !== undefined ? `Speaker ${lastWord.speaker}` : null;
              }

              setDeepgramTranscript(transcript);
              setSpeakerLabels(currentSpeaker || "");

              // Only update userUtterance if we have a final transcript
              if (isFinal) {
                setUserUtterance(transcript);
              }
            }
          }

          // // Handle other message types
          // if (data.type === 'Metadata') {
          //   console.log('Deepgram metadata:', data);
          // }

          // if (data.type === 'UtteranceEnd') {
          //   console.log('Utterance ended');
          // }

          // if (data.type === 'SpeechStarted') {
          //   console.log('Speech started');
          // }

          if (data.type === 'error') {
            console.error('Deepgram error from server:', data.message);
          }
        } catch (err) {
          console.warn('Failed to parse server message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('websocket status', ws.readyState);
        console.log('Disconnected from Deepgram proxy server');
      };

    } catch (err) {
      console.error('Failed to connect to Deepgram proxy:', err);
      // Don't throw - allow OpenAI connection to proceed even if Deepgram fails
    }
  };

  const disconnectDeepgram = () => {
    console.log("Disconnecting from Deepgram...");

    // Stop AudioWorklet
    if (mediaRecorderRef.current) {
      try {
        const { audioContext, workletNode, source } = mediaRecorderRef.current;

        if (source) {
          source.disconnect();
        }
        if (workletNode) {
          workletNode.disconnect();
          workletNode.port.close();
        }
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close();
        }

        mediaRecorderRef.current = null;
      } catch (err) {
        console.warn("Error stopping AudioWorklet:", err);
      }
    }

    // Close WebSocket connection
    if (deepgramSocketRef.current) {
      try {
        if (deepgramSocketRef.current.readyState === WebSocket.OPEN ||
            deepgramSocketRef.current.readyState === WebSocket.CONNECTING) {
          deepgramSocketRef.current.close();
        }
        deepgramSocketRef.current = null;
      } catch (err) {
        console.warn("Error closing Deepgram WebSocket:", err);
      }
    }

    // Stop media stream tracks
    if (deepgramStreamRef.current) {
      try {
        deepgramStreamRef.current.getTracks().forEach(track => track.stop());
        deepgramStreamRef.current = null;
      } catch (err) {
        console.warn("Error stopping Deepgram media tracks:", err);
      }
    }

    setDeepgramConnected(false);
    setDeepgramTranscript("");
    console.log("Disconnected from Deepgram");
  };

  const connect = async () => {
    try {
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
          remoteAudioRef.current.srcObject = e.streams[0];
          // Set initial muted state
          remoteAudioRef.current.muted = isMuted;
          remoteAudioRef.current.play()
            .then(() => console.log(`Remote audio playing successfully (${isMuted ? 'muted' : 'unmuted'})`))
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
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          console.warn("ICE connection issues detected");
        }
      };

      // // Audio stream captured and sent to OpenAI through RTCPeerConnection
      // const voiceInput = await navigator.mediaDevices.getUserMedia({ audio: true });
      // localStreamRef.current = voiceInput;
      // voiceInput.getAudioTracks().forEach((t) => pc.addTrack(t, voiceInput));

      // Create data channel AFTER adding tracks
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log("DataChannel opened");
        setConnected(true);

        // Configure session to enable input audio transcription
        const sessionUpdate = {
          type: "session.update",
          session: {
            // turn_detection: {
            //   type: "server_vad",
            //   threshold: 0.5,
            //   prefix_padding_ms: 300,
            //   silence_duration_ms: 500
            // },
            modalities: ["audio"],

            // input_audio_transcription: {
            //   model: "gpt-4o-transcribe",
            // }
          }
        };
        dc.send(JSON.stringify(sessionUpdate));
        console.log("Session configured with transcription enabled");

      // Send system instruction immediately when channel opens
       const systemInstruction = {
         type: "conversation.item.create",
         item: {
           type: "message",
           role: "system",
           content: [
             {
               type: "input_text",
               text: `You are an educator engaging in a conversation with users about educational content. Your goal is to ask relevant and thought-provoking questions based on their discussion to facilitate learning.`,
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
        //console.log(`EVENT: ${evt.data}`);

        try {
          const event = JSON.parse(evt.data);

          // Handle input audio transcription - This captures user's speech as text
          if (event.type === 'conversation.item.input_audio_transcription.completed') {
            setUserUtterance(event.transcript);
          }

          // Track when AI starts responding
          if (event.type === 'response.created' || event.type === 'response.output_item.added') {
            setIsAIResponding(true);
          }

          // Track when AI finishes responding
          if (event.type === 'response.done' || event.type === 'response.completed') {
            setIsAIResponding(false);
          }

          // Also handle error cases
          if (event.type === 'response.failed' || event.type === 'error') {
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
      console.log("Message sent:", message);
    } else if (dataChannelRef.current && dataChannelRef.current.readyState === 'connecting') {
      // Channel is still connecting, queue the message
      messageQueueRef.current.push(message);
    } else {
      // Channel doesn't exist or is closed
      console.warn("Cannot send message: channel not available. Please connect first.");
    }
  };

  // Send content-based message to ask questions
  const sendContentMessage = (content, instruction = `Generate an educational question that teaches toddlers about patterns and provokes further discussion between toddler and caregiver based on the provided contents. 
    Here are two examples of educational question generate a new question based on the provided example. Example Questions: 1. Describe the pattern on the sleeping bags. 2. What color would the next bunch of flowers be if there was one more?`) => {
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

    // Immediately trigger response
    setIsAIResponding(true);
    const responseCreate = {
      type: "response.create",
    };
    sendMessage(responseCreate);
  };

  // Toggle mute/unmute for AI audio
  const toggleMute = () => {
    setIsMuted(prev => {
      const newMutedState = !prev;

      // Update the remote audio element's muted property
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = newMutedState;
      }

      return newMutedState;
    });
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
    isMuted,
    userUtterance,
    speakerLabels,
    deepgramConnected,
    deepgramTranscript,
    connectToDeepgram,
    disconnectDeepgram,
    connect,
    disconnect,
    sendMessage,
    sendContentMessage,
    toggleMute,
    remoteAudioRef,
  };

  return (
    <AudioStreamControlContext.Provider value={value}>
      {children}
    </AudioStreamControlContext.Provider>
  );
}

export const useAudioStreamControl = () => {
  const context = useContext(AudioStreamControlContext);
  if (!context) {
    throw new Error('useAudioStreamControl must be used within AudioStreamControlProvider');
  }
  return context;
};