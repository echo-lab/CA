import "../styles/Story.css";
import React, { useState, useRef, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLocation, useNavigate } from 'react-router-dom';
// Book Data
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
// Components
import QuestionAvatar from "../components/QuestionAvatar";
import DialogueList from "../components/DialogueList";
import PageIllustration from "../components/PageIllustration";
import StoryBar from "../components/StoryBar";
// Hooks
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useAcknowledgement } from "../hooks/useAcknowledgement";
import { useStoryNavigation } from "../hooks/useStoryNavigation";
import { usePreloadPageAudio } from "../hooks/usePreloadPageAudio";
// Utils
import { stripSSMLTags } from "../utils/textNormalizer";
import { unlockTtsAudio } from "../utils/ttsClient";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import { ImageAnalysis, ImageTagging, prefetchPage } from "../utils/imageAnalysis";
import { processUserUtterance, abortCurrentCategorization, abortQuestionGeneration, setAwaitingQuestionAnswer, setCurrentBookId, endManualAnswer, cancelManualAnswer, isManualAnswerActive, setClickTags } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";
import { getRoleKind } from "../utils/roles";
import { roles as MATE_DEFINITIONS } from "../Book/Roles";
import { generateQuestionOnDemand } from "../utils/InnerThoughtProcessStream";

class Book {
  constructor(data) {
    this.name = data.Book.Name;
    this.characters = data.Book.Characters;
    this.pages = data.Book.Pages;
  }
};

// One fixed mate voices and shows every question; module scope keeps it stable for the useEffect dependency.
const QUESTION_MATE_DEF = MATE_DEFINITIONS.find((r) => r.questionMate);
const QUESTION_MATE_NAME = QUESTION_MATE_DEF?.Role;
const QUESTION_MATE = QUESTION_MATE_DEF && {
  role: QUESTION_MATE_DEF.Role,
  VA: QUESTION_MATE_DEF.RoleParameter,
  img: QUESTION_MATE_DEF.img,
  voiceColor: QUESTION_MATE_DEF.voiceColor,
};

function Reader() {
  const previewOnly = process.env.REACT_APP_PREVIEW_ONLY === 'true';
  const location = useLocation();
  const navigate = useNavigate();
  const [, setIsAudioPlaying] = useState(false);
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  // Default to an array: call sites use .find(), which fails when /story opens without router state.
  const selectedOptions = Array.isArray(location.state?.selectedOptions)
    ? location.state.selectedOptions
    : [];
  const id = location.state ? location.state.id : {};
  const name = location.state?.name || null;
  const isTraining = location.state?.training === true;
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);

  useEffect(() => {
    const unlock = () => { unlockTtsAudio(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchend", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchend", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  // Quiet time after the last transcript before the send button starts blinking.
  const SILENCE_BLINK_MS = 5000;
  // How long after the last transcript fragment the mic still counts as hearing speech.
  const SPEAKING_IDLE_MS = 900;
  const DEEPGRAM_ENABLED = true;
  const GEMINI_Enabled = true;

  const QUESTION_GEN_ENABLED = true;

  const mateFrames = {
    [QUESTION_MATE_NAME]: [
      require("../Pictures/Mate09/Mates-09.png"),
      require("../Pictures/Mate09/Mates-09-1.png"),
      require("../Pictures/Mate09/Mates-09-2.png"),
      require("../Pictures/Mate09/Mates-09-3.png"),
    ],
  };

  const mateListeningImage = require("../Pictures/Mate09/Mates-09-L.png")
  const narratorRole = QUESTION_MATE;
  const narratorImage = narratorRole?.img;
  const frames = narratorRole ? mateFrames[narratorRole.role] : [narratorImage];
  const listeningImage = (narratorRole && mateListeningImage || narratorImage);

  const {
    geminiLiveConnect,
    geminiLiveDisconnect,
    isMuted,
    userUtterance,
    speakerLabels,
    remoteAudioRef,
    connectToDeepgram,
    disconnectDeepgram,
    isGeminiAudioPlaying,
    deepgramTranscript,
    isAnyAudioPlaying,
    activeAudioSource,
    tryBeginAudio,
    endAudio,
  } = useAudioStreamControl();

  let bookData

  switch (id) {
    case 1:
      bookData = data1;
      break;
    case 2:
      bookData = data2;
      break;
    case 3:
      bookData = data3;
      break;
    default:
      throw new Error("Invalid book id");
  }

  var CurrentBook = new Book(bookData[0]);

  const allKeys = Object.keys(CurrentBook.pages);
  const allValues = Object.values(CurrentBook.pages);
  const pagesKeys = previewOnly ? allKeys.slice(0, 3) : allKeys;
  const pagesValues = previewOnly ? allValues.slice(0, 3) : allValues;

  const [state, setState] = useState({
    page: 0,
    index: 0,
    CharacterRoles: selectedOptions,
    pagesKeys,
    pagesValues,
    isVolumnOn: false,
    hasReachedEnd: false
  });
  const stateRef = useRef(state);

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioHasEnded, setAudioHasEnded] = useState(false);
  const [generatedQuestion, setGeneratedQuestion] = useState(null);

  const [questionHistory, setQuestionHistory] = useState([]);
  const [showAvatar, setShowAvatar] = useState(false);
  const [inAcknowledgementLoop, setInAcknowledgementLoop] = useState(false);
  const [avatarPhase, setAvatarPhase] = useState('question');
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  // Blink the send button after enough quiet since the last transcript (Deepgram finals lag 0.3-2.4s behind speech).
  const [sendBlink, setSendBlink] = useState(false);
  // Whether the mic is hearing speech right now — drives the pulse animation.
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const showAvatarRef = useRef(false);
  useEffect(() => { showAvatarRef.current = showAvatar; }, [showAvatar]);

  const inAcknowledgementLoopRef = useRef(false);
  useEffect(() => { inAcknowledgementLoopRef.current = inAcknowledgementLoop; }, [inAcknowledgementLoop]);
  // Reset on both opening and closing the loop, or the thinking dots return after the acknowledgement finished.
  useEffect(() => { setAnswerSubmitted(false); }, [inAcknowledgementLoop]);

  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
  const hasSlidCloserRef = useRef(false);
  const dismissingQuestionRef = useRef(null);
  const wasGeminiAudioPlayingRef = useRef(false);
  const imageDescriptionRef = useRef(null);
  const [imageTags, setImageTags] = useState([]);
  // The tag whose region answers the pending click question. Null on every other
  // book and whenever the pending question is a spoken one.
  const [clickTarget, setClickTarget] = useState(null);
  const userAttentionRef = useRef(null);
  const questionHistoryRef = useRef([]);
  const lastAskedQuestionRef = useRef(null);
  const lastExpectedAnswerRef = useRef(null);
  const generatedQuestionPendingRef = useRef(false);
  const acknowledgementFromPageQuestionRef = useRef(false);

  const lastProcessedUtteranceRef = useRef("");
  const userUtterancesRef = useRef([]);
  const accumulatedUtterancesRef = useRef([]);
  const utteranceQueuesRef = useRef([]);
  const currentLineTrackingRef = useRef({ page: -1, index: -1 });
  const offScriptLogRef = useRef([]);

  const {
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    revealedQuestion,
    isThoughtRevealed,
    isGeneratedQuestionPlayingRef,
    suppressGeneratedAudioStreamRef,
    generatedQuestionAudioEndedRef,
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
  } = useAudioPlayback({
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
  });

  const {
    isAcknowledgementPlaying,
    answerRetryText,
    revealedAcknowledgement,
    acknowledgementModeRef,
    playAcknowledgement,
    askAnswerAgain,
    closeAcknowledgementMode,
    resetAcknowledgementRevealState,
  } = useAcknowledgement({
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
  });

  const clearQuestionUI = () => {
    closeAcknowledgementMode();
    abortCurrentCategorization();
    setAwaitingQuestionAnswer(false);
    setGeneratedQuestion(null);
    setClickTarget(null);
    setGeneratingQuestion(false);
    resetGeneratedQuestionState();
    setShowAvatar(false);
    setQuestionHistory([]);
    resetAcknowledgementRevealState();
    setAvatarPhase('question');
    acknowledgementFromPageQuestionRef.current = false;
    lastExpectedAnswerRef.current = null;
    hasSlidCloserRef.current = false;
    dismissingQuestionRef.current = null;
    cancelManualAnswer();
    setAnswerSubmitted(false);
  };

  // One press, not two: the mic has been capturing since the question ended, so
  // this only means "that was my answer, send it".
  const handleAnswerSubmit = async () => {
    setAnswerSubmitted(true);
    const answer = await endManualAnswer();
    studyLog.pushEvent({ event_type: 'manual_answer_end', detail: answer });
    if (answer) {
      playAcknowledgement(answer);
    } else {
      // A silent answer: the press happened but nothing was transcribed. Ask again
      // rather than dropping the child back to a send button with no explanation.
      studyLog.pushEvent({ event_type: 'manual_answer_empty', detail: 'no transcript captured' });
      askAnswerAgain('no transcript captured');
    }
  };

  // A click question is answered by clicking the picture, not by talking. The
  // click counts only while that question is actually pending an answer.
  const clickAnswersQuestion = !!clickTarget && inAcknowledgementLoop && !answerSubmitted;

  // Called by PageIllustration with the already-scored click.
  const handleImageAnswerClick = ({ correct, distance, reason, hitLabel, xPct, yPct }) => {
    setAnswerSubmitted(true);
    cancelManualAnswer(); // nothing spoken counts as the answer here
    studyLog.pushEvent({
      event_type: 'click_answer',
      detail: `${correct ? 'hit' : 'miss'}(${reason}) ${clickTarget.label}`
        + `${hitLabel ? ` -> ${hitLabel}` : ''}`
        + ` @ ${xPct.toFixed(1)}%,${yPct.toFixed(1)}% d=${distance == null ? 'n/a' : Math.round(distance)}`,
    });
    userAttentionRef.current = correct ? clickTarget.label : (hitLabel || clickTarget.label);

    // The acknowledgement is written from what the child did, so it can affirm a
    // hit or gently redirect a miss without ever being told to grade.
    playAcknowledgement(correct
      ? `I clicked on the ${clickTarget.label}.`
      : hitLabel
        ? `I clicked on the ${hitLabel} instead of the ${clickTarget.label}.`
        : `I clicked somewhere else in the picture, not the ${clickTarget.label}.`);
  };

  // Logs a question the model produced and returns its id; reason marks where it came from.
  const logGeneratedQuestion = (questionText, expectedAnswer, reason) => {
    const questionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    studyLog.pushQuestion({
      question_id: questionId,
      question_type: 'generated',
      event: 'generated',
      question_text: questionText,
      expected_answer: expectedAnswer ?? '',
      ...(reason ? { reason } : {}),
    });
    return questionId;
  };

  // Puts a generated question on screen; click is present only for a click question, and is always a real tag's box.
  const beginQuestion = (questionId, questionText, expectedAnswer, click, audioChunks, audioComplete) => {
    lastExpectedAnswerRef.current = expectedAnswer ?? null;
    setClickTarget(click?.answerBox ? { label: click.answerLabel, box_2d: click.answerBox } : null);
    startGeneratedQuestion(questionText, { questionId, audioChunks, audioComplete });
  };

  const manualQuestionPendingRef = useRef(false);
  const manualQuestionAbortRef = useRef(null);
  const [generatingQuestion, setGeneratingQuestion] = useState(false);

  // Committing to the on-screen question cancels generation behind it, so nothing replaces it mid-answer.
  const stopQuestionGeneration = (why) => {
    let stopped = abortQuestionGeneration();
    if (manualQuestionAbortRef.current) {
      manualQuestionAbortRef.current.abort();
      manualQuestionAbortRef.current = null;
      stopped = true;
    }
    manualQuestionPendingRef.current = false;
    setGeneratingQuestion(false);
    if (stopped) studyLog.pushEvent({ event_type: 'question_generation_cancelled', detail: why });
    return stopped;
  };

  // The reader tapped the question that is already showing.
  const handleSpeakGenerated = () => {
    // Only cancel work that would replace this question; aborting its own still-streaming audio would cut it off.
    if (generatedQuestionAudioEndedRef.current) stopQuestionGeneration('question_committed');
    speakGenerated();
  };
  const requestQuestion = async () => {
    if (manualQuestionPendingRef.current) return;
    if (isGeneratedQuestionPlayingRef.current || isManualAnswerActive() || acknowledgementModeRef.current) {
      studyLog.pushEvent({ event_type: 'manual_question_blocked', detail: 'audio or answer in progress' });
      return;
    }
    manualQuestionPendingRef.current = true;
    const controller = new AbortController();
    manualQuestionAbortRef.current = controller;
    setGeneratingQuestion(true);
    studyLog.pushEvent({ event_type: 'manual_question_request', detail: `page ${state.page + 1}` });

    const page = stateRef.current.pagesValues[stateRef.current.page];
    const pageIndex = stateRef.current.page;
    try {
      await generateQuestionOnDemand({
        book: id,
        currentPageNumber: pageIndex + 1,
        currentPageQuestion: page?.question || '',
        bookText: page?.text?.map(t => stripSSMLTags(t.Dialogue)).join(' ') || '',
        imageDescription: await (imageDescriptionRef.current ?? Promise.resolve(null)),
        userAttention: userAttentionRef.current,
        questionHistory: questionHistoryRef.current,
        systemQuestions: stateRef.current.pagesValues.map(p => (p?.question || '').trim()).filter(Boolean),
        clickTags: imageTags,
        ttsVoiceName: narratorRole?.VA || null,
        onQuestionReady: (questionText, expectedAnswer, click, audioChunks, reason, audioComplete = true) => {
          // The reader may have moved on while the model was thinking.
          if (stateRef.current.page !== pageIndex) return;
          const questionId = logGeneratedQuestion(questionText, expectedAnswer, 'manual');
          setGeneratingQuestion(false);
          beginQuestion(questionId, questionText, expectedAnswer, click, audioChunks, audioComplete);
        },
        onAudioChunk: handleAudioChunk,
        onAudioEnd: handleAudioEnd,
        onAudioError: handleAudioError,
        signal: controller.signal,
      });
    } finally {
      // Only clear if this request is still the current one: a newer request may
      // have replaced it while this one was in flight.
      if (manualQuestionAbortRef.current === controller) manualQuestionAbortRef.current = null;
      manualQuestionPendingRef.current = false;
      // Safety net: covers a request that produced nothing, or failed outright.
      setGeneratingQuestion(false);
    }
  };

  const clearQuestionUIRef = useRef(clearQuestionUI);
  useEffect(() => { clearQuestionUIRef.current = clearQuestionUI; });
  
  const {
    gotoNextPage,
    gotoPreviousPage,
    handlePlayClick,
    jumpToLine,
    markNextLineChangeAutomatic,
  } = useStoryNavigation({
    state,
    setState,
    isPlaying,
    setIsPlaying,
    audioHasEnded,
    setAudioHasEnded,
    setIsButtonDisabled,
    continueReading,
    clearQuestionUI,
    clearQuestionUIRef,
    offScriptLogRef,
    dialogueRefs,
    tableContainerRef,
    navigate,
    name,
    id,
    isAnyAudioPlaying,
    generatedQuestion,
    showAvatar,
    showAvatarRef,
    inAcknowledgementLoopRef,
    generatedQuestionPendingRef,
  });

  useEffect(() => {
    if (DEEPGRAM_ENABLED) connectToDeepgram();
    if (GEMINI_Enabled) geminiLiveConnect({ voiceName: narratorRole?.VA });
    return () => {
      disconnectDeepgram();
      geminiLiveDisconnect();
    };
  }, []);

  useEffect(() => { setCurrentBookId(id); }, [id]);

  // Every book can get a click question, so every book sends its tags. The
  // server flips a coin per question; with no usable tags it asks a spoken one.
  useEffect(() => {
    setClickTags(imageTags);
  }, [id, imageTags]);

  useEffect(() => {
    const pageText = state.pagesValues[state.page]?.text
      ?.map(t => stripSSMLTags(t.Dialogue)).join(' ') || '';
    userAttentionRef.current = null;
    questionHistoryRef.current = [];
    lastExpectedAnswerRef.current = null;
    lastAskedQuestionRef.current = null;
    setImageTags([]);
    setClickTarget(null);
    if (state.page > 0) {
      imageDescriptionRef.current = ImageAnalysis({ book: id, page: state.page, pageText });
      ImageTagging({ book: id, page: state.page, pageText }).then(tags => setImageTags(tags));
      prefetchPage(id, state.pagesValues, state.page);
    } else {
      imageDescriptionRef.current = Promise.resolve(null);
    }
  }, [state.page, id]);

  useEffect(() => {
    setQuestionHistory([]);
    setShowAvatar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page]);

  usePreloadPageAudio(state, narratorRole);

  useEffect(() => {
    const wasPlaying = wasGeminiAudioPlayingRef.current;
    if (wasPlaying && !isGeminiAudioPlaying && dismissingQuestionRef.current) {
    }
    wasGeminiAudioPlayingRef.current = isGeminiAudioPlaying;
  }, [isGeminiAudioPlaying]);

  useEffect(() => { stateRef.current = state; });

  // Stop narration on unmount; the shared <audio> and lock outlive the component, or Next stays dead on return.
  useEffect(() => () => {
    stopSpeaking();
    // Covers the streaming-PCM player, the acknowledgement audio, and the
    // module-level awaiting-answer flag — all already handled by this one call.
    clearQuestionUIRef.current();
    // Clear the Reading flag on unmount; pagesValues is shared with the Book module and outlives this component.
    const page = stateRef.current?.pagesValues?.[stateRef.current.page];
    for (let i = 0; i < (page?.text?.length || 0); i++) page.text[i].Reading = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    studyLog.startSession({
      bookId: id,
      bookName: CurrentBook.name,
      isTraining,
      characterRoles: selectedOptions,
    });
    return () => {
      studyLog.endSession({ pagesReached: stateRef.current?.page ?? "" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const line = state.pagesValues[state.page]?.text?.[state.index - 1];
    const assigned = state.CharacterRoles.find((o) => o.Character === line?.Character);
    studyLog.setContext({
      page_index: state.page,
      line_index: state.index,
      expected_character: line?.Character ?? "",
      expected_role: assigned?.role ?? "",
      expected_role_kind: assigned?.roleKind ?? (assigned ? getRoleKind(assigned.role) : ""),
    });
  }, [state.page, state.index, state.pagesValues, state.CharacterRoles]);

  useEffect(() => {
    const CACHED_AUDIO_SOURCES = [
      AUDIO_SOURCES.TTS,
      AUDIO_SOURCES.STORY_NARRATION,
      AUDIO_SOURCES.PAGE_QUESTION,
      AUDIO_SOURCES.GENERATED_QUESTION,
    ];
    if (CACHED_AUDIO_SOURCES.includes(activeAudioSource)) return;

    processUserUtterance({
      userUtterance,
      lastProcessedUtteranceRef,
      accumulatedUtterancesRef,
      utteranceQueuesRef,
      currentLineTrackingRef,
      offScriptLogRef,
      state: stateRef.current,
      speakerLabels,
      jumpToLine,
      setAudioHasEnded,
      setIsPlaying,
      onAutoLineAdvance: markNextLineChangeAutomatic,
      onQuestionReady: (questionText, expectedAnswer = null, click = null, audioChunks = [], reason = '', audioComplete = true) => {
        if (!questionGenEnabledRef.current) return;

        // Logged before the suppression check so the record reflects every
        // question the model actually produced, not only the ones shown.
        const questionId = logGeneratedQuestion(questionText, expectedAnswer);

        if (isGeneratedQuestionPlayingRef.current) {
          suppressGeneratedAudioStreamRef.current = true;
          studyLog.pushQuestion({
            question_id: questionId,
            question_type: "generated",
            event: "suppressed",
            reason: "already_playing",
            question_text: questionText,
          });
          return;
        }

        // Drop a response already parsed when the answer window opened, so it can't replace the question being answered.
        if (isManualAnswerActive() || acknowledgementModeRef.current) {
          suppressGeneratedAudioStreamRef.current = true;
          studyLog.pushQuestion({
            question_id: questionId,
            question_type: "generated",
            event: "suppressed",
            reason: isManualAnswerActive() ? "answering" : "acknowledging",
            question_text: questionText,
          });
          return;
        }
        beginQuestion(questionId, questionText, expectedAnswer, click, audioChunks, audioComplete);
      },
      imageDescriptionRef,
      userAttentionRef,
      questionHistoryRef,
      ttsVoiceName: narratorRole?.VA || null,
      onAudioChunk: handleAudioChunk,
      onAudioEnd: handleAudioEnd,
      onAudioError: handleAudioError,
      questionGenEnabledRef,
      isAcknowledgementModeRef: acknowledgementModeRef,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userUtterance]);

  // True while interim transcripts keep arriving (every few hundred ms), lapsing in gaps; finals arrive too late for this.
  useEffect(() => {
    if (!inAcknowledgementLoop || answerSubmitted || !deepgramTranscript) {
      setIsUserSpeaking(false);
      return;
    }
    setIsUserSpeaking(true);
    const timer = setTimeout(() => setIsUserSpeaking(false), SPEAKING_IDLE_MS);
    return () => clearTimeout(timer);
  }, [deepgramTranscript, inAcknowledgementLoop, answerSubmitted, SPEAKING_IDLE_MS]);

  // Keyed on interims, not finals: a final only lands once the speaker pauses, so
  // timing off it would blink at someone still mid-sentence.
  useEffect(() => {
    if (!inAcknowledgementLoop || answerSubmitted) {
      setSendBlink(false);
      return;
    }
    setSendBlink(false);
    const timer = setTimeout(() => setSendBlink(true), SILENCE_BLINK_MS);
    return () => clearTimeout(timer);
  }, [deepgramTranscript, inAcknowledgementLoop, answerSubmitted, SILENCE_BLINK_MS]);

  useHotkeys("space", (event) => {
    event.preventDefault();
    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    if (!currentLine || !currentLine.Reading) return;

    const currentRole = state.CharacterRoles.find(
      (option) => option.Character === currentLine.Character
    );

    if (currentRole?.role === "Child") {
      const voiceName = currentRole?.VA || "kore";
      speak(currentLine.Dialogue, voiceName, "neutral", currentRole.role)
        .then((started) => {
          if (started) setChildHasPlayed(true);
        });
    }
  });

  useHotkeys("enter", (event) => {
    event.preventDefault();
    handlePlayClick();
  });

  function renderNavigationButtons() {
    const isLastIndex = state.pagesValues[state.page].text.length === state.index;
    const isLastPage = state.page === state.pagesValues.length - 1;

    const shouldDisableButton = isButtonDisabled || isAnyAudioPlaying;

    let buttonText;
    let buttonClass = "";

    if (state.hasReachedEnd) {
      buttonText = 'End';
      buttonClass = "highlight-button";
    } else if (isLastIndex && !isPlaying) {
      buttonText = isLastPage ? 'End' : 'Next Page';
      buttonClass = "highlight-button";
    } else {
      buttonText = "Next";
      if (!isPlaying && !shouldDisableButton) {
        buttonClass = "highlight-button";
      }
    }
    return (
      <div className="navigation-buttons tw-p-4 md:tw-flex md:tw-justify-end">
          <button
            type="button"
            className={`btn btn-secondary ${shouldDisableButton ? 'disabled' : ''} ${buttonClass}`}
            onClick={handlePlayClick}
            disabled={shouldDisableButton}
          >
            {buttonText}
          </button>
      </div>
    );
  }

  return (
    <div className="story tw-w-full tw-px-3 tw-mx-auto reader-container">
      {/* Hidden audio element for remote audio stream */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />


      <StoryBar
        page={state.page}
        pageCount={state.pagesValues.length}
        onHome={() => navigate('/Home', { state: { name } })}
        onPrev={gotoPreviousPage}
        onNext={gotoNextPage}
      />

    <div className="reader-row">
      <div className="tw-flex-none tw-w-full landscape:tw-w-5/12 reader-picture-column">
        <PageIllustration
          img={state.pagesValues[state.page].img}
          imageTags={imageTags}
          clickTarget={clickTarget}
          clickAnswersQuestion={clickAnswersQuestion}
          onAnswerClick={handleImageAnswerClick}
          onTagClick={(label) => { userAttentionRef.current = label; console.log('[userAttention]', label); }}
        />
        <QuestionAvatar
          questionHistory={questionHistory}
          showAvatar={showAvatar}
          inAcknowledgementLoop={inAcknowledgementLoop}
          avatarPhase={avatarPhase}
          isThoughtRevealed={isThoughtRevealed}
          revealedQuestion={revealedQuestion}
          revealedAcknowledgement={revealedAcknowledgement}
          isGeneratedQuestionPlaying={isGeneratedQuestionPlaying}
          isPageQuestionPlaying={isPageQuestionPlaying}
          isAcknowledgementPlaying={isAcknowledgementPlaying}
          narratorImage={narratorImage}
          frames={frames}
          listeningImage={listeningImage}
          narratorRole={narratorRole}
          onSpeakGenerated={handleSpeakGenerated}
          onPlaySound={playSound}
          answerRetryText={answerRetryText}
          answerSubmitted={answerSubmitted}
          answerDisabled={isAnyAudioPlaying}
          onAnswerSubmit={handleAnswerSubmit}
          sendBlink={sendBlink}
          isUserSpeaking={isUserSpeaking}
          awaitingClick={clickAnswersQuestion}
          onRequestQuestion={requestQuestion}
          generatingQuestion={generatingQuestion}
        />
        </div>
      <div className="tw-flex-none tw-w-full landscape:tw-w-7/12 table-container">


        <div className="tw-w-full tw-px-3 tw-mx-auto">
          <DialogueList
            lines={state.pagesValues[state.page]?.text}
            selectedOptions={selectedOptions}
            characters={CurrentBook.characters}
            childHasPlayed={childHasPlayed}
            onChildPlayed={() => setChildHasPlayed(true)}
            speak={speak}
            dialogueRefs={dialogueRefs}
            tableContainerRef={tableContainerRef}
          />
        </div>
        {renderNavigationButtons()}
      </div>
    </div>
    </div>
  );
}
export default Reader;
