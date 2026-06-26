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

const MIC_SUPPRESSED_SOURCES = [
  AUDIO_SOURCES.TTS,
  AUDIO_SOURCES.STORY_NARRATION,
  AUDIO_SOURCES.PAGE_QUESTION,
  AUDIO_SOURCES.GENERATED_QUESTION,
];

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

  const remoteAudioRef = useRef(null);
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

  const micSuppressedRef = useRef(false);
  useEffect(() => {
    micSuppressedRef.current = MIC_SUPPRESSED_SOURCES.includes(activeAudioSource);
  }, [activeAudioSource]);

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
            if (micSuppressedRef.current) return;
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
    geminiLiveConnect,
    geminiLiveDisconnect,
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
