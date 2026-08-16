import { useState, useRef, useCallback } from "react";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { say } from "../utils/ttsClient";
import { sendAcknowledgementLog, setAwaitingQuestionAnswer, buildBookContext, setAcknowledgementTurns, clearSpeculativeOffScript } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";
import { getParticipant } from "../utils/participant";

// Names the caregiver the way the roster does ("mom", "dad", …). Stable for a
// session, so the TTS warm-up in Story.js still hits the cache.
export const parentHandoffLine = () =>
  `That is an interesting idea. Do you want to talk about it with your ${getParticipant()?.['parent-figure'] || 'parent'}?`;

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
}) {
  const [isAcknowledgementPlaying, setIsAcknowledgementPlaying] = useState(false);
  const [revealedAcknowledgement, setRevealedAcknowledgement] = useState('');

  const acknowledgementModeRef = useRef(false);
  const acknowledgementSessionRef = useRef({ question: null, turns: [] });
  const acknowledgementRequestSeqRef = useRef(0);
  const acknowledgementAudioRef = useRef(null);
  const acknowledgementStreamingPlayerRef = useRef(null);
  const acknowledgementAudioBlockedRef = useRef(false);
  const acknowledgementActiveRef = useRef(false);
  const fullAcknowledgementTextRef = useRef('');
  const cumulativeAcknowledgementMsRef = useRef(0);
  const acknowledgementCorrectRef = useRef(null);
  const handoffAudioRef = useRef(null);
  const handoffCloseTimerRef = useRef(null);

  const stopAcknowledgementAudio = useCallback(() => {
    if (acknowledgementAudioRef.current) {
      acknowledgementAudioRef.current.pause();
      acknowledgementAudioRef.current = null;
    }
    if (handoffAudioRef.current) {
      try {
        handoffAudioRef.current.pause();
      } catch {}
      handoffAudioRef.current = null;
    }
    if (handoffCloseTimerRef.current) {
      clearTimeout(handoffCloseTimerRef.current);
      handoffCloseTimerRef.current = null;
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

  const closeAcknowledgementMode = useCallback(() => {
    acknowledgementModeRef.current = false;
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
    if (isAnyAudioPlaying) return;

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
    acknowledgementCorrectRef.current = null;
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

      // The handoff line is the last thing the system says. Once it has played,
      // the pair talks it over on their own, so the loop closes and question
      // generation resumes rather than listening for a parent reply.
      const speakParentHandoff = async () => {
        setAvatarPhase('question');

        const handoffId = `ack-handoff-${Date.now()}`;
        const handoffLine = parentHandoffLine();
        fullAcknowledgementTextRef.current = handoffLine;
        setRevealedAcknowledgement(handoffLine);
        setQuestionHistory([{ id: handoffId, text: handoffLine, type: 'acknowledgement' }]);
        setShowAvatar(true);
        studyLog.pushQuestion({
          question_id: handoffId,
          question_type: 'acknowledgement',
          event: 'shown',
          question_text: handoffLine,
          expected_answer: question || '',
          reason: 'handoff_to_parent',
        });

        let closed = false;
        const closeAfterHandoff = () => {
          if (closed) return;
          closed = true;
          handoffAudioRef.current = null;
          endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
          setIsAcknowledgementPlaying(false);
          if (remoteAudioRef.current && !isMuted) remoteAudioRef.current.muted = false;
          if (requestSeq !== acknowledgementRequestSeqRef.current) return;
          endAcknowledgementLoop();
        };

        if (!tryBeginAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT)) {
          // No speech to pace the line, so leave it on screen long enough to be
          // read before the avatar closes.
          handoffCloseTimerRef.current = setTimeout(() => {
            handoffCloseTimerRef.current = null;
            if (requestSeq === acknowledgementRequestSeqRef.current) endAcknowledgementLoop();
          }, 3000);
          return;
        }

        try {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
          setIsAcknowledgementPlaying(true);
          const { audio } = await say({
            text: handoffLine,
            voiceName: narratorRole?.VA || 'kore',
            emotion: 'neutral',
            role: narratorRole?.role || null,
          });
          if (requestSeq !== acknowledgementRequestSeqRef.current) {
            try { audio?.pause(); } catch {}
            closeAfterHandoff();
            return;
          }
          handoffAudioRef.current = audio || null;
          if (audio) {
            audio.addEventListener('ended', closeAfterHandoff, { once: true });
            audio.addEventListener('error', closeAfterHandoff, { once: true });
            if (audio.ended) closeAfterHandoff();
          } else {
            closeAfterHandoff();
          }
        } catch (err) {
          console.error('Parent handoff TTS failed:', err);
          closeAfterHandoff();
        }
      };

      let settled = false;

      const finishStreamingAcknowledgement = () => {
        if (settled) return;
        settled = true;

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

        if (acknowledgementCorrectRef.current === false) {
          speakParentHandoff();
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
        onAcknowledgementReady: (acknowledgement, correct) => {
          if (requestSeq !== acknowledgementRequestSeqRef.current || !acknowledgementModeRef.current) return;
          acknowledgementCorrectRef.current = correct === false ? false : true;
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
            expected_answer: question || '',
            reason: correct === false ? 'incorrect' : 'correct',
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

      // Fires when no audio was streamed at all — which is the normal path for
      // an incorrect child answer, since the server returns no text and so
      // synthesizes nothing.
      if (requestSeq === acknowledgementRequestSeqRef.current && !acknowledgementStreamingPlayerRef.current && !acknowledgementAudioBlockedRef.current) {
        finishStreamingAcknowledgement();
      }
    } catch (error) {
      console.error("Acknowledgement generation/playback error:", error);
      if (requestSeq === acknowledgementRequestSeqRef.current) {
        acknowledgementAudioBlockedRef.current = false;
        setIsAcknowledgementPlaying(false);
        if (fullAcknowledgementTextRef.current) setRevealedAcknowledgement(fullAcknowledgementTextRef.current);
        endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
        if (remoteAudioRef.current && !isMuted) {
          remoteAudioRef.current.muted = false;
        }
        // A thrown request used to leave the loop stuck open. There is no
        // further turn to recover into, so close it out.
        acknowledgementModeRef.current = false;
        setAwaitingQuestionAnswer(false);
        setInAcknowledgementLoop(false);
        setShowAvatar(false);
        setAvatarPhase('question');
      }
    }
  };

  const resetAcknowledgementRevealState = useCallback(() => {
    setRevealedAcknowledgement('');
    fullAcknowledgementTextRef.current = '';
    cumulativeAcknowledgementMsRef.current = 0;
  }, []);

  return {
    isAcknowledgementPlaying,
    revealedAcknowledgement,
    acknowledgementModeRef,
    playAcknowledgement,
    closeAcknowledgementMode,
    stopAcknowledgementAudio,
    resetAcknowledgementRevealState,
  };
}
