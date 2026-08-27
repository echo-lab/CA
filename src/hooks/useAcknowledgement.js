import { useState, useRef, useCallback } from "react";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { sendAcknowledgementLog, setAwaitingQuestionAnswer, buildBookContext, setAcknowledgementTurns, clearSpeculativeOffScript } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";

// Spoken aloud by the mate, not just printed: a silent failure looks identical to
// the app ignoring the child.
export const ANSWER_RETRY_TEXT = "Can you please say it again?";

export function useAcknowledgement({
  computeRevealLength,
  isAnyAudioPlaying,
  tryBeginAudio,
  endAudio,
  remoteAudioRef,
  isMuted,
  narratorRole,
  stateRef,
  lastAskedQuestionRef,
  lastExpectedAnswerRef,
  acknowledgementFromPageQuestionRef,
  generatedQuestionPendingRef,
  imageDescriptionRef,
  userAttentionRef,
  setQuestionHistory,
  setInAcknowledgementLoop,
  setAvatarPhase,
  setShowAvatar,
  setAnswerSubmitted,
  speak,
}) {
  const [isAcknowledgementPlaying, setIsAcknowledgementPlaying] = useState(false);
  const [revealedAcknowledgement, setRevealedAcknowledgement] = useState('');
  // Shown in place of the thinking dots while the mate asks for the answer again.
  const [answerRetryText, setAnswerRetryText] = useState('');

  const acknowledgementModeRef = useRef(false);
  const acknowledgementSessionRef = useRef({ question: null, turns: [] });
  const acknowledgementRequestSeqRef = useRef(0);
  const acknowledgementAudioRef = useRef(null);
  const acknowledgementStreamingPlayerRef = useRef(null);
  const acknowledgementAudioBlockedRef = useRef(false);
  const acknowledgementActiveRef = useRef(false);
  const fullAcknowledgementTextRef = useRef('');
  const cumulativeAcknowledgementMsRef = useRef(0);
  const silentCloseTimerRef = useRef(null);

  const stopAcknowledgementAudio = useCallback(() => {
    if (acknowledgementAudioRef.current) {
      acknowledgementAudioRef.current.pause();
      acknowledgementAudioRef.current = null;
    }
    if (silentCloseTimerRef.current) {
      clearTimeout(silentCloseTimerRef.current);
      silentCloseTimerRef.current = null;
    }
    if (acknowledgementStreamingPlayerRef.current) {
      try { acknowledgementStreamingPlayerRef.current.stop(); } catch {}
      acknowledgementStreamingPlayerRef.current = null;
    }
    acknowledgementAudioBlockedRef.current = false;
    acknowledgementActiveRef.current = false;
    setIsAcknowledgementPlaying(false);
    endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
  }, [endAudio]);


  const askAnswerAgain = useCallback((reason) => {
    studyLog.pushEvent({ event_type: 'answer_retry_prompt', detail: reason });
    stopAcknowledgementAudio();
    acknowledgementRequestSeqRef.current += 1;  // orphan anything still in flight
    acknowledgementModeRef.current = true;
    setAnswerRetryText(ANSWER_RETRY_TEXT);
    setShowAvatar(true);
    setInAcknowledgementLoop(true);
    setIsAcknowledgementPlaying(true);

    let done = false;
    const reopen = () => {
      if (done) return;
      done = true;
      setIsAcknowledgementPlaying(false);
      setAnswerRetryText('');           // line goes away, question comes back
      setAvatarPhase('question');       // restores the answer controls panel
      setAnswerSubmitted?.(false);      // manual send returns
      setAwaitingQuestionAnswer(true);  // mic counts as the answer again
    };

    Promise.resolve(
      speak?.(ANSWER_RETRY_TEXT, narratorRole?.VA || 'kore', 'neutral', narratorRole?.role || null,
        AUDIO_SOURCES.ACKNOWLEDGEMENT, { onEnded: reopen, onError: reopen })
    ).then((started) => {
      if (!started) reopen();
    }).catch(() => reopen());
  }, [speak, narratorRole, stopAcknowledgementAudio, setAvatarPhase,
      setShowAvatar, setInAcknowledgementLoop, setAnswerSubmitted]);

  const closeAcknowledgementMode = useCallback(() => {
    acknowledgementModeRef.current = false;
    setAnswerRetryText('');
    acknowledgementSessionRef.current = { question: null, turns: [] };
    setAcknowledgementTurns([]);
    acknowledgementRequestSeqRef.current += 1;
    stopAcknowledgementAudio();
    generatedQuestionPendingRef.current = false;
    setInAcknowledgementLoop(false);
    setAwaitingQuestionAnswer(false);
    if (remoteAudioRef.current && !isMuted) {
      remoteAudioRef.current.muted = false;
    }
  }, [isMuted, remoteAudioRef, stopAcknowledgementAudio, generatedQuestionPendingRef, setInAcknowledgementLoop]);

  const getCurrentPageAcknowledgementContext = (askedQuestion) => {
    const currentState = stateRef.current;
    const page = currentState.pagesValues[currentState.page];
    const bookText = buildBookContext(currentState.pagesValues, currentState.page);
    const isPageQuestion = !!page?.question && String(askedQuestion || '').trim() === page.question.trim();
    const expectedAnswer = isPageQuestion
      ? (page?.expectedAnswer ?? null)
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

  const playAcknowledgement = async (reply) => {
    // Deliberately not gated on isAnyAudioPlaying. The answer is already captured
    // by the time this runs, so returning here threw away what the child said —
    // silently, and on a value read up to 2.5s earlier (the manual-answer drain
    // resolves long after the click that closed the closure). Contention is
    // handled downstream instead: stopAcknowledgementAudio clears a prior
    // acknowledgement, and a busy lock falls back to showing the reply as text.
    if (isAnyAudioPlaying) {
      studyLog.pushEvent({ event_type: 'acknowledgement_while_audio_busy', detail: reply });
    }

    const currentState = stateRef.current;
    const pageQuestion = currentState.pagesValues[currentState.page]?.question || '';
    const question = lastAskedQuestionRef.current || acknowledgementSessionRef.current.question || pageQuestion;
    const requestSeq = acknowledgementRequestSeqRef.current + 1;

    acknowledgementRequestSeqRef.current = requestSeq;
    acknowledgementModeRef.current = true;
    setAvatarPhase('ack');
    generatedQuestionPendingRef.current = false;
    acknowledgementSessionRef.current = {
      question,
      turns: acknowledgementSessionRef.current.turns || [],
    };
    setAwaitingQuestionAnswer(false);
    stopAcknowledgementAudio();
    acknowledgementAudioBlockedRef.current = false;
    fullAcknowledgementTextRef.current = '';
    cumulativeAcknowledgementMsRef.current = 0;
    setRevealedAcknowledgement('');
    setQuestionHistory([]);

    try {
      const context = getCurrentPageAcknowledgementContext(question);

      const endAcknowledgementLoop = () => {
        acknowledgementModeRef.current = false;
        acknowledgementSessionRef.current.turns = [];
        setAcknowledgementTurns([]);
        setAwaitingQuestionAnswer(false);
        setQuestionHistory([]);
        setRevealedAcknowledgement('');
        fullAcknowledgementTextRef.current = '';
        setShowAvatar(false);
        setInAcknowledgementLoop(false);
        setAvatarPhase('question');
      };

      let settled = false;

      const finishStreamingAcknowledgement = () => {
        if (settled) return;
        settled = true;

        const heardAudio = !!acknowledgementStreamingPlayerRef.current;
        if (acknowledgementStreamingPlayerRef.current) {
          acknowledgementStreamingPlayerRef.current = null;
        }
        acknowledgementAudioBlockedRef.current = false;
        acknowledgementActiveRef.current = false;
        setIsAcknowledgementPlaying(false);
        cumulativeAcknowledgementMsRef.current = 0;
        endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
        if (remoteAudioRef.current && !isMuted) {
          remoteAudioRef.current.muted = false;
        }

        // TTS can fail after the text already arrived (quota, network), and the
        // audio lock can be held by another source. Closing right away would wipe
        // a line the child never heard, so leave it on screen to be read instead.
        if (!heardAudio && fullAcknowledgementTextRef.current) {
          setRevealedAcknowledgement(fullAcknowledgementTextRef.current);
          silentCloseTimerRef.current = setTimeout(() => {
            silentCloseTimerRef.current = null;
            if (requestSeq === acknowledgementRequestSeqRef.current) endAcknowledgementLoop();
          }, 3000);
          return;
        }

        endAcknowledgementLoop();
      };

      await sendAcknowledgementLog({
        question,
        reply,
        ...context,
        acknowledgementHistory: acknowledgementSessionRef.current.turns,
        ttsVoiceName: narratorRole?.VA || null,
        onAcknowledgementReady: (acknowledgement) => {
          if (requestSeq !== acknowledgementRequestSeqRef.current || !acknowledgementModeRef.current) return;
          if (!acknowledgement) {
            acknowledgementSessionRef.current.turns = [
              ...acknowledgementSessionRef.current.turns,
              { question, user: reply, response: '' },
            ];
            setAcknowledgementTurns(acknowledgementSessionRef.current.turns);
            return;
          }
          acknowledgementSessionRef.current.turns = [
            ...acknowledgementSessionRef.current.turns,
            { question, user: reply, response: acknowledgement },
          ];
          setAcknowledgementTurns(acknowledgementSessionRef.current.turns);
          clearSpeculativeOffScript();
          fullAcknowledgementTextRef.current = acknowledgement;
          cumulativeAcknowledgementMsRef.current = 0;
          setRevealedAcknowledgement('');
          const acknowledgementId = `ack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          studyLog.pushQuestion({
            question_id: acknowledgementId,
            question_type: 'acknowledgement',
            event: 'shown',
            question_text: acknowledgement,
            // expected_answer carries the question this turn is answering;
            // user_answer is what the child actually said (or, for a click
            // question, the phrasing built from where they clicked).
            expected_answer: question || '',
            user_answer: reply || '',
          });
          setQuestionHistory(prev => {
            const last = prev[prev.length - 1];
            if (last && last.type === 'acknowledgement') {
              return [...prev.slice(0, -1), { ...last, id: acknowledgementId, text: acknowledgement }];
            }
            return [...prev, { id: acknowledgementId, text: acknowledgement, type: 'acknowledgement' }];
          });
        },
        onAudioChunk: (seq, audioContent, durationMs) => {
          if (requestSeq !== acknowledgementRequestSeqRef.current || !acknowledgementModeRef.current) return;
          if (acknowledgementAudioBlockedRef.current) return;
          if (!acknowledgementStreamingPlayerRef.current) {
            if (!tryBeginAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT)) {
              acknowledgementAudioBlockedRef.current = true;
              setIsAcknowledgementPlaying(false);
              if (fullAcknowledgementTextRef.current) setRevealedAcknowledgement(fullAcknowledgementTextRef.current);
              return;
            }
            if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
            acknowledgementStreamingPlayerRef.current = createStreamingPcmPlayer({
              onEnded: finishStreamingAcknowledgement,
              onError: (err) => {
                console.error("Acknowledgement streaming player error:", err);
                finishStreamingAcknowledgement();
              },
            });
            setIsAcknowledgementPlaying(true);
            acknowledgementActiveRef.current = true;
            Promise.resolve(acknowledgementStreamingPlayerRef.current.resume()).catch((err) => {
              console.error("Acknowledgement Gemini TTS playback error:", err);
              finishStreamingAcknowledgement();
            });
          }
          acknowledgementStreamingPlayerRef.current.pushChunk(seq, audioContent);
          cumulativeAcknowledgementMsRef.current += Number(durationMs) || 0;
          if (fullAcknowledgementTextRef.current) {
            const cut = computeRevealLength(fullAcknowledgementTextRef.current, cumulativeAcknowledgementMsRef.current);
            setRevealedAcknowledgement(fullAcknowledgementTextRef.current.slice(0, cut));
          }
        },
        onAudioEnd: () => {
          if (requestSeq !== acknowledgementRequestSeqRef.current || !acknowledgementModeRef.current) return;
          if (acknowledgementAudioBlockedRef.current) {
            // Previously returned here, leaving the loop half-open with the
            // avatar up and nothing listening. The text was already revealed,
            // so settle the turn normally.
            acknowledgementAudioBlockedRef.current = false;
            finishStreamingAcknowledgement();
            return;
          }
          if (acknowledgementStreamingPlayerRef.current) acknowledgementStreamingPlayerRef.current.end();
          else finishStreamingAcknowledgement();
        },
        onAudioError: (message) => {
          console.error("Acknowledgement Gemini TTS stream error:", message);
          if (requestSeq === acknowledgementRequestSeqRef.current) finishStreamingAcknowledgement();
        },
      });

      // Safety net for a turn that produced no audio at all (empty model reply
      // or TTS that never emitted a chunk) — without it the loop stays open.
      if (requestSeq === acknowledgementRequestSeqRef.current && !acknowledgementStreamingPlayerRef.current && !acknowledgementAudioBlockedRef.current) {
        finishStreamingAcknowledgement();
      }
    } catch (error) {
      console.error("Acknowledgement generation/playback error:", error);
      if (requestSeq === acknowledgementRequestSeqRef.current) {
        acknowledgementAudioBlockedRef.current = false;
        setIsAcknowledgementPlaying(false);
        endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
        if (remoteAudioRef.current && !isMuted) {
          remoteAudioRef.current.muted = false;
        }
        // A thrown request used to close the loop out, leaving no sign the answer
        // went nowhere. Ask for it again instead.
        askAnswerAgain(`acknowledgement request failed: ${error?.message || error}`);
      }
    }
  };

  const resetAcknowledgementRevealState = useCallback(() => {
    setRevealedAcknowledgement('');
    setAnswerRetryText('');
    fullAcknowledgementTextRef.current = '';
    cumulativeAcknowledgementMsRef.current = 0;
  }, []);

  return {
    isAcknowledgementPlaying,
    answerRetryText,
    revealedAcknowledgement,
    acknowledgementModeRef,
    playAcknowledgement,
    askAnswerAgain,
    closeAcknowledgementMode,
    stopAcknowledgementAudio,
    resetAcknowledgementRevealState,
  };
}
