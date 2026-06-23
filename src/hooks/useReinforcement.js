import { useState, useRef, useCallback, useEffect } from "react";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { sendReinforcementLog, resetReinforcementSnapshot, setAwaitingQuestionAnswer, buildBookContext } from "../utils/utteranceProcessor";

// Owns the reinforcement loop: generating + streaming the spoken reinforcement,
// barge-in detection, and reinforcement reveal state. computeRevealLength comes
// from useAudioPlayback; cross-boundary refs are Story-owned and passed in.
export function useReinforcement({
  computeRevealLength,
  // audio-control
  isAnyAudioPlaying,
  tryBeginAudio,
  endAudio,
  remoteAudioRef,
  isMuted,
  // story data / shared refs (Story-owned)
  narratorRole,
  stateRef,
  lastAskedQuestionRef,
  lastExpectedAnswerRef,
  reinforcementFromPageQuestionRef,
  generatedQuestionPendingRef,
  imageDescriptionRef,
  userAttentionRef,
  deepgramTranscript,
  // cross-cutting setters
  setQuestionHistory,
  setInReinforcementLoop,
}) {
  const [isReinforcementPlaying, setIsReinforcementPlaying] = useState(false);
  const [revealedReinforcement, setRevealedReinforcement] = useState('');

  const reinforcementModeRef = useRef(false);
  const reinforcementSessionRef = useRef({ question: null, turns: [] });
  const reinforcementRequestSeqRef = useRef(0);
  const reinforcementAudioRef = useRef(null);
  const reinforcementStreamingPlayerRef = useRef(null);
  const reinforcementAudioBlockedRef = useRef(false);
  const reinforcementActiveRef = useRef(false);
  const fullReinforcementTextRef = useRef('');
  const cumulativeReinforcementMsRef = useRef(0);

  const stopReinforcementAudio = useCallback(() => {
    if (reinforcementAudioRef.current) {
      reinforcementAudioRef.current.pause();
      reinforcementAudioRef.current = null;
    }
    if (reinforcementStreamingPlayerRef.current) {
      try { reinforcementStreamingPlayerRef.current.stop(); } catch {}
      reinforcementStreamingPlayerRef.current = null;
    }
    reinforcementAudioBlockedRef.current = false;
    reinforcementActiveRef.current = false;
    setIsReinforcementPlaying(false);
    endAudio(AUDIO_SOURCES.REINFORCEMENT);
  }, [endAudio]);

  useEffect(() => {
    const BARGE_IN_MIN_WORDS = 2;
    const wordCount = (deepgramTranscript || '').trim().split(/\s+/).filter(Boolean).length;
    if (reinforcementActiveRef.current && wordCount >= BARGE_IN_MIN_WORDS) {
      console.log("[barge-in] child speech detected during reinforcement, stopping:", deepgramTranscript);
      reinforcementRequestSeqRef.current += 1;
      stopReinforcementAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepgramTranscript]);

  const closeReinforcementMode = useCallback(() => {
    reinforcementModeRef.current = false;
    reinforcementSessionRef.current = { question: null, turns: [] };
    reinforcementRequestSeqRef.current += 1;
    resetReinforcementSnapshot();
    stopReinforcementAudio();
    generatedQuestionPendingRef.current = false;
    setInReinforcementLoop(false);
    setAwaitingQuestionAnswer(false);
    if (remoteAudioRef.current && !isMuted) {
      remoteAudioRef.current.muted = false;
    }
  }, [isMuted, remoteAudioRef, stopReinforcementAudio, generatedQuestionPendingRef, setInReinforcementLoop]);

  const getCurrentPageReinforcementContext = () => {
    const currentState = stateRef.current;
    const page = currentState.pagesValues[currentState.page];
    const bookText = buildBookContext(currentState.pagesValues, currentState.page);

    // Expected answer only applies to a generated question. A page-question
    // answer has no reference answer, so it should always just be affirmed.
    const expectedAnswer = reinforcementFromPageQuestionRef.current
      ? null
      : (lastExpectedAnswerRef?.current ?? null);

    return {
      currentPageQuestion: page?.question || '',
      bookText,
      currentPageNumber: currentState.page + 1,
      imageDescriptionRef,
      userAttention: userAttentionRef.current,
      expectedAnswer,
    };
  };

  const playReinforcement = async (reply) => {
    if (isAnyAudioPlaying) return;

    const currentState = stateRef.current;
    const pageQuestion = currentState.pagesValues[currentState.page]?.question || '';
    const question = reinforcementSessionRef.current.question || lastAskedQuestionRef.current || pageQuestion;
    const requestSeq = reinforcementRequestSeqRef.current + 1;

    reinforcementRequestSeqRef.current = requestSeq;
    reinforcementModeRef.current = true;
    generatedQuestionPendingRef.current = false;
    reinforcementSessionRef.current = {
      question,
      turns: reinforcementSessionRef.current.turns || [],
    };
    setAwaitingQuestionAnswer(false);
    stopReinforcementAudio();
    reinforcementAudioBlockedRef.current = false;
    fullReinforcementTextRef.current = '';
    cumulativeReinforcementMsRef.current = 0;
    setRevealedReinforcement('');

    try {
      const context = getCurrentPageReinforcementContext();

      const finishStreamingReinforcement = () => {
        if (reinforcementStreamingPlayerRef.current) {
          reinforcementStreamingPlayerRef.current = null;
        }
        reinforcementAudioBlockedRef.current = false;
        reinforcementActiveRef.current = false;
        setIsReinforcementPlaying(false);
        if (reinforcementFromPageQuestionRef.current) {
          setQuestionHistory(prev => prev.filter(m => m.type !== 'reinforcement'));
          setRevealedReinforcement('');
          fullReinforcementTextRef.current = '';
          cumulativeReinforcementMsRef.current = 0;
        } else if (fullReinforcementTextRef.current) {
          setRevealedReinforcement(fullReinforcementTextRef.current);
        }
        endAudio(AUDIO_SOURCES.REINFORCEMENT);
        if (remoteAudioRef.current && !isMuted) {
          remoteAudioRef.current.muted = false;
        }
      };

      await sendReinforcementLog({
        question,
        reply,
        ...context,
        reinforcementHistory: reinforcementSessionRef.current.turns,
        ttsVoiceName: narratorRole?.VA || null,
        onReinforcementReady: (reinforcement) => {
          if (!reinforcement || requestSeq !== reinforcementRequestSeqRef.current || !reinforcementModeRef.current) return;
          reinforcementSessionRef.current.turns = [
            ...reinforcementSessionRef.current.turns,
            { user: reply, response: reinforcement },
          ];
          fullReinforcementTextRef.current = reinforcement;
          cumulativeReinforcementMsRef.current = 0;
          setRevealedReinforcement('');
          setQuestionHistory(prev => {
            const last = prev[prev.length - 1];
            if (last && last.type === 'reinforcement') {
              return [...prev.slice(0, -1), { ...last, text: reinforcement }];
            }
            return [...prev, { id: `reinf-${Date.now()}`, text: reinforcement, type: 'reinforcement' }];
          });
        },
        onAudioChunk: (seq, audioContent, durationMs) => {
          if (requestSeq !== reinforcementRequestSeqRef.current || !reinforcementModeRef.current) return;
          if (reinforcementAudioBlockedRef.current) return;
          if (!reinforcementStreamingPlayerRef.current) {
            if (!tryBeginAudio(AUDIO_SOURCES.REINFORCEMENT)) {
              reinforcementAudioBlockedRef.current = true;
              setIsReinforcementPlaying(false);
              if (fullReinforcementTextRef.current) setRevealedReinforcement(fullReinforcementTextRef.current);
              return;
            }
            if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
            reinforcementStreamingPlayerRef.current = createStreamingPcmPlayer({
              onEnded: finishStreamingReinforcement,
              onError: (err) => {
                console.error("Reinforcement streaming player error:", err);
                finishStreamingReinforcement();
              },
            });
            setIsReinforcementPlaying(true);
            reinforcementActiveRef.current = true;
            Promise.resolve(reinforcementStreamingPlayerRef.current.resume()).catch((err) => {
              console.error("Reinforcement Gemini TTS playback error:", err);
              finishStreamingReinforcement();
            });
          }
          reinforcementStreamingPlayerRef.current.pushChunk(seq, audioContent);
          cumulativeReinforcementMsRef.current += Number(durationMs) || 0;
          if (fullReinforcementTextRef.current) {
            const cut = computeRevealLength(fullReinforcementTextRef.current, cumulativeReinforcementMsRef.current);
            setRevealedReinforcement(fullReinforcementTextRef.current.slice(0, cut));
          }
        },
        onAudioEnd: () => {
          if (requestSeq !== reinforcementRequestSeqRef.current || !reinforcementModeRef.current) return;
          if (reinforcementAudioBlockedRef.current) {
            reinforcementAudioBlockedRef.current = false;
            return;
          }
          if (reinforcementStreamingPlayerRef.current) reinforcementStreamingPlayerRef.current.end();
          else finishStreamingReinforcement();
        },
        onAudioError: (message) => {
          console.error("Reinforcement Gemini TTS stream error:", message);
          if (requestSeq === reinforcementRequestSeqRef.current) finishStreamingReinforcement();
        },
      });

      if (requestSeq === reinforcementRequestSeqRef.current && !reinforcementStreamingPlayerRef.current && !reinforcementAudioBlockedRef.current) {
        finishStreamingReinforcement();
      }
    } catch (error) {
      console.error("Reinforcement generation/playback error:", error);
      if (requestSeq === reinforcementRequestSeqRef.current) {
        reinforcementAudioBlockedRef.current = false;
        setIsReinforcementPlaying(false);
        if (fullReinforcementTextRef.current) setRevealedReinforcement(fullReinforcementTextRef.current);
        endAudio(AUDIO_SOURCES.REINFORCEMENT);
        if (remoteAudioRef.current && !isMuted) {
          remoteAudioRef.current.muted = false;
        }
      }
    }
  };

  // Reset only the reinforcement reveal state, for Story's clearQuestionUI.
  const resetReinforcementRevealState = useCallback(() => {
    setRevealedReinforcement('');
    fullReinforcementTextRef.current = '';
    cumulativeReinforcementMsRef.current = 0;
  }, []);

  return {
    isReinforcementPlaying,
    revealedReinforcement,
    reinforcementModeRef,
    playReinforcement,
    closeReinforcementMode,
    stopReinforcementAudio,
    resetReinforcementRevealState,
  };
}
