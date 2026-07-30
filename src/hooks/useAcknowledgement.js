import { useState, useRef, useCallback } from "react";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { say } from "../utils/ttsClient";
import { sendAcknowledgementLog, resetAcknowledgementSnapshot, setAwaitingQuestionAnswer, buildBookContext, setAcknowledgementTurns, clearSpeculativeOffScript } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";

export const PARENT_HANDOFF_LINE = "I see. That is a good answer. What does the parent think?";

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
  const acknowledgementStageRef = useRef('child');
  const handoffAudioRef = useRef(null);

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
    acknowledgementStageRef.current = 'child';
    setAcknowledgementTurns([]);
    acknowledgementRequestSeqRef.current += 1;
    resetAcknowledgementSnapshot();
    stopAcknowledgementAudio();
    generatedQuestionPendingRef.current = false;
    setInAcknowledgementLoop(false);
    setAwaitingQuestionAnswer(false);
    if (remoteAudioRef.current && !isMuted) {
      remoteAudioRef.current.muted = false;
    }
  }, [isMuted, remoteAudioRef, stopAcknowledgementAudio, generatedQuestionPendingRef, setInAcknowledgementLoop]);

  const getCurrentPageAcknowledgementContext = () => {
    const currentState = stateRef.current;
    const page = currentState.pagesValues[currentState.page];
    const bookText = buildBookContext(currentState.pagesValues, currentState.page);
    const expectedAnswer = acknowledgementFromPageQuestionRef.current
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
      const context = getCurrentPageAcknowledgementContext();

      const endAcknowledgementLoop = () => {
        acknowledgementModeRef.current = false;
        acknowledgementStageRef.current = 'child';
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

      const speakParentHandoff = async () => {
        acknowledgementStageRef.current = 'final';
        setAvatarPhase('question');

        const handoffId = `ack-handoff-${Date.now()}`;
        fullAcknowledgementTextRef.current = PARENT_HANDOFF_LINE;
        setRevealedAcknowledgement(PARENT_HANDOFF_LINE);
        setQuestionHistory([{ id: handoffId, text: PARENT_HANDOFF_LINE, type: 'acknowledgement' }]);
        setShowAvatar(true);
        studyLog.pushQuestion({
          question_id: handoffId,
          question_type: 'acknowledgement',
          event: 'shown',
          question_text: PARENT_HANDOFF_LINE,
          expected_answer: question || '',
          reason: 'handoff_to_parent',
        });

        let armed = false;
        const armForParent = () => {
          if (armed) return;
          armed = true;
          handoffAudioRef.current = null;
          endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
          setIsAcknowledgementPlaying(false);
          if (remoteAudioRef.current && !isMuted) remoteAudioRef.current.muted = false;
          if (requestSeq !== acknowledgementRequestSeqRef.current) return;
          setAwaitingQuestionAnswer(true);
        };

        if (!tryBeginAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT)) {
          // Text is already on screen; just start listening.
          setAwaitingQuestionAnswer(true);
          return;
        }

        try {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
          setIsAcknowledgementPlaying(true);
          const { audio } = await say({
            text: PARENT_HANDOFF_LINE,
            voiceName: narratorRole?.VA || 'kore',
            emotion: 'neutral',
            role: narratorRole?.role || null,
          });
          if (requestSeq !== acknowledgementRequestSeqRef.current) {
            try { audio?.pause(); } catch {}
            armForParent();
            return;
          }
          handoffAudioRef.current = audio || null;
          if (audio) {
            audio.addEventListener('ended', armForParent, { once: true });
            audio.addEventListener('error', armForParent, { once: true });
            if (audio.ended) armForParent();
          } else {
            armForParent();
          }
        } catch (err) {
          console.error('Parent handoff TTS failed:', err);
          armForParent();
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

        if (acknowledgementStageRef.current === 'child' && acknowledgementCorrectRef.current === false) {
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
        stage: acknowledgementStageRef.current,
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
            reason: acknowledgementStageRef.current === 'final'
              ? 'final_parent_turn'
              : (correct === false ? 'incorrect' : 'correct'),
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
        // A thrown request used to leave the loop stuck open. With a hard
        // two-turn cap that is a dead end, so close it out.
        acknowledgementModeRef.current = false;
        acknowledgementStageRef.current = 'child';
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
