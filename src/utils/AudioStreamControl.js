import { type } from '@testing-library/user-event/dist/type';
import { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { AUDIO_SOURCES, createAudioPlaybackLock } from './audioPlaybackLock';

const BASE_URL = process.env.REACT_APP_API_BASE;
const GEMINI_REINFORCEMENT_SYSTEM_INSTRUCTION = `You are TaleMate's warm educator voice in a parent-child co-reading session.
When the user answers a question, generate a brief acknowledging response based on:
- the last question,
- the user's reply,
- the current book/page context,
- and the image description if provided.
Keep responses short, encouraging, concrete, and natural for a child ages 3-6.
Do not introduce unrelated topics.
Speak directly and stop after the reinforcement.`;

export const AudioStreamControlContext = createContext(null);

export function AudioStreamControlProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [isAIResponding, setIsAIResponding] = useState(false);
  const [isGeminiAudioPlaying, setIsGeminiAudioPlaying] = useState(false);
  const [userUtterance, setUserUtterance] = useState("");
  const [deepgramTranscript, setDeepgramTranscript] = useState("");
  const [speakerLabels, setSpeakerLabels] = useState([]);
  const [isMuted, setIsMuted] = useState(true); // Start muted by default
  const [deepgramConnected, setDeepgramConnected] = useState(false);
  const [activeAudioSource, setActiveAudioSource] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const dataChannelRef = useRef(null);
  const messageQueueRef = useRef([]);
  const deepgramSocketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const deepgramStreamRef = useRef(null);
  const geminiSocketRef = useRef(null);
  const geminiSetupCompleteRef = useRef(false);
  const geminiPlaybackRef = useRef({ ctx: null, nextStart: 0 });
  const geminiMessageQueueRef = useRef([]);
  const geminiActiveAudioSourcesRef = useRef(0);
  const geminiTurnCompleteRef = useRef(false);
  const geminiAudioBlockedRef = useRef(false);
  const audioPlaybackLockRef = useRef(null);
  if (!audioPlaybackLockRef.current) {
    audioPlaybackLockRef.current = createAudioPlaybackLock(setActiveAudioSource);
  }

  const tryBeginAudio = useCallback((source) => {
    return audioPlaybackLockRef.current.tryBeginAudio(source);
  }, []);

  const endAudio = useCallback((source) => {
    return audioPlaybackLockRef.current.endAudio(source);
  }, []);

  const finishGeminiPlaybackIfDone = () => {
    if (geminiTurnCompleteRef.current && geminiActiveAudioSourcesRef.current <= 0) {
      geminiActiveAudioSourcesRef.current = 0;
      setIsGeminiAudioPlaying(false);
      setIsAIResponding(false);
      endAudio(AUDIO_SOURCES.GEMINI_LIVE);
    }
  };

  const resetGeminiPlaybackState = () => {
    geminiActiveAudioSourcesRef.current = 0;
    geminiTurnCompleteRef.current = false;
    geminiAudioBlockedRef.current = false;
    if (geminiPlaybackRef.current?.ctx) {
      geminiPlaybackRef.current.nextStart = geminiPlaybackRef.current.ctx.currentTime;
    }
    setIsGeminiAudioPlaying(false);
    setIsAIResponding(false);
    endAudio(AUDIO_SOURCES.GEMINI_LIVE);
  };

  const connectToDeepgram = async () => {
    try {

      // Get user's microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }, });

      const base = new URL(BASE_URL);
      const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${base.host}/api/deepgram-proxy`;

      const ws = new WebSocket(wsUrl);
      deepgramSocketRef.current = ws;

      ws.onopen = async () => {
        console.log('Connected to Deepgram proxy server');
        setDeepgramConnected(true);
        deepgramStreamRef.current = stream;

        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);

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

          if (data.type === 'server_status') {
            console.log('Server status:', data.message);
            return;
          }

          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            const isFinal = data.is_final;
            const speechFinal = data.speech_final;
            const words = data.channel?.alternatives?.[0]?.words;

            if (transcript && transcript.trim()) {

              let currentSpeaker = null;
              if (words && words.length > 0) {
                const lastWord = words[words.length - 1];
                currentSpeaker = lastWord?.speaker !== undefined ? `Speaker ${lastWord.speaker}` : null;
              }

              setDeepgramTranscript(transcript);
              setSpeakerLabels(currentSpeaker || "");

              if (isFinal) {
                const endsTerminal = /[.?!]\s*$/.test(transcript);
                console.log(`Final transcript received: "${transcript}"${speechFinal ? ' [speech_final]' : ''}${endsTerminal ? ' [terminal_punct]' : ''}`);
                setUserUtterance(transcript);
              }
            }
          }

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
    }
  };

  const disconnectDeepgram = () => {
    console.log("Disconnecting from Deepgram...");

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

  const geminiLiveConnect = async ({
    systemInstructionText = GEMINI_REINFORCEMENT_SYSTEM_INSTRUCTION,
    model = "gemini-3.1-flash-live-preview",
    voiceName = "Puck",
  } = {}) => {
    try {
      setError(null);

      const base = new URL(BASE_URL);
      const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${base.host}/api/gemini-live-proxy`;
      const ws = new WebSocket(wsUrl);
      geminiSocketRef.current = ws;
      geminiSetupCompleteRef.current = false;

      const playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      geminiPlaybackRef.current = { ctx: playbackCtx, nextStart: playbackCtx.currentTime };

      const normalizedVoice = voiceName
        ? voiceName.charAt(0).toUpperCase() + voiceName.slice(1).toLowerCase()
        : "Puck";

      ws.onopen = () => {
        console.log('Connected to Gemini Live');
        setConnected(true);

        const setupMsg = {
          setup: {
            model: model.startsWith('models/') ? model : `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: normalizedVoice } },
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstructionText }],
            },
          },
        };
        console.log('Gemini Live setup →', setupMsg.setup);
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = async (evt) => {
        try {
          let raw;
          if (evt.data instanceof Blob) raw = await evt.data.text();
          else if (evt.data instanceof ArrayBuffer) raw = new TextDecoder().decode(evt.data);
          else raw = evt.data;
          const data = JSON.parse(raw);

          if (data.setupComplete) {
            console.log('Gemini Live setup complete');
            geminiSetupCompleteRef.current = true;
            if (geminiMessageQueueRef.current.length > 0) {
              console.log(`Flushing ${geminiMessageQueueRef.current.length} queued Gemini messages`);
              geminiMessageQueueRef.current.forEach(msg => ws.send(JSON.stringify(msg)));
              geminiMessageQueueRef.current = [];
            }
            return;
          }

          const sc = data.serverContent;
          if (sc) {
            const parts = sc.modelTurn?.parts || [];
            for (const part of parts) {
              const inline = part.inlineData;
              if (inline?.mimeType?.startsWith("audio/pcm")) { 
                if (geminiAudioBlockedRef.current) continue;
                const binary = atob(inline.data);
                const raw = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
                const int16 = new Int16Array(raw.buffer);
                const float32 = new Float32Array(int16.length);
                for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

                const { ctx } = geminiPlaybackRef.current;
                if (!ctx) continue;
                const ownsGeminiLock = audioPlaybackLockRef.current.activeAudioSource === AUDIO_SOURCES.GEMINI_LIVE;
                if (geminiActiveAudioSourcesRef.current <= 0 && !ownsGeminiLock) {
                  if (!tryBeginAudio(AUDIO_SOURCES.GEMINI_LIVE)) {
                    geminiAudioBlockedRef.current = true;
                    setIsAIResponding(false);
                    continue;
                  }
                }
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                console.log(`Gemini audio chunk: ${int16.length} samples, ctx.state=${ctx.state}`);
                const buffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
                buffer.getChannelData(0).set(float32);
                const src = ctx.createBufferSource();
                src.buffer = buffer;
                src.connect(ctx.destination);
                const startAt = Math.max(geminiPlaybackRef.current.nextStart, ctx.currentTime);
                geminiActiveAudioSourcesRef.current += 1;
                setIsAIResponding(true);
                setIsGeminiAudioPlaying(true);
                src.onended = () => {
                  geminiActiveAudioSourcesRef.current = Math.max(0, geminiActiveAudioSourcesRef.current - 1);
                  finishGeminiPlaybackIfDone();
                };
                src.start(startAt);
                geminiPlaybackRef.current.nextStart = startAt + buffer.duration;
              } else if (part.text) {
                console.log('Gemini text response (audio expected!):', part.text);
              }
            }

            if (sc.interrupted) {
              resetGeminiPlaybackState();
            }
            if (sc.turnComplete) {
              geminiTurnCompleteRef.current = true;
              if (geminiAudioBlockedRef.current) {
                geminiAudioBlockedRef.current = false;
                setIsAIResponding(false);
              }
              finishGeminiPlaybackIfDone();
            }
          }

          if (data.toolCall) {
            console.log('Gemini toolCall:', data.toolCall);
          }
        } catch (err) {
          console.warn('Failed to parse Gemini Live message:', err);
        }
      };

      ws.onerror = (e) => {
        console.error('Gemini Live WebSocket error:', e);
        resetGeminiPlaybackState();
        setError('Gemini Live WebSocket error');
      };

      ws.onclose = (evt) => {
        console.log(
          `Gemini Live WebSocket closed — code=${evt.code} reason="${evt.reason}" wasClean=${evt.wasClean}`
        );
        resetGeminiPlaybackState();
        setConnected(false);
      };
    } catch (err) {
      console.error('geminiLiveConnect failed:', err);
      setError(err?.message || String(err));
    }
  };

  const geminiLiveDisconnect = () => {
    if (geminiPlaybackRef.current?.ctx) {
      try {
        if (geminiPlaybackRef.current.ctx.state !== 'closed') {
          geminiPlaybackRef.current.ctx.close();
        }
      } catch (err) {
        console.warn('Error closing Gemini playback context:', err);
      }
      geminiPlaybackRef.current = { ctx: null, nextStart: 0 };
    }
    if (geminiSocketRef.current) {
      try {
        if (geminiSocketRef.current.readyState === WebSocket.OPEN ||
            geminiSocketRef.current.readyState === WebSocket.CONNECTING) {
          geminiSocketRef.current.close();
        }
      } catch (err) {
        console.warn('Error closing Gemini WebSocket:', err);
      }
      geminiSocketRef.current = null;
    }
    resetGeminiPlaybackState();
    geminiMessageQueueRef.current = [];
    setConnected(false);
  };

  const sendContentMessageGemini = (question, reply, bookText, imageDescription) => {
    console.log('Sending content message to Gemini Live');
    if (audioPlaybackLockRef.current.isAnyAudioPlaying()) {
      console.log('Skipping Gemini Live message because audio is already playing');
      return;
    }
    const ws = geminiSocketRef.current;
    geminiTurnCompleteRef.current = false;
    geminiActiveAudioSourcesRef.current = 0;
    geminiAudioBlockedRef.current = false;
    const message = {
      realtimeInput: {
        text: `<reinforcement_context>
Last question: ${question || ''}
Reply: ${reply || ''}
Book/page context: ${bookText || ''}
Image description: ${imageDescription || ''}
</reinforcement_context>`,
      },
    };

    if (ws && ws.readyState === WebSocket.OPEN && geminiSetupCompleteRef.current) {
      console.log('WebSocket is open, sending message:', message);
      ws.send(JSON.stringify(message));
      setIsAIResponding(true);
    } else if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      console.log('Gemini Live setup is not ready, queuing message:', message);
      geminiMessageQueueRef.current.push(message);
      setIsAIResponding(true);
    } else {
      console.warn("Cannot send Gemini content message: WebSocket not available (state:", ws?.readyState, ")");
    }
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
        console.error("Expected JSON but got:", contentType);
        throw new Error(`Server returned ${contentType} instead of JSON`);
      }

      const tokenJson = await tokenResp.json();
      const clientSecret = tokenJson?.value;
      
      const pc = new RTCPeerConnection();
      pc.addTransceiver("audio", { direction: "recvonly" });

      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          const audioEl = remoteAudioRef.current;
          audioEl.srcObject = e.streams[0];
          // Set initial muted state
          audioEl.muted = isMuted;
          audioEl.onended = () => endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
          audioEl.onerror = () => endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
          audioEl.onpause = () => endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
          if (!isMuted && !tryBeginAudio(AUDIO_SOURCES.REMOTE_REALTIME)) {
            audioEl.muted = true;
            return;
          }
          audioEl.play()
            .then(() => console.log(`Remote audio playing successfully (${isMuted ? 'muted' : 'unmuted'})`))
            .catch((err) => {
              endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
              console.error("Error playing remote audio:", err);
            });
        } else {
          console.error("remoteAudioRef.current is null!");
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          setConnected(false);
          setError("Connection failed or closed");
          endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          console.warn("ICE connection issues detected");
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log("DataChannel opened");
        setConnected(true);

        const sessionUpdate = {
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            },
            modalities: ["audio"],
          }
        };
        dc.send(JSON.stringify(sessionUpdate));
        console.log("Session configured with transcription enabled");

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

      // Exchange SDP directly with OpenAI Realtime. The ephemeral client_secret already
      // carries the session config (model, voice), so /v1/realtime/calls takes no query params.
      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResp.ok) {
        const errBody = await sdpResp.text();
        console.error(`SDP exchange failed (${sdpResp.status}):`, errBody);
        throw new Error(`SDP exchange failed: ${sdpResp.status} — ${errBody.slice(0, 300)}`);
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

    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
      } catch (err) {
        console.warn("Error stopping remote audio:", err);
      }
    }
    endAudio(AUDIO_SOURCES.REMOTE_REALTIME);

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
  const sendContentMessage = (question, reply, instruction = `Generate reinforcement feedback for the child's response. Make it brief and encouraging.`) => {
    const dc = dataChannelRef.current;
    const message = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Last question: ${question}\n\nReply: ${reply}\n\nInstruction: ${instruction}`,
          },
        ],
      },
    };
    const responseCreate = { type: "response.create" };

    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(message));
      setIsAIResponding(true);
      dc.send(JSON.stringify(responseCreate));
    } else if (dc && dc.readyState === 'connecting') {
      // Channel still handshaking — queue both; dc.onopen flushes them in order.
      messageQueueRef.current.push(message, responseCreate);
      setIsAIResponding(true);
    } else {
      console.warn("Cannot send content message: data channel not available (state:", dc?.readyState, ")");
    }
  };

  

  // Toggle mute/unmute for AI audio
  const toggleMute = () => {
    setIsMuted(prev => {
      const newMutedState = !prev;

      // Update the remote audio element's muted property
      if (remoteAudioRef.current) {
        if (!newMutedState && !tryBeginAudio(AUDIO_SOURCES.REMOTE_REALTIME)) {
          return true;
        }
        if (newMutedState) {
          endAudio(AUDIO_SOURCES.REMOTE_REALTIME);
        }
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
    isGeminiAudioPlaying,
    isMuted,
    activeAudioSource,
    isAnyAudioPlaying: Boolean(activeAudioSource),
    userUtterance,
    speakerLabels,
    deepgramConnected,
    deepgramTranscript,
    connectToDeepgram,
    disconnectDeepgram,
    connect,
    disconnect,
    geminiLiveConnect,
    geminiLiveDisconnect,
    sendMessage,
    sendContentMessage,
    sendContentMessageGemini,
    toggleMute,
    tryBeginAudio,
    endAudio,
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
