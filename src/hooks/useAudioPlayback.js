import { useState, useRef, useCallback, useEffect } from "react";
import { say, stopTts } from "../utils/ttsClient";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { setAwaitingQuestionAnswer } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";
import { isHumanRead } from "../utils/roles";

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
  setInAcknowledgementLoop,
  setAvatarPhase,
  hasSlidCloserRef,
  lastAskedQuestionRef,
  questionHistoryRef,
  acknowledgementFromPageQuestionRef,
  generatedQuestionPendingRef,
  questionGenEnabledRef,
  state,
  narratorRole,
}) {
  const isGeneratedQuestionPlayingRef = useRef(false);
  const isPageQuestionPlayingRef = useRef(false);
  // Correlates play/end events back to the question they belong to: none of
  // speakGenerated/playSound/finishGeneratedPlayback receive an id, only text.
  const currentQuestionIdRef = useRef(null);
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
  // The in-flight speak() call (lock source + listener detach), so an interrupt can release what the never-firing listener owed.
  const activeSpeechRef = useRef(null);

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

  // `reason` separates a genuine completion from the four error/degraded paths
  // that also land here, so "played" in the log means actually heard.
  const finishGeneratedPlayback = useCallback((questionText, reason = 'ended') => {
    // A clean finish is not logged: only the four error/degraded paths are, so a
    // row here always means something went wrong.
    if (reason !== 'ended') {
      studyLog.pushQuestion({
        question_id: currentQuestionIdRef.current || '',
        question_type: 'generated',
        event: 'play_failed',
        reason,
        question_text: questionText || '',
      });
    }
    if (remoteAudioRef.current && !isMuted) remoteAudioRef.current.muted = false;
    generatedQuestionPlayRequestedRef.current = false;
    setIsGeneratedQuestionPlaying(false);
    endAudio(AUDIO_SOURCES.GENERATED_QUESTION);
    if (questionText) lastAskedQuestionRef.current = questionText;
    setAwaitingQuestionAnswer(true);
    setShowAvatar(true);
    setInAcknowledgementLoop(true);
  }, [endAudio, isMuted, remoteAudioRef, generatedQuestionPlayRequestedRef, lastAskedQuestionRef, setShowAvatar, setInAcknowledgementLoop]);

  const createGeneratedQuestionPlayer = useCallback((questionText) => createStreamingPcmPlayer({
    onEnded: () => {
      finishGeneratedPlayback(questionText || fullQuestionTextRef.current);
    },
    onError: (err) => {
      console.error('streaming player error:', err);
      finishGeneratedPlayback(questionText || fullQuestionTextRef.current, 'player_error');
    },
  }), [finishGeneratedPlayback]);

  const pushBufferedGeneratedAudio = useCallback((player) => {
    const chunks = [...generatedQuestionAudioChunksRef.current]
      .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    chunks.forEach(({ seq, audioContent }) => {
      player.pushChunk(seq, audioContent);
    });
  }, []);

  // Shows a new generated question; audioChunks is the audio received so far, complete only when audioComplete is true.
  const startGeneratedQuestion = useCallback((questionText, { questionId, audioChunks = [], audioComplete = true } = {}) => {
    const text = String(questionText || '').trim();
    if (!text || isGeneratedQuestionPlayingRef.current) return;

    const qid = questionId || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    currentQuestionIdRef.current = qid;

    // Stop any previous question's player so its scheduled chunks don't keep sounding under the new question.
    const existing = streamingPlayerRef.current;
    if (existing) {
      try { existing.stop(); } catch {}
      streamingPlayerRef.current = null;
    }

    fullQuestionTextRef.current = text;
    generatedQuestionPendingRef.current = true;
    acknowledgementFromPageQuestionRef.current = false;
    cumulativeAudioMsRef.current = 0;
    // The chunk list may still be filling (handleAudioChunk / handleAudioEnd); an empty list means TTS failed only once audio is complete.
    generatedQuestionAudioChunksRef.current = [...audioChunks];
    generatedQuestionAudioEndedRef.current = audioComplete;
    generatedQuestionAudioErrorRef.current = (audioComplete && !audioChunks.length) ? 'no audio' : null;
    generatedQuestionPlayRequestedRef.current = false;
    suppressGeneratedAudioStreamRef.current = false;
    // Questions generated on this page, oldest first, so the next request avoids repeats; cleared on page change in Story.
    if (questionHistoryRef.current[questionHistoryRef.current.length - 1] !== text) {
      questionHistoryRef.current.push(text);
    }
    setRevealedQuestion('');
    setIsThoughtRevealed(false);
    setAvatarPhase('question');
    setGeneratedQuestion(text);
    setQuestionHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.type === "generated") {
        if (last.text === text) return prev;
        // Mint a fresh id so two generated questions on one page stay distinguishable in the log.
        studyLog.pushQuestion({
          question_id: qid,
          question_type: "generated",
          event: "replaced",
          question_text: text,
          reason: last.id,
        });
        // Keep slot (render identity) so React doesn't replay the slide-in; the id still changes for the study log.
        return [...prev.slice(0, -1), { ...last, id: qid, text }];
      }
      return [
        ...prev,
        {
          id: qid,
          slot: qid,
          text,
          type: "generated",
        },
      ];
    });

    studyLog.pushQuestion({
      question_id: qid,
      question_type: "generated",
      event: "shown",
      question_text: text,
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
    // Drop partial audio after a mid-stream failure and mark it ended, so a tap takes the tts_unavailable path instead of hanging.
    generatedQuestionAudioChunksRef.current = [];
    generatedQuestionAudioEndedRef.current = true;
    if (fullQuestionTextRef.current) setRevealedQuestion(fullQuestionTextRef.current);
    if (generatedQuestionPlayRequestedRef.current) {
      finishGeneratedPlayback(fullQuestionTextRef.current);
    }
    teardownStreamingPlayer();
  }, [finishGeneratedPlayback, teardownStreamingPlayer]);

  // Records a play attempt outcome against the question currently on screen.
  const logPlay = (event, reason, text) => {
    studyLog.pushQuestion({
      question_id: currentQuestionIdRef.current || '',
      question_type: 'generated',
      event,
      reason: reason || '',
      question_text: text || '',
    });
  };

  const speakGenerated = () => {

    if (isGeneratedQuestionPlaying) {
      logPlay('play_failed', 'already_playing', generatedQuestion || '');
      return;
    }

    const cachedQuestion = generatedQuestion;
    if (!cachedQuestion) {
      logPlay('play_failed', 'no_cached_question', '');
      return;
    }

    const audioError = generatedQuestionAudioErrorRef.current;
    const hasChunks = generatedQuestionAudioChunksRef.current.length > 0;
    if (audioError && !hasChunks) {
      console.warn('Generated question Gemini TTS unavailable:', audioError);
      // Note this path still advances into the acknowledgement loop, so the
      // question counts as asked despite never having been heard.
      finishGeneratedPlayback(cachedQuestion, 'tts_unavailable');
      return;
    }

    const existing = streamingPlayerRef.current;
    if (existing && existing.isFinished?.()) {
      try { existing.stop(); } catch {}
      streamingPlayerRef.current = null;
    }

    if (!tryBeginAudio(AUDIO_SOURCES.GENERATED_QUESTION)) {
      logPlay('play_failed', 'audio_lock_busy', cachedQuestion);
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
      finishGeneratedPlayback(cachedQuestion, 'resume_failed');
    });

    if (generatedQuestionAudioEndedRef.current) {
      streamingPlayerRef.current.end();
    }
  };

  const playSound = () => {
    // Page questions use the mate's voice, like generated questions and acknowledgements, not the Narrator reader's.
    const voiceName = narratorRole?.VA || "kore";
    const role = narratorRole?.role || null;
    const question = state.pagesValues[state.page].question;
    const pageQuestionId = `page-${state.page}`;
    currentQuestionIdRef.current = pageQuestionId;

    const logPagePlay = (event, reason) => {
      studyLog.pushQuestion({
        question_id: pageQuestionId,
        question_type: 'page',
        event,
        reason: reason || '',
        question_text: question || '',
      });
    };

    logPagePlay('play_requested');
    // speak() resolves false when the lock is held (no onBegin/onError), so check the result or the blocked click is invisible.
    Promise.resolve(
      speak(question, voiceName, "neutral", role, AUDIO_SOURCES.PAGE_QUESTION, {
        onBegin: () => {
          logPagePlay('play_started');
          setIsPageQuestionPlaying(true);
          isPageQuestionPlayingRef.current = true;
          lastAskedQuestionRef.current = question;
          if (!showAvatarRef.current) {
            hasSlidCloserRef.current = false;
          }
          setShowAvatar(true);
        },
        onError: () => {
          logPagePlay('play_failed', 'tts_error');
          setIsPageQuestionPlaying(false);
          isPageQuestionPlayingRef.current = false;
        },
      })
    ).then((ok) => {
      if (ok === false) logPagePlay('play_failed', 'audio_lock_busy');
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

    // One shared <audio>, one lock, one live utterance: anything still attached
    // from an earlier call is stale by definition.
    activeSpeechRef.current?.detach();
    // Claimed BEFORE the await: say() calls play() itself, so an interrupt that
    // lands while the TTS request is still in flight has to be able to cancel it.
    const claim = { source, cancelled: false, detach: () => {} };
    activeSpeechRef.current = claim;

    try {
      options.onBegin?.();
      setIsAudioPlaying(true);

      const { audio: audioEl } = await say({
        text: clean,
        voiceName,
        emotion,
        role,
      });

      if (claim.cancelled) {
        // Interrupted mid-fetch. say() has already started playback, and
        // stopSpeaking already released the lock, so silence it and owe nothing.
        stopTts();
        return false;
      }

      const handleEnded = () => {
        detach();
        endAudio(source);
        options.onEnded?.();
        audioEnded();
      };
      const handleError = () => {
        detach();
        endAudio(source);
        options.onError?.();
        audioEnded();
      };
      // Removes the exact listener pair that was added (identity is what matters); called on interrupt when neither will fire.
      const detach = () => {
        audioEl.removeEventListener("ended", handleEnded);
        audioEl.removeEventListener("error", handleError);
        if (activeSpeechRef.current === claim) activeSpeechRef.current = null;
      };
      claim.detach = detach;

      setAudio(audioEl);
      audioEl.addEventListener("ended", handleEnded, { once: true });
      audioEl.addEventListener("error", handleError, { once: true });
      if (audioEl.ended) handleEnded();
      return true;
    } catch (err) {
      // A request that rejects after the user already left and came back must not
      // release the lock the new mount legitimately holds.
      if (claim.cancelled) return false;
      console.error("TTS error:", err);
      if (activeSpeechRef.current === claim) activeSpeechRef.current = null;
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

    if (isPageQuestionPlayingRef.current && questionGenEnabledRef.current) {
      setAwaitingQuestionAnswer(true);
      setShowAvatar(true);
      setInAcknowledgementLoop(true);
      acknowledgementFromPageQuestionRef.current = true;
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

    if (isHumanRead(currentRole)) {
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

  // pause() fires neither ended nor error, so release the lock here or it stays held forever and the Next button deadlocks.
  const stopSpeaking = useCallback(() => {
    const claim = activeSpeechRef.current;
    activeSpeechRef.current = null;
    if (claim) {
      claim.cancelled = true;  // an in-flight say() will neither attach nor play
      claim.detach();          // the pair pause() will never consume
      endAudio(claim.source);
    }
    stopTts();

    if (isPageQuestionPlayingRef.current) {
      isPageQuestionPlayingRef.current = false;
      setIsPageQuestionPlaying(false);
    }
    setIsAudioPlaying(false);
    setIsButtonDisabled(false);
    // Deliberately NOT setAudioHasEnded(true): that is the auto-advance trigger
    // in useStoryNavigation, and an interrupt must not turn the page.
  }, [endAudio, setIsPageQuestionPlaying, setIsAudioPlaying, setIsButtonDisabled]);

  return {
    // playback state
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    revealedQuestion,
    isThoughtRevealed,
    // refs needed by Story's orchestration effect
    isGeneratedQuestionPlayingRef,
    suppressGeneratedAudioStreamRef,
    generatedQuestionAudioEndedRef,
    // functions
    speak,
    stopSpeaking,
    continueReading,
    playSound,
    speakGenerated,
    startGeneratedQuestion,
    handleAudioChunk,
    handleAudioEnd,
    handleAudioError,
    computeRevealLength,
    resetGeneratedQuestionState,
  };
}
