import React,  { useState, useRef, useCallback, useEffect } from "react";
import "../styles/Story.css";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import TouchAppIcon from '@mui/icons-material/TouchApp';
import {useHotkeys} from "react-hotkeys-hook";
import { Link, useLocation, useNavigate  } from 'react-router-dom';
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import ReactScrollableFeed from 'react-scrollable-feed';
import { say } from "../utils/ttsClient";
import { warmSay } from "../utils/warmSay";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import { processUserUtterance, sendOffScriptLog, sendReinforcementLog, abortCurrentCategorization, setAwaitingQuestionAnswer, resetReinforcementSnapshot } from "../utils/utteranceProcessor";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { streamGeneratedQuestionTest } from "../utils/InnerThoughtProcessStream";
import { ImageAnalysis, ImageTagging, prefetchPage } from "../utils/imageAnalysis";
import { openDebugMonitor } from "../utils/debugMonitor";
import { lineChange } from "../logGeneration";

class Book {
  constructor(data) {
    this.name = data.Book.Name;
    this.characters = data.Book.Characters;
    this.pages = data.Book.Pages;
  }
};

function Reader() {
  // If env true then limit to first three pages
  const previewOnly = process.env.REACT_APP_PREVIEW_ONLY === 'true';
  const location = useLocation();
  const navigate = useNavigate();
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isGeneratedQuestionPlaying, setIsGeneratedQuestionPlaying] = useState(false);
  const [isPageQuestionPlaying, setIsPageQuestionPlaying] = useState(false);
  const [isReinforcementPlaying, setIsReinforcementPlaying] = useState(false);
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const condition = location.state?.condition || null;
  const name = location.state?.name || null;
  const isTraining = location.state?.training === true;
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  // How many warm requests to run in parallel
  const PRELOAD_CONCURRENCY = 1;
  const TEST_GENERATED_QUESTION = "How do you think Zoe is feeling?";
  // Hardcoded feature flags
  const REALTIME_ENABLED = true;
  const DEEPGRAM_ENABLED = true;
  const GEMINI_Enabled = true;
  
  // C1: question generation OFF, C2: question generation ON (selected in ConditionSelecter).
  const QUESTION_GEN_ENABLED = condition === "C1";

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
  const narratorRole = Array.isArray(selectedOptions)
    ? selectedOptions.find(o => mateFrames[o.role])
    : null;
  const narratorImage = narratorRole?.img;
  const frames = narratorRole ? mateFrames[narratorRole.role] : [narratorImage];

  const {
    // connected,
    connect,
    disconnect,
    geminiLiveConnect,
    geminiLiveDisconnect,
    isMuted,
    userUtterance,
    speakerLabels,
    remoteAudioRef,
    deepgramConnected,
    deepgramTranscript,
    connectToDeepgram,
    disconnectDeepgram,
    isGeminiAudioPlaying,
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
    hasReachedEnd: false // New state variable
  });
  const stateRef = useRef(state);

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioHasEnded, setAudioHasEnded] = useState(false);
  const [generatedQuestion, setGeneratedQuestion] = useState(null);
  // Mirror of isGeneratedQuestionPlaying for use inside callbacks/effects that
  // would otherwise close over a stale state value.
  const isGeneratedQuestionPlayingRef = useRef(false);

  // isCategorizationPending is a UI mirror of utteranceProcessor's module-level
  // flag. utteranceProcessor's sendOffScriptLog is the single source of truth;
  // it drives this state via onCategorizationStart / onCategorizationResult callbacks.
  const [isCategorizationPending, setIsCategorizationPending] = useState(false);
  const [questionHistory, setQuestionHistory] = useState([]);
  const [showAvatar, setShowAvatar] = useState(false);
  const showAvatarRef = useRef(false);
  useEffect(() => { showAvatarRef.current = showAvatar; }, [showAvatar]);
  useEffect(() => { isGeneratedQuestionPlayingRef.current = isGeneratedQuestionPlaying; }, [isGeneratedQuestionPlaying]);
  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
  const [isSlidingBack, setIsSlidingBack] = useState(false);
  // Tracks whether slide-closer has already played. Prevents re-triggering
  // the animation when a new generated question replaces an existing one —
  // the image stays in place, only the question text/audio updates.
  const hasSlidCloserRef = useRef(false);
  const generatedQuestionAudioRef = useRef(null);
  const generatedQuestionAudioUrlRef = useRef(null);
  const dismissingQuestionRef = useRef(null);
  const wasGeminiAudioPlayingRef = useRef(false);
  const imageDescriptionRef = useRef(null);
  const [imageTags, setImageTags] = useState([]);
  const userAttentionRef = useRef(null);
  const pendingGeneratedQuestionRef = useRef(null);
  const lastAskedQuestionRef = useRef(null);
  const reinforcementModeRef = useRef(false);
  const reinforcementSessionRef = useRef({ question: null, turns: [] });
  const reinforcementRequestSeqRef = useRef(0);
  const reinforcementAudioRef = useRef(null);
  const reinforcementStreamingPlayerRef = useRef(null);
  const isPageQuestionPlayingRef = useRef(false);
  const pendingLineTriggersRef = useRef(new Map());
  const pendingUntargetedLineTriggerRef = useRef(null);
  const markLineChangeTrigger = useCallback((trigger, target) => {
    if (target && Number.isFinite(target.page) && Number.isFinite(target.index)) {
      const key = `${target.page}:${target.index}`;
      const existing = pendingLineTriggersRef.current.get(key);
      if (existing === "manual" && trigger === "auto") return;
      pendingLineTriggersRef.current.set(key, trigger);
      return;
    }

    if (pendingUntargetedLineTriggerRef.current === "manual" && trigger === "auto") return;
    pendingUntargetedLineTriggerRef.current = trigger;
  }, []);
  const markNextLineChangeManual = useCallback((target) => {
    markLineChangeTrigger("manual", target);
  }, [markLineChangeTrigger]);
  const markNextLineChangeAutomatic = useCallback((target) => {
    markLineChangeTrigger("auto", target);
  }, [markLineChangeTrigger]);


  let lastSpokenText = "";
  let lastSpokenTime = 0;
  const frameIndexRef = useRef(0);

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

  function changeFrame() {
    const imgElement = document.getElementById("role-image");
    if (!imgElement) return;
    frameIndexRef.current = (frameIndexRef.current + 1) % frames.length;
    imgElement.src = frames[frameIndexRef.current];
  }

  useEffect(() => {
    let intervalId = null;
    if (isGeneratedQuestionPlaying || isPageQuestionPlaying || isGeminiAudioPlaying || isReinforcementPlaying) {
      intervalId = setInterval(changeFrame, 250);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
      // Reset to default frame
      frameIndexRef.current = 0;
      const imgElement = document.getElementById("role-image");
      if (imgElement) imgElement.src = frames[0];
    };
  }, [isGeneratedQuestionPlaying, isPageQuestionPlaying, isGeminiAudioPlaying, isReinforcementPlaying]);

  function canon(text) {
    return stripSSMLTags(String(text || ""))
      .trim()
      .replace(/\s+/g, " ");
  }

  useEffect(() => {
    if (DEEPGRAM_ENABLED) connectToDeepgram();
    if (REALTIME_ENABLED) connect();
    if (GEMINI_Enabled) geminiLiveConnect({ voiceName: narratorRole?.VA });
    return () => {
      disconnectDeepgram();
      disconnect();
      geminiLiveDisconnect();
    };
  }, []);

  // Pre-fetch image analysis on page change so it's ready for off-script categorization
  useEffect(() => {
    const pageText = state.pagesValues[state.page]?.text
      ?.map(t => stripSSMLTags(t.Dialogue)).join(' ') || '';
    userAttentionRef.current = null;
    // Default the "last asked question" to this page's question so reinforcement
    // has context even before playSound runs or after a follow-up was consumed.
    lastAskedQuestionRef.current = state.pagesValues[state.page]?.question || null;
    setImageTags([]);
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
  }, [state.page]);

  // Warm/preload TTS for current + next page
  useEffect(() => {
    const current = state.pagesValues[state.page];
    const next = state.pagesValues[state.page + 1];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    if (!current?.text?.length) return;

    // Build Character → voiceName map (skip muted roles: Parent/Child)
    const voiceByChar = new Map();
    for (const opt of state.CharacterRoles || []) {
      if (opt.role === "Parent") continue;
      if (opt.VA) voiceByChar.set(opt.Character, { voiceName: opt.VA, role: opt.role });
    }

    // Collect pages to warm: current + look-ahead (next)
    const pagesToWarm = [current];
    if (next?.text?.length) pagesToWarm.push(next);

    // Build a flat list of warm tasks for ALL lines from valid speakers
    const narratorInfo = voiceByChar.get('Narrator');
    const tasks = [];
    for (const page of pagesToWarm) {
      for (const line of page.text) {
        const charInfo = voiceByChar.get(line.Character);
        if (!charInfo) continue; // ignore Parent/Child/unassigned
        const text = canon(line.Dialogue);
        if (!text) continue;
        tasks.push({
          text,
          voiceName: charInfo.voiceName,
          role: charInfo.role
        });
      }
      // Also warm the page question (uses narrator voice)
      if (page.question && narratorInfo) {
        tasks.push({
          text: page.question,
          voiceName: narratorInfo.voiceName,
          role: narratorInfo.role
        });
      }
    }
    if (!tasks.length) return;

    // Tiny concurrency pump (best-effort warming)
    let i = 0;
    let running = 0;
    let stopped = false;

    const pump = () => {
      if (stopped) return;
      while (running < PRELOAD_CONCURRENCY && i < tasks.length) {
        const t = tasks[i++];
        running++;
        warmSay(t)
          .catch(() => {}) // warming is best-effort
          .finally(async () => {
            running--;
            await sleep(400);
            queueMicrotask(pump);
          });
      }
    };

    pump();
    return () => { stopped = true; };
  }, [state.page, state.pagesValues, state.CharacterRoles]);

const gotoNextPage = () => {
  console.log("go to next page button pressed");

  clearQuestionUI();

  if (questionGenEnabledRef.current) {
    const hasOffScript = offScriptLogRef?.current?.length > 0;
    console.log("sendOffScriptLog called, page:", state.page);
    sendOffScriptLog(
      offScriptLogRef,
      state.page,
      state,
      hasOffScript ? () => setIsCategorizationPending(false) : undefined,
      imageDescriptionRef,
      userAttentionRef.current,
      hasOffScript ? () => setIsCategorizationPending(true) : undefined,
      pendingGeneratedQuestionRef.current || null,
      narratorRole?.VA || null,
      handleAudioChunk,
      handleAudioEnd,
      handleAudioError,
      startGeneratedQuestion,
    );
  }

  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);

  setIsPlaying(prevIsPlaying => {
      return false;
  });

  if (state.page < state.pagesValues.length - 1) {

    for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
      state.pagesValues[state.page].text[i].Reading=false;
    }
    setState(prevState => {
      const nextState = { ...prevState, page: prevState.page + 1, index: 0 };
      markNextLineChangeManual({ page: nextState.page, index: nextState.index });
      return nextState;
    });
  } else {
    if (isTraining) navigate('/Home', { state: { name } });
    else navigate('/Survey', { state: { id, name, condition } });
  }
};


const gotoPreviousPage = () => {
  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);
  clearQuestionUI();

  setIsPlaying(prevIsPlaying => {
    return false;
  });
  for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
    state.pagesValues[state.page].text[i].Reading=false;
  }
  state.hasReachedEnd = false;
  if (state.page > 0) {
    setState(prevState => {
      const nextState = { ...prevState, page: prevState.page - 1, index: 0 };
      markNextLineChangeManual({ page: nextState.page, index: nextState.index });
      return nextState;
    });
    // Add any other state resets or logic needed when changing pages here
  }
};

const playSound = () => {
  // Try narrator voice if assigned; fallback to "kore"
  const narratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
  const voiceName = narratorRole?.VA || "kore";
  const role = narratorRole?.role || null;
  const question = state.pagesValues[state.page].question;
  setIsPageQuestionPlaying(true);
  isPageQuestionPlayingRef.current = true;
  lastAskedQuestionRef.current = question;
  speak(question, voiceName, "neutral", role);
};

// Streaming generated-question audio. Gemini emits PCM chunks via SSE; we keep
// them buffered until the user clicks the generated question, then feed them to
// Web Audio in sequence.
const streamingPlayerRef = useRef(null);
const fullQuestionTextRef = useRef('');
const cumulativeAudioMsRef = useRef(0);
const generatedQuestionAudioChunksRef = useRef([]);
const generatedQuestionAudioEndedRef = useRef(false);
const generatedQuestionAudioErrorRef = useRef(null);
const generatedQuestionPlayRequestedRef = useRef(false);
const suppressGeneratedAudioStreamRef = useRef(false);
const [revealedQuestion, setRevealedQuestion] = useState('');

const SPEECH_CHARS_PER_SEC = 14;
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
  if (questionText) lastAskedQuestionRef.current = questionText;
  setAwaitingQuestionAnswer(true);
}, [isMuted, remoteAudioRef]);

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
  cumulativeAudioMsRef.current = 0;
  generatedQuestionAudioChunksRef.current = [];
  generatedQuestionAudioEndedRef.current = false;
  generatedQuestionAudioErrorRef.current = null;
  generatedQuestionPlayRequestedRef.current = false;
  suppressGeneratedAudioStreamRef.current = false;
  pendingGeneratedQuestionRef.current = text;
  setRevealedQuestion('');
  setGeneratedQuestion(text);
  setQuestionHistory(prev => {
    const last = prev[prev.length - 1];
    if (last && last.type === "generated" && last.text === text) {
      return prev;
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
  setShowAvatar(true);
  hasSlidCloserRef.current = false;
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
}, [TEST_GENERATED_QUESTION, handleAudioChunk, handleAudioEnd, handleAudioError, narratorRole?.VA, startGeneratedQuestion]);

useEffect(() => {
  pendingGeneratedQuestionRef.current = generatedQuestion || null;
}, [generatedQuestion]);

const stopReinforcementAudio = useCallback(() => {
  if (reinforcementAudioRef.current) {
    reinforcementAudioRef.current.pause();
    reinforcementAudioRef.current = null;
  }
  if (reinforcementStreamingPlayerRef.current) {
    try { reinforcementStreamingPlayerRef.current.stop(); } catch {}
    reinforcementStreamingPlayerRef.current = null;
  }
  setIsReinforcementPlaying(false);
}, []);

const closeReinforcementMode = useCallback(() => {
  reinforcementModeRef.current = false;
  reinforcementSessionRef.current = { question: null, turns: [] };
  reinforcementRequestSeqRef.current += 1;
  resetReinforcementSnapshot();
  stopReinforcementAudio();
  setAwaitingQuestionAnswer(false);
  if (remoteAudioRef.current && !isMuted) {
    remoteAudioRef.current.muted = false;
  }
}, [isMuted, remoteAudioRef, stopReinforcementAudio]);

const finishQuestionInteraction = useCallback(() => {
  closeReinforcementMode();
  setAwaitingQuestionAnswer(false);
  generatedQuestionPlayRequestedRef.current = false;
  suppressGeneratedAudioStreamRef.current = false;
  teardownStreamingPlayer();
  setIsGeneratedQuestionPlaying(false);
  setIsSlidingBack(false);
  dismissingQuestionRef.current = null;

  const latestGenerated = fullQuestionTextRef.current || generatedQuestion;
  if (latestGenerated) {
    setGeneratedQuestion(latestGenerated);
    setRevealedQuestion(latestGenerated);
    pendingGeneratedQuestionRef.current = latestGenerated;
    setShowAvatar(true);
  }

  if (generatedQuestionAudioRef.current) {
    generatedQuestionAudioRef.current.pause();
    generatedQuestionAudioRef.current = null;
  }
  if (generatedQuestionAudioUrlRef.current) {
    URL.revokeObjectURL(generatedQuestionAudioUrlRef.current);
    generatedQuestionAudioUrlRef.current = null;
  }
}, [closeReinforcementMode, generatedQuestion, teardownStreamingPlayer]);

const clearQuestionUI = () => {
  closeReinforcementMode();
  abortCurrentCategorization();
  setAwaitingQuestionAnswer(false);
  setGeneratedQuestion(null);
  setRevealedQuestion('');
  fullQuestionTextRef.current = '';
  cumulativeAudioMsRef.current = 0;
  generatedQuestionAudioChunksRef.current = [];
  generatedQuestionAudioEndedRef.current = false;
  generatedQuestionAudioErrorRef.current = null;
  generatedQuestionPlayRequestedRef.current = false;
  suppressGeneratedAudioStreamRef.current = false;
  teardownStreamingPlayer();
  setIsSlidingBack(false);
  setIsCategorizationPending(false);
  setShowAvatar(false);
  setIsGeneratedQuestionPlaying(false);
  hasSlidCloserRef.current = false;
  dismissingQuestionRef.current = null;
  if (generatedQuestionAudioRef.current) {
    generatedQuestionAudioRef.current.pause();
    generatedQuestionAudioRef.current = null;
  }
  if (generatedQuestionAudioUrlRef.current) {
    URL.revokeObjectURL(generatedQuestionAudioUrlRef.current);
    generatedQuestionAudioUrlRef.current = null;
  }
};

const getCurrentPageReinforcementContext = () => {
  const currentState = stateRef.current;
  const page = currentState.pagesValues[currentState.page];
  const lines = page?.text || [];
  const bookText = `Page ${currentState.page + 1}:\n` +
    lines.map(l => `${l.Character}: ${stripSSMLTags(l.Dialogue)}`).join('\n');

  return {
    currentPageQuestion: page?.question || '',
    bookText,
    currentPageNumber: currentState.page + 1,
    imageDescriptionRef,
    userAttention: userAttentionRef.current,
  };
};

const playReinforcement = async (reply) => {
  const currentState = stateRef.current;
  const pageQuestion = currentState.pagesValues[currentState.page]?.question || '';
  const question = reinforcementSessionRef.current.question || lastAskedQuestionRef.current || pageQuestion;
  const requestSeq = reinforcementRequestSeqRef.current + 1;

  reinforcementRequestSeqRef.current = requestSeq;
  reinforcementModeRef.current = true;
  reinforcementSessionRef.current = {
    question,
    turns: reinforcementSessionRef.current.turns || [],
  };
  setAwaitingQuestionAnswer(false);
  stopReinforcementAudio();

  console.log("Generating reinforcement. Question:", question, "Reply:", reply);

  try {
    const context = getCurrentPageReinforcementContext();
    if (remoteAudioRef.current) remoteAudioRef.current.muted = true;

    const finishStreamingReinforcement = () => {
      if (reinforcementStreamingPlayerRef.current) {
        reinforcementStreamingPlayerRef.current = null;
      }
      setIsReinforcementPlaying(false);
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
      },
      onAudioChunk: (seq, audioContent) => {
        if (requestSeq !== reinforcementRequestSeqRef.current || !reinforcementModeRef.current) return;
        if (!reinforcementStreamingPlayerRef.current) {
          reinforcementStreamingPlayerRef.current = createStreamingPcmPlayer({
            onEnded: finishStreamingReinforcement,
            onError: (err) => {
              console.error("Reinforcement streaming player error:", err);
              finishStreamingReinforcement();
            },
          });
          setIsReinforcementPlaying(true);
          Promise.resolve(reinforcementStreamingPlayerRef.current.resume()).catch((err) => {
            console.error("Reinforcement Gemini TTS playback error:", err);
            finishStreamingReinforcement();
          });
        }
        reinforcementStreamingPlayerRef.current.pushChunk(seq, audioContent);
      },
      onAudioEnd: () => {
        if (requestSeq !== reinforcementRequestSeqRef.current || !reinforcementModeRef.current) return;
        if (reinforcementStreamingPlayerRef.current) reinforcementStreamingPlayerRef.current.end();
        else finishStreamingReinforcement();
      },
      onAudioError: (message) => {
        console.error("Reinforcement Gemini TTS stream error:", message);
        if (requestSeq === reinforcementRequestSeqRef.current) finishStreamingReinforcement();
      },
    });

    if (requestSeq === reinforcementRequestSeqRef.current && !reinforcementStreamingPlayerRef.current) {
      finishStreamingReinforcement();
    }
  } catch (error) {
    console.error("Reinforcement generation/playback error:", error);
    if (requestSeq === reinforcementRequestSeqRef.current) {
      setIsReinforcementPlaying(false);
      if (remoteAudioRef.current && !isMuted) {
        remoteAudioRef.current.muted = false;
      }
    }
  }
};

useEffect(() => {
  const wasPlaying = wasGeminiAudioPlayingRef.current;
  if (wasPlaying && !isGeminiAudioPlaying && dismissingQuestionRef.current) {
    setIsSlidingBack(true);
  }
  wasGeminiAudioPlayingRef.current = isGeminiAudioPlaying;
}, [isGeminiAudioPlaying]);

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

  if (!streamingPlayerRef.current) {
    streamingPlayerRef.current = createGeneratedQuestionPlayer(cachedQuestion);
  }

  generatedQuestionPlayRequestedRef.current = true;
  setIsGeneratedQuestionPlaying(true);
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

async function speak(text, voiceName = "kore", emotion = "neutral", role = null) {
  // prevent multiple audio calls
  if (isAudioPlaying) {
    return;
  }

  try {
    const clean = stripSSMLTags(String(text || "").trim());
    if (!clean) return;

    setIsAudioPlaying(true);

    const { audio } = await say({
      text: clean,
      voiceName,
      emotion,
      role,
    });

    setAudio(audio);
    audio.addEventListener("ended", audioEnded);
  } catch (err) {
    console.error("TTS error:", err);
    setIsAudioPlaying(false);
    setTimeout(() => {
      setAudioHasEnded(true);
    }, 100);
  }
}

  useHotkeys("space", (event) => {
    event.preventDefault();

    // Only play audio if it's the child's turn (yellow highlighted line)
    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    if (!currentLine || !currentLine.Reading) return;

    const currentRole = state.CharacterRoles.find(
      (option) => option.Character === currentLine.Character
    );

    if (currentRole?.role === "Child") {
      const voiceName = currentRole?.VA || "kore";
      speak(currentLine.Dialogue, voiceName, "neutral", currentRole.role);
      setChildHasPlayed(true);
    }
  });

  useHotkeys("enter", (event) => {
    event.preventDefault();
    handlePlayClick(); // Acts as "Next" button
  });


  const audioEnded = React.useCallback(() => {
    console.log("Audio has finished playing!");
    console.log("audioEnded triggered. Current isPlaying:", isPlaying);

    if (audio) {
        audio.removeEventListener("ended", audioEnded);
    }

    if (isPageQuestionPlayingRef.current) {
      setAwaitingQuestionAnswer(true);
      isPageQuestionPlayingRef.current = false;
    }

    setIsAudioPlaying(false);
    setIsPageQuestionPlaying(false);
    setAudioHasEnded(true);
    setIsButtonDisabled(false);
}, [audio, isPlaying]);


const continueReading = React.useCallback(async (page, index, roles, isLastLine = false) => {
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
    // keep highlighting behavior but do not play audio
    if (index > 0) page.text[index - 1].Reading = false;
    page.text[index].Reading = true;

    if (isLastLine) {
      console.log("Last line is Parent/Child/Dummy - simulating audio end");
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
      console.log("Last line has no voice - simulating audio end");
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
      console.log("Last line has no dialogue - simulating audio end");
      setTimeout(() => {
        setAudioHasEnded(true);
      }, 100);
    } else {
      setIsPlaying(false);
    }
    return;
  }

  try {
    const { audio } = await say({
      text: dialogue,
      voiceName: currentVoiceName,
      emotion: "neutral",
      role: currentRole,
    });
    console.log("TTS audio ready, starting playback...");
    setIsAudioPlaying(true);
    setAudio(audio);
    if (isLastLine) {
      audio.addEventListener("ended", () => {
        line.Reading = false;
        audioEnded();
      });
    } else {
      audio.addEventListener("ended", audioEnded);
    }
  } catch (error) {
    console.error("TTS error:", error);
    setIsAudioPlaying(false);
    setTimeout(() => {
      setAudioHasEnded(true);
    }, 100);
  }
}, [audioEnded]);


/**
* Handle the "Next" button click.
* This function determines if we should continue reading from the current page
* or move to the next page.
*/
const handleNextClick = React.useCallback((trigger = "manual") => {
 if (reinforcementModeRef.current) {
   clearQuestionUI();
 }

 const markLineChange = trigger === "auto"
   ? markNextLineChangeAutomatic
   : markNextLineChangeManual;

 // Check if there's more text on the current page to read
 if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
     // Continue reading the current page
     setAudioHasEnded(false);
     setState(prevState => {
       const isLastLine = prevState.index === prevState.pagesValues[prevState.page].text.length - 1;
       continueReading(
         prevState.pagesValues[prevState.page],
         prevState.index,
         state.CharacterRoles,
         isLastLine
       );
       const newState = {...prevState, index: prevState.index+1};
       markLineChange({ page: newState.page, index: newState.index });
       return newState;
     });
 } else {

     // If there's no more text on the current page, check if there are more pages to go to
      if (state.page < state.pagesValues.length - 1) {
        //userUtterancesRef.current = []; // Clear user utterances when moving to next page
        clearQuestionUI();
        if (isPlaying) {
         setIsPlaying(false);
        } else {
         console.log("new page")
         const hasOffScript = offScriptLogRef?.current?.length > 0;
         if (questionGenEnabledRef.current) {
           sendOffScriptLog(
             offScriptLogRef,
             state.page,
             state,
             hasOffScript ? () => setIsCategorizationPending(false) : undefined,
             imageDescriptionRef,
             userAttentionRef.current,
             hasOffScript ? () => setIsCategorizationPending(true) : undefined,
             pendingGeneratedQuestionRef.current || null,
             narratorRole?.VA || null,
             handleAudioChunk,
             handleAudioEnd,
             handleAudioError,
             startGeneratedQuestion,
           );
         }
         for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
           state.pagesValues[state.page].text[i].Reading=false;
         }
         setState(prevState => {
           const nextPage = prevState.pagesValues[prevState.page + 1];
           const isLastLine = nextPage.text.length === 1;
           continueReading(nextPage, 0, state.CharacterRoles, isLastLine);
           const nextState = {...prevState, page: prevState.page + 1, index: 1};
           markLineChange({ page: nextState.page, index: nextState.index });
           return nextState;
         });
          if (tableContainerRef.current) {
            tableContainerRef.current.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }
      } else {
       console.log("last page")
         // If we're on the last page, mark the last text as not being read
         if(state.pagesValues[state.page]?.text && state.pagesValues[state.page].text[state.index - 1]){
             state.pagesValues[state.page].text[state.index-1].Reading = false;
         }
         // Set hasReachedEnd to true if at the end of the last page
         setState(prevState => ({
           ...prevState,
           hasReachedEnd: state.page === state.pagesValues.length - 1 && state.pagesValues[state.page].text.length === state.index
         }));
         setIsPlaying(false);
      }
 }


 // If a table container reference exists, scroll it into view
 if (dialogueRefs.current[state.index]) {
     dialogueRefs.current[state.index].scrollIntoView({
         behavior: "smooth",
         block: "center",
     });
 }
 }, [state, isPlaying, dialogueRefs, continueReading, markNextLineChangeAutomatic, markNextLineChangeManual]);
const prevStates = useRef({ audioHasEnded, isPlaying, handleNextClick });

React.useEffect(() => {

  prevStates.current = {
    audioHasEnded,
    isPlaying,
    handleNextClick,
  };

  if (audioHasEnded && isPlaying) {
      const hasMoreLinesOnPage =
        state.pagesValues[state.page]?.text?.length - 1 >= state.index;

      if (generatedQuestion && showAvatar && !hasMoreLinesOnPage) {
        setIsPlaying(false);
        setAudioHasEnded(false);
        setIsButtonDisabled(false);
        return;
      }

      // audioHasEnded becomes true via either natural audio-end OR the
      // utterance matcher's advanceToNextLine — never via a user click.
      handleNextClick("auto");
      setAudioHasEnded(false);
  }
}, [audioHasEnded, isPlaying, handleNextClick, generatedQuestion, showAvatar, state.page, state.index, state.pagesValues]);

// If the user read the line move to next line.
const lastProcessedUtteranceRef = useRef("");
const userUtterancesRef = useRef([]);
const accumulatedUtterancesRef = useRef([]);
const utteranceQueuesRef = useRef([]);
const currentLineTrackingRef = useRef({ page: -1, index: -1 });
const offScriptLogRef = useRef([]); 
const currentPageRef = useRef(state.page);
React.useEffect(() => { currentPageRef.current = state.page; }, [state.page]);

React.useEffect(() => {
  // No explicit trigger set means the change wasn't driven by a user click.
  // Targeted triggers prevent a later auto advance from overwriting a manual
  // trigger that was queued for a different page/index.
  const key = `${state.page}:${state.index}`;
  const targetedTrigger = pendingLineTriggersRef.current.get(key);
  if (targetedTrigger) {
    pendingLineTriggersRef.current.delete(key);
  }
  const trigger = targetedTrigger || pendingUntargetedLineTriggerRef.current || "auto";
  if (!targetedTrigger) {
    pendingUntargetedLineTriggerRef.current = null;
  }
  lineChange(state.page, state.index, { trigger });
}, [state.page, state.index]);

React.useEffect(() => { stateRef.current = state; });

// Jump to a specific line index
const jumpToLine = useCallback((lineIndex) => {
  setAudioHasEnded(false);
  setIsPlaying(true);
  setState(prevState => {
    const page = prevState.pagesValues[prevState.page];
    const isLastLine = lineIndex === page.text.length;

    const currentIdx = prevState.index - 1;
    if (currentIdx >= 0 && page.text[currentIdx]) {
      page.text[currentIdx].Reading = false;
    }

    for (let i = currentIdx + 1; i < lineIndex - 1; i++) {
      if (page.text[i]) {
        page.text[i].Reading = false;
      }
    }

    continueReading(page, lineIndex - 1, prevState.CharacterRoles, isLastLine);

    const nextState = { ...prevState, index: lineIndex };
    markNextLineChangeAutomatic({ page: nextState.page, index: nextState.index });
    return nextState;
  });
}, [continueReading, markNextLineChangeAutomatic]);

React.useEffect(() => {
  processUserUtterance({
    userUtterance,
    lastProcessedUtteranceRef,
    userUtterancesRef,
    accumulatedUtterancesRef,
    utteranceQueuesRef,
    currentLineTrackingRef,
    offScriptLogRef,
    state: stateRef.current,
    condition,
    speakerLabels,
    gotoNextPage,
    jumpToLine,
    setAudioHasEnded,
    setIsPlaying,
    onAutoLineAdvance: markNextLineChangeAutomatic,
    onCategorizationStart: () => setIsCategorizationPending(true),
    onCategorizationResult: (result) => {
      if (result?.sourcePage !== stateRef.current.page) return;
      setIsCategorizationPending(false);
      // Note: setGeneratedQuestion is fired earlier via onQuestionReady (on
      // the SSE `done` event) so the text reveal can keep up with the
      // incoming chunks. This handler just clears the pending UI flag.
    },
    onQuestionReady: (questionText) => {
      // Fires synchronously inside the SSE reader the moment `done` parses,
      // before any audio_chunk events for this question are processed. That
      // ordering lets the text reveal slice the right prefix as each chunk
      // arrives. We still suppress this if a previous question is mid-play.
      if (isGeneratedQuestionPlayingRef.current) {
        suppressGeneratedAudioStreamRef.current = true;
        return;
      }
      startGeneratedQuestion(questionText);
    },
    imageDescriptionRef,
    userAttentionRef,
    pendingGeneratedQuestionRef,
    ttsVoiceName: narratorRole?.VA || null,
    onAudioChunk: handleAudioChunk,
    onAudioEnd: handleAudioEnd,
    onAudioError: handleAudioError,
    questionGenEnabledRef,
    isReinforcementModeRef: reinforcementModeRef,
    onQuestionAnswered: playReinforcement,
    onReinforcementUtterance: playReinforcement,
    onReadingResumed: finishQuestionInteraction
  });
  }, [userUtterance]);



function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}


  function parseText(text) {
     // Strip SSML tags
    const strippedText = stripSSMLTags(text);
    // Replace **bold** and *italic* and ***bold italic*** markers with corresponding HTML tags
    const htmlText = text
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')  // ***bold italic***
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **bold**
      .replace(/\*(.*?)\*/g, '<em>$1</em>');  // *italic*

    // Use dangerouslySetInnerHTML to inject HTML tags into the React component
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

          if(currentRole.role === "Dummy"){
            isActiveRowParent = true;
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
                  speak(val.Dialogue, voiceName, "neutral", role);
                  setChildHasPlayed(true);
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


  function renderQuestion() {
    if (questionHistory.length === 0) return null;
    const isSpeaking = isGeneratedQuestionPlaying || isPageQuestionPlaying;
    const latestIdx = questionHistory.length - 1;
    const latest = questionHistory[latestIdx];

    const handleLatestClick = () => {
      if (latest.type === 'generated') speakGenerated();
      else playSound();
    };

    return (
      <div className={`question-area ${showAvatar ? 'has-avatar' : ''} ${isSlidingBack ? 'avatar-dismissing' : ''}`}>
        {showAvatar && (
          <div className="role-image-container">
            <img
              id="role-image"
              src={narratorImage}
              alt="Narrator"
              onClick={handleLatestClick}
              style={{ cursor: 'pointer' }}
              className={isSlidingBack ? 'slide-back' : (hasSlidCloserRef.current ? 'slide-closer-hold' : 'slide-closer')}
              onAnimationEnd={(e) => {
                if (e.animationName === 'slide-closer') {
                  hasSlidCloserRef.current = true;
                } else if (e.animationName === 'slide-back') {
                  dismissingQuestionRef.current = null;
                  setIsSlidingBack(false);
                  setShowAvatar(false);
                  hasSlidCloserRef.current = false;
                }
              }}
            />
          </div>
        )}
        <div className="question-history">
          {questionHistory.map((msg, i) => {
            const isLatest = i === latestIdx;
            const isPrevious = i === latestIdx - 1;
            // The latest generated question reveals incrementally as TTS audio
            // chunks arrive; older generated questions and page questions
            // always show their full text.
            const isLatestGenerated = isLatest && msg.type === 'generated';
            const displayText = isLatestGenerated ? (revealedQuestion || msg.text) : msg.text;
            const isRevealing = isLatestGenerated && Boolean(revealedQuestion) && revealedQuestion.length < msg.text.length;
            const classes = [
              'question-message',
              msg.type,
              isLatest ? 'latest' : isPrevious ? 'previous' : 'hidden',
              isLatest && isSpeaking ? 'speaking' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={msg.id}
                className={classes}
                onClick={isLatest ? handleLatestClick : undefined}
                style={{ cursor: isLatest ? 'pointer' : 'default' }}
              >
                {displayText}
                {isRevealing && <span className="reveal-cursor">▍</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  function renderNavigationButtons() {
    const isLastIndex = state.pagesValues[state.page].text.length === state.index;
    const isLastPage = state.page === state.pagesValues.length - 1;

    
    // Check if current line is child's turn
    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    const currentRoleNav = currentLine ? state.CharacterRoles.find(
      (option) => option.Character === currentLine.Character
    ) : null;
    const isChildTurn = currentRoleNav?.role === "Child" && currentLine?.Reading;

    // Disable button if it's child's turn and they haven't played yet
    const shouldDisableButton = isButtonDisabled || isAudioPlaying;
    // const shouldDisableButton = isButtonDisabled || isAudioPlaying || (isChildTurn && !childHasPlayed);

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

  function handlePlayClick() {
    console.log("handlePlayClick triggered. Current isPlaying:", isPlaying);

    if (isAudioPlaying) {
      return;
    }

    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    const currentRoleCheck = currentLine ? state.CharacterRoles.find(
      (option) => option.Character === currentLine.Character
    ) : null;

    if (state.hasReachedEnd) {
      if (isTraining) navigate('/Home', { state: { name } });
      else navigate('/Survey', { state: { id, name, condition } });
      return;
    }

    // if this happens to be last line, no option to pause it, just wait until the playing is done.
    if(state.pagesValues[state.page].text.length === state.index && isPlaying){
      console.log("Too late pause the audio cuz it's the last line. ")
      return;
    }

    setIsPlaying(prevIsPlaying => {
      if (prevIsPlaying) {
        return false;
      } else {
        return true;
      }
    });

    if (!isPlaying) {
      console.log("page size ", state.pagesValues[state.page]?.text?.length);
      console.log("current index", state.index);
      if (state.index === 0 || state.pagesValues[state.page]?.text?.length === state.index) {
        console.log("start reading");
        handleNextClick("manual");
      } else {
        console.log("resume reading");
        var currentCharacter = state.CharacterRoles.filter(obj => obj.Character === state.pagesValues[state.page].text[state.index - 1].Character);
        console.log(currentCharacter);
        if (!currentCharacter[0].VA ||
            currentCharacter[0].role === "Parent" ||
            currentCharacter[0].role === "Child" ||
            currentCharacter[0].role === "Dummy") {
          handleNextClick("manual");
        }
      }
    } else {
      console.log("Was playing and you paused");
    }
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
        onClick={handleTestQuestionClick}
        className="btn btn-outline-secondary"
        disabled={process.env.NODE_ENV !== 'development'}
        style={{ fontSize: '12px', padding: '4px 10px', marginRight: '10px' }}
      >Test Question</button>

      <button
        onClick={openDebugMonitor}
        className="btn btn-outline-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
      >Debug</button>

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

    {deepgramConnected && deepgramTranscript && (
      <div className="deepgram-transcript-container" style={{
        margin: '10px 20px',
        padding: '15px',
        backgroundColor: '#f0f0f0',
        borderRadius: '8px',
        border: '2px solid #4CAF50'
      }}>
        {speakerLabels && (
          <div style={{
            marginBottom: '8px',
            padding: '5px 10px',
            backgroundColor: '#2196F3',
            color: 'white',
            borderRadius: '4px',
            display: 'inline-block',
            fontWeight: 'bold',
            fontSize: '0.9em'
          }}>
            {speakerLabels}
          </div>
        )}
        <div>
          <strong>Transcript:</strong> {deepgramTranscript}
        </div>
      </div>
    )}

    <div className="row">
      <div className="col-md-5">
        <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
          <img src={state.pagesValues[state.page].img} alt="current page" style={{ width: '100%', display: 'block' }} />
            {imageTags.map((tag, i) => {
              const [y0, x0, y1, x1] = tag.box_2d;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: `${y0 / 10}%`, left: `${x0 / 10}%`,
                    height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%`,
                    cursor: 'crosshair',
                  }}
                  title={tag.label}
                  onClick={() => { userAttentionRef.current = tag.label; console.log('[userAttention]', tag.label); }}
                />
              );
            })}
        </div>
        {renderQuestion()}
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
