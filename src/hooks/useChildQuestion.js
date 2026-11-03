import { useEffect, useRef, useState } from "react";
import { tapFromClick } from "../utils/clickGeometry";
import { streamAcknowledgement } from "../utils/InnerThoughtProcessStream";
import { cancelManualAnswer, endManualAnswer, setAwaitingQuestionAnswer } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";

export const ASK_TAP_PROMPT = "Can you tap it on the picture?";
export const ASK_GIVE_UP_TEXT = "Ask me again when you're ready.";
export const ASK_FAILED_TEXT = "Sorry, I couldn't work that out. Can you ask me again?";

// How long the flow waits in the quiet, before moving on for the child.
export const QUIET_NO_TAP_MS = 5000;        // no tap yet: then ask for one
export const QUIET_TAP_NO_SPEECH_MS = 4000; // tapped, nothing said: answer "what is this?"
export const QUIET_TAP_AFTER_SPEECH_MS = 1500; // tapped, then spoke: they have finished
export const TAP_PROMPT_WAIT_MS = 10000;    // after asking for a tap

const STREAM_ROUTE = "/api/ask-question-stream";

function stripSSMLTags(text) {
  return String(text || "").replace(/<\/?[^>]+(>|$)/g, "");
}

// The child's own question: press Ask, say it, tap the thing they mean.
//
//   idle -> listening -> thinking -> answering -> idle
//              |            ^
//              v            |
//           prompting -> awaitingTap -> closing -> idle
//
// For now every question is treated as "what is this?", so one with no tap always
// gets the prompt to tap. The mic window stays open until the answer starts, which is
// what stops the child's words advancing the reading line or starting a generated
// question.
export function useChildQuestion({
  book,
  stateRef,
  narratorRole,
  deepgramTranscript,
  inAcknowledgementLoop,
  playAcknowledgement,
  askAnswerAgain,
  closeAcknowledgementMode,
  resetAcknowledgementRevealState,
  stopSpeaking,
  dropPendingQuestion,
  setShowAvatar,
  setInAcknowledgementLoop,
  setAvatarPhase,
  setAnswerSubmitted,
  setQuestionHistory,
}) {
  const [askPhase, setAskPhaseState] = useState("idle");
  const [askTap, setAskTapState] = useState(null);

  const phaseRef = useRef("idle");
  const tapRef = useRef(null);
  const heardSpeechRef = useRef(false);
  const transcriptBaselineRef = useRef("");
  const spokenRef = useRef("");
  const abortRef = useRef(null);
  // Bumped whenever a turn ends, so work still awaiting from that turn can tell.
  const turnRef = useRef(0);

  const setAskPhase = (phase) => {
    phaseRef.current = phase;
    setAskPhaseState(phase);
  };
  const setAskTap = (tap) => {
    tapRef.current = tap;
    setAskTapState(tap);
  };

  const endTurn = () => {
    turnRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    cancelManualAnswer();
    setAskTap(null);
    setAskPhase("idle");
    closeAcknowledgementMode();
    resetAcknowledgementRevealState();
    setShowAvatar(false);
    setAnswerSubmitted(false);
    setAvatarPhase("question");
    setQuestionHistory([]);
  };

  const startAsk = () => {
    if (phaseRef.current !== "idle") return;
    dropPendingQuestion();
    turnRef.current += 1;
    heardSpeechRef.current = false;
    transcriptBaselineRef.current = deepgramTranscript;
    spokenRef.current = "";
    setAskTap(null);
    setAwaitingQuestionAnswer(true);
    setShowAvatar(true);
    setInAcknowledgementLoop(true);
    setAvatarPhase("question");
    setAskPhase("listening");
    studyLog.pushEvent({ event_type: "child_question_start", detail: `page ${stateRef.current.page + 1}` });
  };

  const submitQuestion = async () => {
    const phase = phaseRef.current;
    if (phase !== "listening" && phase !== "prompting" && phase !== "awaitingTap") return;
    const turn = turnRef.current;
    setAskPhase("thinking");
    setAnswerSubmitted(true);
    resetAcknowledgementRevealState();

    const tail = await endManualAnswer({ drainMs: heardSpeechRef.current ? undefined : 0 });
    if (turn !== turnRef.current) return;
    const transcript = [spokenRef.current, tail].filter(Boolean).join(" ");
    const tap = tapRef.current;
    const { pagesValues, page } = stateRef.current;

    const controller = new AbortController();
    abortRef.current = controller;
    studyLog.pushEvent({
      event_type: "child_question_submit",
      detail: `"${transcript}" @ ${tap.x},${tap.y}`,
    });

    const send = async ({ onAcknowledgementReady, onAudioChunk, onAudioEnd, onAudioError }) => {
      const result = await streamAcknowledgement({
        route: STREAM_ROUTE,
        requestBody: {
          book,
          currentPageNumber: page + 1,
          tap,
          transcript,
          bookText: pagesValues[page]?.text?.map((t) => stripSSMLTags(t.Dialogue)).join(" ") || "",
          ttsVoiceName: narratorRole?.VA || null,
        },
        onAcknowledgementReady,
        onAudioChunk,
        onAudioEnd,
        onAudioError,
        signal: controller.signal,
      });
      // The request failed. Say so on screen rather than closing as if nothing happened.
      if (!result?.acknowledgement && !controller.signal.aborted) {
        onAcknowledgementReady(ASK_FAILED_TEXT);
      }
      return result;
    };

    setAskPhase("answering");
    playAcknowledgement(transcript, { question: "", send, logType: "child_answer" });
  };

  const promptForTap = async () => {
    if (phaseRef.current !== "listening") return;
    const turn = turnRef.current;
    setAskPhase("prompting");
    setAnswerSubmitted(true);

    spokenRef.current = await endManualAnswer({ drainMs: heardSpeechRef.current ? undefined : 0 });
    if (turn !== turnRef.current) return;
    setAwaitingQuestionAnswer(true);

    askAnswerAgain("child_question_no_tap", {
      text: ASK_TAP_PROMPT,
      onSpoken: () => {
        if (turn !== turnRef.current) return;
        // A tap that landed during the prompt was already the answer to it.
        if (tapRef.current) {
          submitQuestion();
          return;
        }
        // Anything heard during the prompt may be the mate's own voice.
        cancelManualAnswer();
        setAwaitingQuestionAnswer(true);
        setAskPhase("awaitingTap");
      },
    });
  };

  const giveUp = () => {
    const turn = turnRef.current;
    cancelManualAnswer();
    setAwaitingQuestionAnswer(true);
    setAskPhase("closing");
    askAnswerAgain("child_question_gave_up", {
      text: ASK_GIVE_UP_TEXT,
      onSpoken: () => {
        if (turn === turnRef.current) endTurn();
      },
    });
  };

  const handleAskTap = (e) => {
    const phase = phaseRef.current;
    if (phase !== "listening" && phase !== "prompting" && phase !== "awaitingTap") return;
    const tap = tapFromClick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    if (!tap) return;
    setAskTap(tap);
    studyLog.pushEvent({ event_type: "child_question_tap", detail: `${tap.x},${tap.y}` });

    if (phase === "awaitingTap" || (phase === "listening" && heardSpeechRef.current)) {
      submitQuestion();
    }
    // Otherwise the tap comes first, so the quiet timer below waits for the words. While
    // the prompt is playing, onSpoken picks the tap up.
  };

  // The Send button: "I've finished talking."
  const handleAskSend = () => {
    if (tapRef.current) submitQuestion();
    else promptForTap();
  };

  // Ends the turn from outside: a page turn, a new line, or leaving the book.
  const cancelAsk = () => {
    const phase = phaseRef.current;
    if (phase === "idle") return;
    // These two are speaking through the shared TTS audio, which closing doesn't stop.
    if (phase === "prompting" || phase === "closing") stopSpeaking();
    studyLog.pushEvent({ event_type: "child_question_cancelled", detail: phase });
    endTurn();
  };

  useEffect(() => {
    if (askPhase !== "listening") return undefined;
    if (deepgramTranscript && deepgramTranscript !== transcriptBaselineRef.current) {
      heardSpeechRef.current = true;
    }
    const hasTap = Boolean(askTap);
    let wait = QUIET_NO_TAP_MS;
    if (hasTap) wait = heardSpeechRef.current ? QUIET_TAP_AFTER_SPEECH_MS : QUIET_TAP_NO_SPEECH_MS;
    const timer = setTimeout(() => {
      if (hasTap) submitQuestion();
      else promptForTap();
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPhase, askTap, deepgramTranscript]);

  useEffect(() => {
    if (askPhase !== "awaitingTap") return undefined;
    const timer = setTimeout(giveUp, TAP_PROMPT_WAIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPhase]);

  // The answer has finished once its acknowledgement loop closes.
  useEffect(() => {
    if (askPhase === "answering" && !inAcknowledgementLoop) endTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPhase, inAcknowledgementLoop]);

  return {
    askPhase,
    askTap,
    isAsking: askPhase !== "idle",
    canTapPicture: askPhase === "listening" || askPhase === "prompting" || askPhase === "awaitingTap",
    startAsk,
    handleAskTap,
    handleAskSend,
    cancelAsk,
  };
}
