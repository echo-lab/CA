import { useState, useRef, useCallback, useEffect } from "react";
import { say } from "../utils/ttsClient";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { streamGeneratedQuestionTest } from "../utils/InnerThoughtProcessStream";
import { abortCurrentCategorization, setAwaitingQuestionAnswer } from "../utils/utteranceProcessor";

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

const SPEECH_CHARS_PER_SEC = 14;

export function useAudioPlayback({
  tryBeginAudio,
  endAudio,
  remoteAudioRef,
  isMuted,
  audio,
  setAudio,
  isPlaying,
  setIsPlaying,
  setIsAudioPlaying,
  setAudioHasEnded,
  setIsButtonDisabled,
  setChildHasPlayed,
  generatedQuestion,
  setGeneratedQuestion,
  setQuestionHistory,
  setShowAvatar,
  showAvatarRef,
  setInReinforcementLoop,
  setIsCategorizationPending,
  hasSlidCloserRef,
  lastAskedQuestionRef,
  pendingGeneratedQuestionRef,
  reinforcementFromPageQuestionRef,
  generatedQuestionPendingRef,
  questionGenEnabledRef,
  state,
  narratorRole,
  TEST_GENERATED_QUESTION,
}) {
  const isGeneratedQuestionPlayingRef = useRef(false);
  const isPageQuestionPlayingRef = useRef(false);
  const streamingPlayerRef = useRef(null);
  const fullQuestionTextRef = useRef('');
  const cumulativeAudioMsRef = useRef(0);
  const generatedQuestionAudioChunksRef = useRef([]);
  const generatedQuestionAudioEndedRef = useRef(false);
  const generatedQuestionAudioErrorRef = useRef(null);
  const generatedQuestionPlayRequestedRef = useRef(false);
  const suppressGeneratedAudioStreamRef = useRef(false);
  const generatedQuestionAudioRef = useRef(null);
  const generatedQuestionAudioUrlRef = useRef(null);

  const [isGeneratedQuestionPlaying, setIsGeneratedQuestionPlaying] = useState(false);
  const [isPageQuestionPlaying, setIsPageQuestionPlaying] = useState(false);
  const [revealedQuestion, setRevealedQuestion] = useState('');
  const [isThoughtRevealed, setIsThoughtRevealed] = useState(false);

  useEffect(() => { isGeneratedQuestionPlayingRef.current = isGeneratedQuestionPlaying; }, [isGeneratedQuestionPlaying]);

  const computeRevealLength = useCallback((fullText, cumulativeMs) => {
    if (!fullText) return 0;
    const estTotalMs = (fullText.length / SPEECH_CHARS_PER_SEC) * 1000;
    const fraction = Math.min(1, cumulativeMs / Math.max(estTotalMs, 1));
    const target = Math.floor(fullText.length * fraction);
    if (target >= fullText.length) return fullText.length;
    let cut = target;
    while (cut < fullText.length && fullText[cut] !== ' ') cut++;
    return cut;
  }, []);

  const teardownStreamingPlayer = useCallback(() => {
    if (streamingPlayerRef.current) {
      try { streamingPlayerRef.current.stop(); } catch {}
      streamingPlayerRef.current = null;
    }
  }, []);

  const finishGeneratedPlayback = useCallback((questionText) => {
    if (remoteAudioRef.current && !isMuted) remoteAudioRef.current.muted = false;
    generatedQuestionPlayRequestedRef.current = false;
    setIsGeneratedQuestionPlaying(false);
    endAudio(AUDIO_SOURCES.GENERATED_QUESTION);
    if (questionText) lastAskedQuestionRef.current = questionText;
    setAwaitingQuestionAnswer(true);
    setShowAvatar(true);
    setInReinforcementLoop(true);
  }, [endAudio, isMuted, remoteAudioRef, generatedQuestionPlayRequestedRef, lastAskedQuestionRef, setShowAvatar, setInReinforcementLoop]);

  const createGeneratedQuestionPlayer = useCallback((questionText) => createStreamingPcmPlayer({
    onEnded: () => {
      finishGeneratedPlayback(questionText || fullQuestionTextRef.current);
    },
    onError: (err) => {
      console.error('streaming player error:', err);
      finishGeneratedPlayback(questionText || fullQuestionTextRef.current);
    },
  }), [finishGeneratedPlayback]);

  const pushBufferedGeneratedAudio = useCallback((player) => {
    const chunks = [...generatedQuestionAudioChunksRef.current]
      .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    chunks.forEach(({ seq, audioContent }) => {
      player.pushChunk(seq, audioContent);
    });
  }, []);

  const startGeneratedQuestion = useCallback((questionText) => {
    const text = String(questionText || '').trim();
    if (!text || isGeneratedQuestionPlayingRef.current) return;

    const existing = streamingPlayerRef.current;
    if (existing && existing.isFinished?.()) {
      try { existing.stop(); } catch {}
      streamingPlayerRef.current = null;
    }

    fullQuestionTextRef.current = text;
    generatedQuestionPendingRef.current = true;
    reinforcementFromPageQuestionRef.current = false;
    cumulativeAudioMsRef.current = 0;
    generatedQuestionAudioChunksRef.current = [];
    generatedQuestionAudioEndedRef.current = false;
    generatedQuestionAudioErrorRef.current = null;
    generatedQuestionPlayRequestedRef.current = false;
    suppressGeneratedAudioStreamRef.current = false;
    pendingGeneratedQuestionRef.current = text;
    setRevealedQuestion('');
    setIsThoughtRevealed(false);
    setGeneratedQuestion(text);
    setQuestionHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.type === "generated") {
        if (last.text === text) return prev;
        return [...prev.slice(0, -1), { ...last, text }];
      }
      return [
        ...prev,
        {
          id: `gen-${Date.now()}`,
          text,
          type: "generated",
        },
      ];
    });
    if (!showAvatarRef.current) {
      hasSlidCloserRef.current = false;
    }
    setShowAvatar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAudioChunk = useCallback((seq, audioContent, durationMs) => {
    if (!audioContent) return;
    if (suppressGeneratedAudioStreamRef.current) return;

    const chunk = { seq, audioContent, durationMs };
    const chunks = generatedQuestionAudioChunksRef.current;
    const existingIndex = chunks.findIndex(c => c.seq === seq);
    if (existingIndex >= 0) chunks[existingIndex] = chunk;
    else chunks.push(chunk);

    if (generatedQuestionPlayRequestedRef.current && streamingPlayerRef.current) {
      streamingPlayerRef.current.pushChunk(seq, audioContent);
    }

    cumulativeAudioMsRef.current += Number(durationMs) || 0;
    if (fullQuestionTextRef.current) {
      const cut = computeRevealLength(fullQuestionTextRef.current, cumulativeAudioMsRef.current);
      setRevealedQuestion(fullQuestionTextRef.current.slice(0, cut));
    }
  }, [computeRevealLength]);

  const handleAudioEnd = useCallback(() => {
    if (suppressGeneratedAudioStreamRef.current) {
      suppressGeneratedAudioStreamRef.current = false;
      return;
    }
    generatedQuestionAudioEndedRef.current = true;
    if (generatedQuestionPlayRequestedRef.current && streamingPlayerRef.current) {
      streamingPlayerRef.current.end();
    }
    if (fullQuestionTextRef.current) setRevealedQuestion(fullQuestionTextRef.current);
  }, []);

  const handleAudioError = useCallback((message) => {
    console.warn('TTS streaming error:', message);
    if (suppressGeneratedAudioStreamRef.current) {
      suppressGeneratedAudioStreamRef.current = false;
      return;
    }
    generatedQuestionAudioErrorRef.current = message || 'Generated question audio failed';
    if (fullQuestionTextRef.current) setRevealedQuestion(fullQuestionTextRef.current);
    if (generatedQuestionPlayRequestedRef.current) {
      finishGeneratedPlayback(fullQuestionTextRef.current);
    }
    teardownStreamingPlayer();
  }, [finishGeneratedPlayback, teardownStreamingPlayer]);

  const handleTestQuestionClick = useCallback(() => {
    if (process.env.NODE_ENV !== 'development' || isGeneratedQuestionPlayingRef.current) return;

    abortCurrentCategorization();
    setIsCategorizationPending(false);
    streamGeneratedQuestionTest({
      questionText: TEST_GENERATED_QUESTION,
      ttsVoiceName: narratorRole?.VA || null,
      onQuestionReady: startGeneratedQuestion,
      onAudioChunk: handleAudioChunk,
      onAudioEnd: handleAudioEnd,
      onAudioError: handleAudioError,
    });
  }, [TEST_GENERATED_QUESTION, handleAudioChunk, handleAudioEnd, handleAudioError, narratorRole?.VA, startGeneratedQuestion, setIsCategorizationPending]);

  const speakGenerated = () => {
    if (isGeneratedQuestionPlaying) return;

    const cachedQuestion = generatedQuestion;
    if (!cachedQuestion) return;

    const audioError = generatedQuestionAudioErrorRef.current;
    const hasChunks = generatedQuestionAudioChunksRef.current.length > 0;
    if (audioError && !hasChunks) {
      console.warn('Generated question Gemini TTS unavailable:', audioError);
      finishGeneratedPlayback(cachedQuestion);
      return;
    }

    const existing = streamingPlayerRef.current;
    if (existing && existing.isFinished?.()) {
      try { existing.stop(); } catch {}
      streamingPlayerRef.current = null;
    }

    if (!tryBeginAudio(AUDIO_SOURCES.GENERATED_QUESTION)) {
      return;
    }

    if (!streamingPlayerRef.current) {
      streamingPlayerRef.current = createGeneratedQuestionPlayer(cachedQuestion);
    }

    generatedQuestionPlayRequestedRef.current = true;
    setIsGeneratedQuestionPlaying(true);
    setIsThoughtRevealed(true);
    if (generatedQuestionAudioEndedRef.current && fullQuestionTextRef.current) {
      setRevealedQuestion(fullQuestionTextRef.current);
    }
    if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
    pushBufferedGeneratedAudio(streamingPlayerRef.current);

    Promise.resolve(streamingPlayerRef.current.resume()).catch((err) => {
      console.error("Generated question Gemini TTS playback error:", err);
      finishGeneratedPlayback(cachedQuestion);
    });

    if (generatedQuestionAudioEndedRef.current) {
      streamingPlayerRef.current.end();
    }
  };

  const playSound = () => {
    const pageNarratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
    const voiceName = pageNarratorRole?.VA || "kore";
    const role = pageNarratorRole?.role || null;
    const question = state.pagesValues[state.page].question;
    speak(question, voiceName, "neutral", role, AUDIO_SOURCES.PAGE_QUESTION, {
      onBegin: () => {
        setIsPageQuestionPlaying(true);
        isPageQuestionPlayingRef.current = true;
        lastAskedQuestionRef.current = question;
        if (!showAvatarRef.current) {
          hasSlidCloserRef.current = false;
        }
        setShowAvatar(true);
      },
      onError: () => {
        setIsPageQuestionPlaying(false);
        isPageQuestionPlayingRef.current = false;
      },
    });
  };

  async function speak(
    text,
    voiceName = "kore",
    emotion = "neutral",
    role = null,
    source = AUDIO_SOURCES.TTS,
    options = {}
  ) {
    const clean = stripSSMLTags(String(text || "").trim());
    if (!clean) return false;

    if (!tryBeginAudio(source)) {
      return false;
    }

    try {
      options.onBegin?.();
      setIsAudioPlaying(true);

      const { audio: audioEl } = await say({
        text: clean,
        voiceName,
        emotion,
        role,
      });

      const handleEnded = () => {
        endAudio(source);
        options.onEnded?.();
        audioEnded();
      };
      const handleError = () => {
        endAudio(source);
        options.onError?.();
        audioEnded();
      };

      setAudio(audioEl);
      audioEl.addEventListener("ended", handleEnded, { once: true });
      audioEl.addEventListener("error", handleError, { once: true });
      return true;
    } catch (err) {
      console.error("TTS error:", err);
      endAudio(source);
      options.onError?.();
      setIsAudioPlaying(false);
      setTimeout(() => {
        setAudioHasEnded(true);
      }, 100);
      return false;
    }
  }

  const audioEnded = useCallback(() => {

    if (audio) {
        audio.removeEventListener("ended", audioEnded);
    }

    if (isPageQuestionPlayingRef.current && questionGenEnabledRef.current) {
      setAwaitingQuestionAnswer(true);
      setShowAvatar(true);
      setInReinforcementLoop(true);
      reinforcementFromPageQuestionRef.current = true;
      isPageQuestionPlayingRef.current = false;
    } else if (isPageQuestionPlayingRef.current) {
      setAwaitingQuestionAnswer(false);
      isPageQuestionPlayingRef.current = false;
    }

    setIsAudioPlaying(false);
    setIsPageQuestionPlaying(false);
    setAudioHasEnded(true);
    setIsButtonDisabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, isPlaying]);

  const continueReading = useCallback(async (page, index, roles, isLastLine = false) => {
    if (!page || !page.text || index < 0 || index > page.text.length) {
      console.error(`Invalid args to continueReading: index=${index}`);
      return;
    }

    const line = page.text[index];
    const currentCharacter = roles.find(obj => obj.Character === line.Character);
    const currentVoiceName = currentCharacter?.VA || ""; // string voiceName or ""
    const currentRole = currentCharacter?.role || null;

    setChildHasPlayed(false);

    if (currentRole === "Parent" || currentRole === "Child" || currentRole === "Dummy") {
      if (index > 0) page.text[index - 1].Reading = false;
      page.text[index].Reading = true;

      if (isLastLine) {
        setTimeout(() => {
          setAudioHasEnded(true);
        }, 100);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    if (index > 0) page.text[index - 1].Reading = false;
    page.text[index].Reading = true;

    if (!currentVoiceName) {
      if (isLastLine) {
        setTimeout(() => {
          setAudioHasEnded(true);
        }, 100);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    const dialogue = stripSSMLTags(String(line.Dialogue || ""));
    if (!dialogue.trim()) {
      if (isLastLine) {
        setTimeout(() => {
          setAudioHasEnded(true);
        }, 100);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    const started = await speak(
      dialogue,
      currentVoiceName,
      "neutral",
      currentRole,
      AUDIO_SOURCES.STORY_NARRATION,
      {
        onBegin: () => console.log("TTS audio ready, starting playback..."),
        onEnded: () => {
          console.log("TTS ended");
          if (isLastLine) {
            console.log("[reading done] last line of page finished");
            line.Reading = false;
          }
        },
      }
    );

    if (!started) {
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEnded]);

  const resetGeneratedQuestionState = useCallback(() => {
    setRevealedQuestion('');
    fullQuestionTextRef.current = '';
    cumulativeAudioMsRef.current = 0;
    generatedQuestionAudioChunksRef.current = [];
    generatedQuestionAudioEndedRef.current = false;
    generatedQuestionAudioErrorRef.current = null;
    generatedQuestionPlayRequestedRef.current = false;
    suppressGeneratedAudioStreamRef.current = false;
    teardownStreamingPlayer();
    endAudio(AUDIO_SOURCES.GENERATED_QUESTION);
    setIsGeneratedQuestionPlaying(false);
    setIsThoughtRevealed(false);
    if (generatedQuestionAudioRef.current) {
      generatedQuestionAudioRef.current.pause();
      generatedQuestionAudioRef.current = null;
    }
    if (generatedQuestionAudioUrlRef.current) {
      URL.revokeObjectURL(generatedQuestionAudioUrlRef.current);
      generatedQuestionAudioUrlRef.current = null;
    }
  }, [teardownStreamingPlayer, endAudio]);

  return {
    // playback state
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    revealedQuestion,
    isThoughtRevealed,
    // refs needed by Story's orchestration effect
    isGeneratedQuestionPlayingRef,
    suppressGeneratedAudioStreamRef,
    // functions
    speak,
    continueReading,
    playSound,
    speakGenerated,
    startGeneratedQuestion,
    handleTestQuestionClick,
    handleAudioChunk,
    handleAudioEnd,
    handleAudioError,
    computeRevealLength,
    resetGeneratedQuestionState,
  };
}
