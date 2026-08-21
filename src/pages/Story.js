import "../styles/Story.css";
import "bootstrap/dist/css/bootstrap.css";
import React, { useState, useRef, useEffect } from "react";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import TouchAppIcon from '@mui/icons-material/TouchApp';
import { useHotkeys } from "react-hotkeys-hook";
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ReactScrollableFeed from 'react-scrollable-feed';
// Book Data
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
// Components
import QuestionAvatar from "../components/QuestionAvatar";
// Hooks
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useAcknowledgement } from "../hooks/useAcknowledgement";
import { useStoryNavigation } from "../hooks/useStoryNavigation";
// Utils
import { warmSay } from "../utils/warmSay";
import { unlockTtsAudio } from "../utils/ttsClient";
import { openDebugMonitor } from "../utils/debugMonitor";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import { ImageAnalysis, ImageTagging, prefetchPage } from "../utils/imageAnalysis";
import { processUserUtterance, abortCurrentCategorization, abortQuestionGeneration, setAwaitingQuestionAnswer, setCurrentBookId, endManualAnswer, cancelManualAnswer, isManualAnswerActive, setClickTags } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";
import { getRoleKind } from "../utils/roles";
import { generateQuestionOnDemand } from "../utils/InnerThoughtProcessStream";
import { assessClick, expandBox, CLICK_TOLERANCE } from "../utils/clickGeometry";

class Book {
  constructor(data) {
    this.name = data.Book.Name;
    this.characters = data.Book.Characters;
    this.pages = data.Book.Pages;
  }
};

function Reader() {
  const previewOnly = process.env.REACT_APP_PREVIEW_ONLY === 'true';
  const location = useLocation();
  const navigate = useNavigate();
  const [, setIsAudioPlaying] = useState(false);
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  // Must default to an array: several call sites do selectedOptions.find(...),
  // which throws on the old `{}` default when /story is opened without router
  // state (a new tab, a shared link, a lost history entry).
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
  const PRELOAD_CONCURRENCY = 1;
  // Quiet time after the last transcript before the send button starts blinking.
  const SILENCE_BLINK_MS = 5000;
  // How long after the last transcript fragment the mic is still treated as
  // hearing speech. Interims arrive every few hundred ms while someone talks, so
  // this only lapses in a real gap.
  const SPEAKING_IDLE_MS = 900;
  const DEEPGRAM_ENABLED = true;
  const GEMINI_Enabled = true;

  const QUESTION_GEN_ENABLED = true;

  const mateFrames = {
    "Green Grant": [
      require("../Pictures/Mate01/Mates-01.png"),
      require("../Pictures/Mate01/Mates-01-1.png"),
      require("../Pictures/Mate01/Mates-01-2.png"),
      require("../Pictures/Mate01/Mates-01-3.png"),
    ],
    "Yellow Yancey": [
      require("../Pictures/Mate02/Mates-02.png"),
      require("../Pictures/Mate02/Mates-02-1.png"),
      require("../Pictures/Mate02/Mates-02-2.png"),
      require("../Pictures/Mate02/Mates-02-3.png"),
    ],
    "Violet Victor": [
      require("../Pictures/Mate03/Mates-03.png"),
      require("../Pictures/Mate03/Mates-03-1.png"),
      require("../Pictures/Mate03/Mates-03-2.png"),
      require("../Pictures/Mate03/Mates-03-3.png"),
    ],
    "Blue Beatrice": [
      require("../Pictures/Mate04/Mates-04.png"),
      require("../Pictures/Mate04/Mates-04-1.png"),
      require("../Pictures/Mate04/Mates-04-2.png"),
      require("../Pictures/Mate04/Mates-04-3.png"),
    ],
    "Ruby Randy": [
      require("../Pictures/Mate06/Mates-06.png"),
      require("../Pictures/Mate06/Mates-06-1.png"),
      require("../Pictures/Mate06/Mates-06-2.png"),
      require("../Pictures/Mate06/Mates-06-3.png"),
    ],
    "Coral Carly": [
      require("../Pictures/Mate05/Mates-05.png"),
      require("../Pictures/Mate05/Mates-05-1.png"),
      require("../Pictures/Mate05/Mates-05-2.png"),
      require("../Pictures/Mate05/Mates-05-3.png"),
    ],
  };

  const mateListeningImages = {
    "Green Grant": require("../Pictures/Mate01/Mates-01-L.png"),
    "Yellow Yancey": require("../Pictures/Mate02/Mates-02-L.png"),
    "Violet Victor": require("../Pictures/Mate03/Mates-03-L.png"),
    "Blue Beatrice": require("../Pictures/Mate04/Mates-04-L.png"),
    "Ruby Randy": require("../Pictures/Mate06/Mates-06-L.png"),
    "Coral Carly": require("../Pictures/Mate05/Mates-05-L.png"),
  };
  
  const narratorRole = Array.isArray(selectedOptions)
    ? selectedOptions.find(o => mateFrames[o.role])
    : null;
  const narratorImage = narratorRole?.img;
  const frames = narratorRole ? mateFrames[narratorRole.role] : [narratorImage];
  const listeningImage = (narratorRole && mateListeningImages[narratorRole.role]) || narratorImage;

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

  const [isCategorizationPending, setIsCategorizationPending] = useState(false);
  const [questionHistory, setQuestionHistory] = useState([]);
  const [showAvatar, setShowAvatar] = useState(false);
  const [inAcknowledgementLoop, setInAcknowledgementLoop] = useState(false);
  const [avatarPhase, setAvatarPhase] = useState('question');
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  // Blinks the send button once the room has been quiet long enough that the
  // answer looks finished. Deepgram only emits finals, which land 0.3-2.4s after
  // the speaker stops, so this counts quiet from the last transcript, not from
  // the last sound.
  const [sendBlink, setSendBlink] = useState(false);
  // Whether the mic is hearing speech right now — drives the pulse animation.
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const showAvatarRef = useRef(false);
  useEffect(() => { showAvatarRef.current = showAvatar; }, [showAvatar]);

  const inAcknowledgementLoopRef = useRef(false);
  useEffect(() => { inAcknowledgementLoopRef.current = inAcknowledgementLoop; }, [inAcknowledgementLoop]);
  // Reset on both edges. Opening offers the button for a new question; closing
  // matters just as much, because ending the loop also empties questionHistory —
  // leaving this set would put the thinking dots back up after the
  // acknowledgement had already finished playing. The closing click does not
  // change this value, so the flag it sets survives until the loop moves.
  useEffect(() => { setAnswerSubmitted(false); }, [inAcknowledgementLoop]);

  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
  const hasSlidCloserRef = useRef(false);
  const dismissingQuestionRef = useRef(null);
  const wasGeminiAudioPlayingRef = useRef(false);
  const imageDescriptionRef = useRef(null);
  const [imageTags, setImageTags] = useState([]);
  const [showTagBoxes, setShowTagBoxes] = useState(false);
  // The tag whose region answers the pending click question. Null on every other
  // book and whenever the pending question is a spoken one.
  const [clickTarget, setClickTarget] = useState(null);
  const userAttentionRef = useRef(null);
  const pendingGeneratedQuestionRef = useRef(null);
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
  const currentPageRef = useRef(state.page);

  let lastSpokenText = "";
  let lastSpokenTime = 0;

  const {
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    revealedQuestion,
    isThoughtRevealed,
    isGeneratedQuestionPlayingRef,
    suppressGeneratedAudioStreamRef,
    speak,
    continueReading,
    playSound,
    speakGenerated,
    startGeneratedQuestion,
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
    pendingGeneratedQuestionRef,
    acknowledgementFromPageQuestionRef,
    generatedQuestionPendingRef,
    questionGenEnabledRef,
    state,
    narratorRole,
  });

  const {
    isAcknowledgementPlaying,
    revealedAcknowledgement,
    acknowledgementModeRef,
    playAcknowledgement,
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
  });

  const clearQuestionUI = () => {
    closeAcknowledgementMode();
    abortCurrentCategorization();
    setAwaitingQuestionAnswer(false);
    setGeneratedQuestion(null);
    setClickTarget(null);
    setGeneratingQuestion(false);
    resetGeneratedQuestionState();
    setIsCategorizationPending(false);
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
      // Nothing was said between the question and the press.
      studyLog.pushEvent({ event_type: 'manual_answer_empty', detail: 'no transcript captured' });
      setAnswerSubmitted(false);
    }
  };

  // A click question is answered by clicking the picture, not by talking. The
  // click counts only while that question is actually pending an answer.
  const clickAnswersQuestion = !!clickTarget && inAcknowledgementLoop && !answerSubmitted;

  // Correctness is decided purely by the tag's own box: the click is converted to
  // a percentage of the rendered image and tested against the stored coordinates.
  // Nothing the model wrote is consulted here.
  const handleImageAnswerClick = (e) => {
    if (!clickAnswersQuestion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // Near enough counts. imageTags is passed so the margin cannot credit a click
    // that actually landed on a different tagged object.
    const { correct, distance, reason, hitLabel } = assessClick({
      box: clickTarget.box_2d,
      tags: imageTags,
      xPct,
      yPct,
    });

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

  const manualQuestionPendingRef = useRef(false);
  const manualQuestionAbortRef = useRef(null);
  const [generatingQuestion, setGeneratingQuestion] = useState(false);

  // Committing to the question already on screen makes whatever is being generated
  // behind it obsolete: the reader has chosen, and the next thing that matters is
  // their answer. Cancelling here also stops a late arrival replacing the question
  // mid-answer, and saves the TTS for one nobody will hear.
  const stopQuestionGeneration = (why) => {
    let stopped = abortQuestionGeneration();
    if (manualQuestionAbortRef.current) {
      manualQuestionAbortRef.current.abort();
      manualQuestionAbortRef.current = null;
      stopped = true;
    }
    manualQuestionPendingRef.current = false;
    setIsCategorizationPending(false);
    setGeneratingQuestion(false);
    if (stopped) studyLog.pushEvent({ event_type: 'question_generation_cancelled', detail: why });
    return stopped;
  };

  // The reader tapped the question that is already showing.
  const handleSpeakGenerated = () => {
    stopQuestionGeneration('question_committed');
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
    setIsCategorizationPending(true);
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
        lastGeneratedQuestion: pendingGeneratedQuestionRef.current || null,
        systemQuestions: stateRef.current.pagesValues.map(p => (p?.question || '').trim()).filter(Boolean),
        clickTags: String(id) === '2' ? imageTags : [],
        ttsVoiceName: narratorRole?.VA || null,
        onQuestionReady: (questionText, expectedAnswer, click, audioChunks) => {
          // The reader may have moved on while the model was thinking.
          if (stateRef.current.page !== pageIndex) return;
          const questionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          studyLog.pushQuestion({
            question_id: questionId,
            question_type: 'generated',
            event: 'generated',
            question_text: questionText,
            expected_answer: expectedAnswer ?? '',
            reason: 'manual',
          });
          lastExpectedAnswerRef.current = expectedAnswer ?? null;
          setClickTarget(click?.answerBox ? { label: click.answerLabel, box_2d: click.answerBox } : null);
          setGeneratingQuestion(false);
          startGeneratedQuestion(questionText, { questionId, audioChunks });
        },
        onAudioError: handleAudioError,
        signal: controller.signal,
      });
    } finally {
      // Only clear if this request is still the current one: a newer request may
      // have replaced it while this one was in flight.
      if (manualQuestionAbortRef.current === controller) manualQuestionAbortRef.current = null;
      manualQuestionPendingRef.current = false;
      setIsCategorizationPending(false);
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
    isTraining,
    name,
    id,
    isAnyAudioPlaying,
    generatedQuestion,
    showAvatar,
    showAvatarRef,
    inAcknowledgementLoopRef,
    generatedQuestionPendingRef,
  });

  const handleTextSelection = () => {
    setTimeout(() => {
      let text = window.getSelection().toString().trim();
      text = text.replace(/(?<=\s|^)[.,!?;:"'""''\-—]?(?=\s|$)/g, '').trim();

      const now = Date.now();
      if (
        text.length > 0 &&
        (text !== lastSpokenText || now - lastSpokenTime > 1000)
      ) {
        speak(text);
        lastSpokenText = text;
        lastSpokenTime = now;
      }
    }, 100);
  };

  function canon(text) {
    return stripSSMLTags(String(text || ""))
      .trim()
      .replace(/\s+/g, " ");
  }

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
    lastExpectedAnswerRef.current = null;
    lastAskedQuestionRef.current = state.pagesValues[state.page]?.question || null;
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
    const pq = state.pagesValues[state.page]?.question;
    setQuestionHistory(pq ? [{ id: `page-${state.page}`, text: pq, type: 'page' }] : []);
    setShowAvatar(false);
    if (pq) {
      studyLog.pushQuestion({
        question_id: `page-${state.page}`,
        question_type: 'page',
        event: 'shown',
        question_text: pq,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page]);

  useEffect(() => {
    const current = state.pagesValues[state.page];
    const next = state.pagesValues[state.page + 1];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    if (!current?.text?.length) return;

    const voiceByChar = new Map();
    for (const opt of state.CharacterRoles || []) {
      if (opt.role === "Parent") continue;
      if (opt.VA) voiceByChar.set(opt.Character, { voiceName: opt.VA, role: opt.role });
    }

    const pagesToWarm = [current];
    if (next?.text?.length) pagesToWarm.push(next);

    // Page questions are spoken by the mate avatar, not by whoever reads the
    // Narrator character, so they warm with that voice — otherwise a human-read
    // Narrator warmed nothing and every page question paid full synthesis.
    const questionVoice = narratorRole?.VA
      ? { voiceName: narratorRole.VA, role: narratorRole.role }
      : null;
    const tasks = [];
    for (const page of pagesToWarm) {
      for (const line of page.text) {
        const charInfo = voiceByChar.get(line.Character);
        if (!charInfo) continue;
        const text = canon(line.Dialogue);
        if (!text) continue;
        tasks.push({
          text,
          voiceName: charInfo.voiceName,
          role: charInfo.role
        });
      }
      if (page.question && questionVoice) {
        tasks.push({
          text: page.question,
          voiceName: questionVoice.voiceName,
          role: questionVoice.role
        });
      }
    }
    if (!tasks.length) return;

    let i = 0;
    let running = 0;
    let stopped = false;

    const pump = () => {
      if (stopped) return;
      while (running < PRELOAD_CONCURRENCY && i < tasks.length) {
        const t = tasks[i++];
        running++;
        warmSay(t)
          .catch(() => {})
          .finally(async () => {
            running--;
            await sleep(400);
            queueMicrotask(pump);
          });
      }
    };

    pump();
    return () => { stopped = true; };
  }, [state.page, state.pagesValues, state.CharacterRoles, narratorRole]);

  useEffect(() => {
    pendingGeneratedQuestionRef.current = generatedQuestion || null;
  }, [generatedQuestion]);

  useEffect(() => {
    const wasPlaying = wasGeminiAudioPlayingRef.current;
    if (wasPlaying && !isGeminiAudioPlaying && dismissingQuestionRef.current) {
    }
    wasGeminiAudioPlayingRef.current = isGeminiAudioPlaying;
  }, [isGeminiAudioPlaying]);

  useEffect(() => { currentPageRef.current = state.page; }, [state.page]);

  useEffect(() => { stateRef.current = state; });

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
      userUtterancesRef,
      accumulatedUtterancesRef,
      utteranceQueuesRef,
      currentLineTrackingRef,
      offScriptLogRef,
      state: stateRef.current,
      speakerLabels,
      gotoNextPage,
      jumpToLine,
      setAudioHasEnded,
      setIsPlaying,
      onAutoLineAdvance: markNextLineChangeAutomatic,
      onCategorizationStart: () => setIsCategorizationPending(true),
      onCategorizationResult: (result) => {
        if (!questionGenEnabledRef.current) return;
        if (result?.sourcePage !== stateRef.current.page) return;
        setIsCategorizationPending(false);
      },
      onQuestionReady: (questionText, expectedAnswer = null, click = null, audioChunks = []) => {
        if (!questionGenEnabledRef.current) return;

        // Logged before the suppression check so the record reflects every
        // question the model actually produced, not only the ones shown.
        const questionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        studyLog.pushQuestion({
          question_id: questionId,
          question_type: "generated",
          event: "generated",
          question_text: questionText,
          expected_answer: expectedAnswer ?? "",
        });

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

        // Covers the narrow race the abort in setAwaitingQuestionAnswer cannot:
        // a response already parsed when the window opened. Showing it here would
        // replace the question being answered and strand the captured answer.
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
        lastExpectedAnswerRef.current = expectedAnswer;
        // Present only for a click question, and always a real tag's box — the
        // server drops any question whose label was not in the tag list.
        setClickTarget(click?.answerBox ? { label: click.answerLabel, box_2d: click.answerBox } : null);
        startGeneratedQuestion(questionText, { questionId, audioChunks });
      },
      imageDescriptionRef,
      userAttentionRef,
      pendingGeneratedQuestionRef,
      ttsVoiceName: narratorRole?.VA || null,
      onAudioError: handleAudioError,
      questionGenEnabledRef,
      isAcknowledgementModeRef: acknowledgementModeRef,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userUtterance]);

  // Interims land every few hundred ms while someone is talking, so this stays
  // true through a sentence and lapses in the gaps. Finals are too coarse: they
  // only arrive after the speaker has already stopped.
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

  function stripSSMLTags(text) {
    return text.replace(/<\/?[^>]+(>|$)/g, "");
  }

  function parseText(text) {
    const htmlText = text
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    return <div dangerouslySetInnerHTML={{__html: htmlText}}></div>;
  }

 function renderPageRows() {


    return (
      <ReactScrollableFeed>
      <div className="table-column" ref={tableContainerRef}>
        {state.pagesValues[state.page]?.text?.map((val, key) => {
          let isActiveRowParent = false;
          let isActiveRowChild = false;
          const isActiveRow = val.Reading;
          const currentRole = selectedOptions.find(
            (option) => option.Character === val.Character
          );

          if(currentRole.role === "Parent"){
            isActiveRowParent = true;
          }

          if(currentRole.role === "Child"){
            isActiveRowChild = true;
          }

          const roleImage = currentRole ? currentRole.img : "";
          const roleName = currentRole ? currentRole.Role : "Role image"; // default alt text
          const character = CurrentBook.characters.find(c => c.Name === val.Character);
          const characterImage = character ? character.img : "";
          const isChild = currentRole?.role === "Child";

          return (
            <div
              ref={(el) => dialogueRefs.current[key] = el}
              className={`row gx-3${isActiveRowParent && isActiveRow ? " active active-parent" : ""}${isActiveRowChild && isActiveRow ? " active active-child" : ""}`}
              key={key}
              onClick={() => {
                const selectedText = window.getSelection().toString().trim();
                if (isChild && val.Reading && selectedText === "") {
                  const currentRole = selectedOptions.find(
                    (option) => option.Character === val.Character
                  );
                  const voiceName = currentRole?.VA || "kore";
                  const role = currentRole?.role || null;
                  speak(val.Dialogue, voiceName, "neutral", role)
                    .then((started) => {
                      if (started) setChildHasPlayed(true);
                    });
                }
              }}
            >
              {/* Animated hand pointer for child lines */}
              {isChild && isActiveRow && !childHasPlayed && (
                <TouchAppIcon
                  className="child-tap-icon"
                  sx={{ fontSize: 48 }}
                />
              )}

              <div className="col-3">
              <div className="role-image-container-text d-flex justify-content-around">
              {currentRole && roleImage && <img src={roleImage} alt={roleName} style={{width: "20%"}}  className="overlay-image"/>}

                {characterImage && <img src={characterImage} alt={val.Character} style={{width: "45%"}} className={`${isActiveRow ? "active-roleImage" : ""}`} />}
              </div>
              </div>
              <div className="col-8">
                <div className={`p-3 borderless text-size  ${isActiveRow ? "active-dialogue" : ""} `} onMouseUp={handleTextSelection}>
                  {val.Dialogue.split('\n').map((str, index, array) =>  index === array.length - 1 ?  parseText(str) :
                  <>
                    {parseText(str)}
                     <br />
                  </>
              )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </ReactScrollableFeed>
    );
  };

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
      <div className="navigation-buttons p-3 d-md-flex justify-content-md-end">
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-secondary ${shouldDisableButton ? 'disabled' : ''} ${buttonClass}`}
            onClick={handlePlayClick}
            disabled={shouldDisableButton}
          >
            {buttonText}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="story container-fluid reader-container">
      {/* Hidden audio element for remote audio stream */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />


      <div className="navbar navbar-light bg-light row1">
        <div className="home btn col-1">
          <Link to={{ pathname: "/Home", state: { id: 1 } }}>
            <button className="btn btn-primary">
              <i>
                <KeyboardDoubleArrowLeftIcon />
              </i>
            </button>
          </Link>
        </div>
      </div>

    <div className="navigation-buttons-container">

      <button
        onClick={openDebugMonitor}
        className="btn btn-outline-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
      >Debug</button>

      <button
        onClick={() => setShowTagBoxes(v => !v)}
        className="btn btn-outline-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
      >{showTagBoxes ? 'Hide' : 'Show'} Tags ({(imageTags || []).length})</button>

      <button
        onClick={gotoPreviousPage}
        className="btn btn-primary previous-page-button"
        disabled={state.page === 0}
      >Previous Page</button>

      <button
        onClick={gotoNextPage}
        className="btn btn-primary next-page-button"
        disabled={state.page >= state.pagesValues.length - 1}
      >Next Page</button>
    </div>

    <div className="row">
      <div className="col-md-5">
        <div
          style={{
            position: 'relative', display: 'inline-block', width: '100%',
            cursor: clickAnswersQuestion ? 'crosshair' : 'default',
          }}
          onClick={clickAnswersQuestion ? handleImageAnswerClick : undefined}
        >
          <img src={state.pagesValues[state.page].img} alt="current page" style={{ width: '100%', display: 'block' }} />
            {/* The acceptance region: how far outside its tag a click may land and
                still be graded correct. Drawn under the red boxes so the exact tag
                stays readable, and pointer-transparent so it never eats a click. */}
            {showTagBoxes && (imageTags || []).map((tag, i) => {
              const grown = expandBox(tag?.box_2d);
              if (!grown) return null;
              const [gy0, gx0, gy1, gx1] = grown;
              // Corners are rounded to radius CLICK_TOLERANCE, because the hit test
              // measures straight-line distance — a square outline here would claim
              // the diagonal corners are accepted when they are not.
              const rx = (CLICK_TOLERANCE / (gx1 - gx0)) * 100;
              const ry = (CLICK_TOLERANCE / (gy1 - gy0)) * 100;
              return (
                <div
                  key={`tol-${i}`}
                  style={{
                    position: 'absolute',
                    top: `${gy0 / 10}%`, left: `${gx0 / 10}%`,
                    height: `${(gy1 - gy0) / 10}%`, width: `${(gx1 - gx0) / 10}%`,
                    border: '2px dashed #2ecc40',
                    borderRadius: `${rx}% / ${ry}%`,
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {(imageTags || []).map((tag, i) => {
              if (!Array.isArray(tag?.box_2d) || tag.box_2d.length < 4) return null;
              const [y0, x0, y1, x1] = tag.box_2d;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: `${y0 / 10}%`, left: `${x0 / 10}%`,
                    height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%`,
                    cursor: 'crosshair',
                    ...(showTagBoxes ? { outline: '2px solid red', outlineOffset: '-2px' } : {}),
                  }}
                  title={tag.label}
                  onClick={() => { userAttentionRef.current = tag.label; console.log('[userAttention]', tag.label); }}
                >
                  {showTagBoxes && (
                    <span style={{
                      position: 'absolute', top: 0, left: 0, transform: 'translateY(-100%)',
                      background: 'red', color: '#fff', fontSize: '10px', lineHeight: 1.3,
                      padding: '0 3px', whiteSpace: 'nowrap', pointerEvents: 'none',
                    }}>{tag.label}</span>
                  )}
                </div>
              );
            })}
        </div>
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
      <div className="col-md-7 table-container">


        <div className="container-fluid">{renderPageRows()}</div>
        {renderNavigationButtons()}
      </div>
    </div>
    </div>
  );
}
export default Reader;
