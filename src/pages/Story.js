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
import { processUserUtterance, sendReinforcementLog, abortCurrentCategorization, setAwaitingQuestionAnswer, resetReinforcementSnapshot, resetOffScriptStateForPage, buildBookContext } from "../utils/utteranceProcessor";
import { createStreamingPcmPlayer } from "../utils/streamingPcmPlayer";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
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
  const previewOnly = process.env.REACT_APP_PREVIEW_ONLY === 'true';
  const location = useLocation();
  const navigate = useNavigate();
  const [, setIsAudioPlaying] = useState(false);
  const [isGeneratedQuestionPlaying, setIsGeneratedQuestionPlaying] = useState(false);
  const [isPageQuestionPlaying, setIsPageQuestionPlaying] = useState(false);
  const [isReinforcementPlaying, setIsReinforcementPlaying] = useState(false);
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const name = location.state?.name || null;
  const isTraining = location.state?.training === true;
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  const PRELOAD_CONCURRENCY = 1;
  const TEST_GENERATED_QUESTION = "How do you think Zoe is feeling?";
  const REALTIME_ENABLED = true;
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

  const [isThoughtRevealed, setIsThoughtRevealed] = useState(false);

  const isGeneratedQuestionPlayingRef = useRef(false);

  const [isCategorizationPending, setIsCategorizationPending] = useState(false);
  const [questionHistory, setQuestionHistory] = useState([]);
  const [showAvatar, setShowAvatar] = useState(false);

  const [inReinforcementLoop, setInReinforcementLoop] = useState(false);
  const showAvatarRef = useRef(false);
  useEffect(() => { showAvatarRef.current = showAvatar; }, [showAvatar]);
  useEffect(() => { isGeneratedQuestionPlayingRef.current = isGeneratedQuestionPlaying; }, [isGeneratedQuestionPlaying]);
  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
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
  const reinforcementAudioBlockedRef = useRef(false);

  const reinforcementActiveRef = useRef(false);
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

  useEffect(() => {
    frames.forEach(src => { const img = new Image(); img.src = src; });
  }, [frames]);

  function changeFrame() {
    const imgElement = document.getElementById("role-image");
    if (!imgElement) {
      console.warn("[changeFrame] role-image element not found in DOM");
      return;
    }
    const nextIdx = (frameIndexRef.current + 1) % frames.length;
    frameIndexRef.current = nextIdx;
    const nextSrc = frames[nextIdx];
    imgElement.src = nextSrc;
    console.log(`[changeFrame] tick idx=${nextIdx}/${frames.length} src=${nextSrc} role=${narratorRole?.role}`);
  }

  useEffect(() => {
    let intervalId = null;
    const anyPlaying = isGeneratedQuestionPlaying || isPageQuestionPlaying || isGeminiAudioPlaying || isReinforcementPlaying;
    console.log("[changeFrame] effect run", {
      anyPlaying,
      isGeneratedQuestionPlaying,
      isPageQuestionPlaying,
      isGeminiAudioPlaying,
      isReinforcementPlaying,
      showAvatar,
      framesLen: frames.length,
      role: narratorRole?.role,
    });
    if (anyPlaying) {
      intervalId = setInterval(changeFrame, 250);
    } else {
      frameIndexRef.current = 0;
      const imgElement = document.getElementById("role-image");
      if (imgElement) imgElement.src = (showAvatar && inReinforcementLoop) ? listeningImage : frames[0];
    }
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isGeneratedQuestionPlaying, isPageQuestionPlaying, isGeminiAudioPlaying, isReinforcementPlaying, showAvatar, inReinforcementLoop, listeningImage]);

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

  useEffect(() => {
    const pageText = state.pagesValues[state.page]?.text
      ?.map(t => stripSSMLTags(t.Dialogue)).join(' ') || '';
    userAttentionRef.current = null;
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

    const narratorInfo = voiceByChar.get('Narrator');
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
      if (page.question && narratorInfo) {
        tasks.push({
          text: page.question,
          voiceName: narratorInfo.voiceName,
          role: narratorInfo.role
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
  }, [state.page, state.pagesValues, state.CharacterRoles]);

const gotoNextPage = () => {

  clearQuestionUI();
  resetOffScriptStateForPage(offScriptLogRef);

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
    else navigate('/Survey', { state: { id, name } });
  }
};


const gotoPreviousPage = () => {
  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);
  clearQuestionUI();

  resetOffScriptStateForPage(offScriptLogRef);

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

  }
};

const playSound = () => {
  const narratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
  const voiceName = narratorRole?.VA || "kore";
  const role = narratorRole?.role || null;
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

const streamingPlayerRef = useRef(null);
const fullQuestionTextRef = useRef('');
const cumulativeAudioMsRef = useRef(0);
const generatedQuestionAudioChunksRef = useRef([]);
const generatedQuestionAudioEndedRef = useRef(false);
const generatedQuestionAudioErrorRef = useRef(null);
const generatedQuestionPlayRequestedRef = useRef(false);
const suppressGeneratedAudioStreamRef = useRef(false);
const generatedQuestionPendingRef = useRef(false);
const [revealedQuestion, setRevealedQuestion] = useState('');
const fullReinforcementTextRef = useRef('');
const cumulativeReinforcementMsRef = useRef(0);
const [revealedReinforcement, setRevealedReinforcement] = useState('');
const reinforcementFromPageQuestionRef = useRef(false);

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
  endAudio(AUDIO_SOURCES.GENERATED_QUESTION);
  if (questionText) lastAskedQuestionRef.current = questionText;
  setAwaitingQuestionAnswer(true);
  setShowAvatar(true);
  setInReinforcementLoop(true);
}, [endAudio, isMuted, remoteAudioRef]);

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
}, [isMuted, remoteAudioRef, stopReinforcementAudio]);

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
  endAudio(AUDIO_SOURCES.GENERATED_QUESTION);
  setIsCategorizationPending(false);
  setShowAvatar(false);
  setIsGeneratedQuestionPlaying(false);
  setQuestionHistory([]);
  setIsThoughtRevealed(false);
  setRevealedReinforcement('');
  fullReinforcementTextRef.current = '';
  cumulativeReinforcementMsRef.current = 0;
  reinforcementFromPageQuestionRef.current = false;
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

const clearQuestionUIRef = useRef(clearQuestionUI);
React.useEffect(() => { clearQuestionUIRef.current = clearQuestionUI; });

const getCurrentPageReinforcementContext = () => {
  const currentState = stateRef.current;
  const page = currentState.pagesValues[currentState.page];
  const bookText = buildBookContext(currentState.pagesValues, currentState.page);

  return {
    currentPageQuestion: page?.question || '',
    bookText,
    currentPageNumber: currentState.page + 1,
    imageDescriptionRef,
    userAttention: userAttentionRef.current,
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
  reinforcementActiveRef.current = true;
  fullReinforcementTextRef.current = '';
  cumulativeReinforcementMsRef.current = 0;
  setRevealedReinforcement('');

  console.log("Generating reinforcement. Question:", question, "Reply:", reply);

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

useEffect(() => {
  const wasPlaying = wasGeminiAudioPlayingRef.current;
  if (wasPlaying && !isGeminiAudioPlaying && dismissingQuestionRef.current) {
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

    const { audio } = await say({
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

    setAudio(audio);
    audio.addEventListener("ended", handleEnded, { once: true });
    audio.addEventListener("error", handleError, { once: true });
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


  const audioEnded = React.useCallback(() => {

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
        if (isLastLine) line.Reading = false;
      },
    }
  );

  if (!started) {
    setIsPlaying(false);
  }
}, [audioEnded]);

const handleNextClick = React.useCallback((trigger = "manual") => {
 const markLineChange = trigger === "auto"
   ? markNextLineChangeAutomatic
   : markNextLineChangeManual;

 if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
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
      if (state.page < state.pagesValues.length - 1) {
        if (isPlaying) {
         setIsPlaying(false);
        } else {
         clearQuestionUI();
         resetOffScriptStateForPage(offScriptLogRef);
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
         if(state.pagesValues[state.page]?.text && state.pagesValues[state.page].text[state.index - 1]){
             state.pagesValues[state.page].text[state.index-1].Reading = false;
         }
         setState(prevState => ({
           ...prevState,
           hasReachedEnd: state.page === state.pagesValues.length - 1 && state.pagesValues[state.page].text.length === state.index
         }));
         setIsPlaying(false);
      }
 }

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
  if (showAvatarRef.current) {
    clearQuestionUIRef.current();
  }
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
    onQuestionReady: (questionText) => {
      if (!questionGenEnabledRef.current) return;  
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
    generatedQuestionPendingRef,
    onQuestionAnswered: playReinforcement,
    onReinforcementUtterance: playReinforcement
  });
  }, [userUtterance]);



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


  function renderQuestion() {
    if (questionHistory.length === 0 ) return null;
    const isSpeaking = isGeneratedQuestionPlaying || isPageQuestionPlaying || isReinforcementPlaying;
    const latestIdx = questionHistory.length - 1;
    const latest = questionHistory[latestIdx];

    const handleLatestClick = () => {
      if (latest.type === 'generated') speakGenerated();
      // Reinforcement plays automatically; tapping it does nothing.
      else if (latest.type === 'reinforcement') { /* no-op */ }
      else playSound();
    };

    return (
      // ${isSlidingBack ? 'avatar-dismissing' : ''} TODO: Remove
      <div className={`question-area ${showAvatar ? 'has-avatar' : ''}`}>
        {showAvatar && (
          <div className="role-image-container">
            <img
              id="role-image"
              src={narratorImage}
              alt="Narrator"
              onClick={handleLatestClick}
              style={{ cursor: 'pointer' }}
            />
          </div>
        )}
        <div className="question-history">
          {questionHistory.map((msg, i) => {
            const isLatest = i === latestIdx;
            const isPrevious = i === latestIdx - 1;
            const isLatestGenerated = isLatest && msg.type === 'generated';
            const isLatestReinforcement = isLatest && msg.type === 'reinforcement';
            const showThoughtTeaser = isLatestGenerated && !isThoughtRevealed;
            const displayText = showThoughtTeaser
              ? 'I have a thought.'
              : isLatestGenerated
                ? (revealedQuestion || msg.text)
                : isLatestReinforcement
                  ? revealedReinforcement
                  : msg.text;
            const isRevealing =
              (isLatestGenerated && isThoughtRevealed && Boolean(revealedQuestion) && revealedQuestion.length < msg.text.length) ||
              (isLatestReinforcement && Boolean(revealedReinforcement) && revealedReinforcement.length < msg.text.length);
            const latestIsGenerated = latest?.type === 'generated';
            const positionClass = inReinforcementLoop
              ? (isLatestReinforcement ? 'latest' : 'hidden')
              : isLatest
                ? 'latest'
                : (latestIsGenerated ? 'hidden' : (isPrevious ? 'previous' : 'hidden'));
            const classes = [
              'question-message',
              msg.type,
              positionClass,
              isLatest && isSpeaking ? 'speaking' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={msg.id}
                className={classes}
                onClick={isLatest ? handleLatestClick : undefined}
                style={{ cursor: isLatest ? 'pointer' : 'default' }}
              >
                <span className="question-bubble-text">
                  {displayText}
                  {isRevealing && <span className="reveal-cursor">▍</span>}
                </span>
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

    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
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

  function handlePlayClick() {

    if (isAnyAudioPlaying) {
      return;
    }

    if (state.hasReachedEnd) {
      if (isTraining) navigate('/Home', { state: { name } });
      else navigate('/Survey', { state: { id, name } });
      return;
    }

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
      if (state.index === 0 || state.pagesValues[state.page]?.text?.length === state.index) {
        handleNextClick("manual");
      } else {
        var currentCharacter = state.CharacterRoles.filter(obj => obj.Character === state.pagesValues[state.page].text[state.index - 1].Character);
        if (!currentCharacter[0].VA ||
            currentCharacter[0].role === "Parent" ||
            currentCharacter[0].role === "Child" ||
            currentCharacter[0].role === "Dummy") {
          handleNextClick("manual");
        }
      }
    } else {
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
