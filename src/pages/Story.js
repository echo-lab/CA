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
import { processUserUtterance, sendOffScriptLog, abortCurrentCategorization, setAwaitingQuestionAnswer } from "../utils/utteranceProcessor";
import { ImageAnalysis, ImageTagging, prefetchPage } from "../utils/imageAnalysis";
import { openDebugMonitor } from "../utils/debugMonitor";

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
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const condition = location.state?.condition || null;
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  // How many warm requests to run in parallel
  const PRELOAD_CONCURRENCY = 1;
  // Hardcoded feature flags
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
    sendContentMessage,
    sendContentMessageGemini,
    isMuted,
    userUtterance,
    speakerLabels,
    remoteAudioRef,
    deepgramConnected,
    deepgramTranscript,
    connectToDeepgram,
    disconnectDeepgram,
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

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioHasEnded, setAudioHasEnded] = useState(false);
  const [generatedQuestion, setGeneratedQuestion] = useState(null);

  // isCategorizationPending is a UI mirror of utteranceProcessor's module-level
  // flag. utteranceProcessor's sendOffScriptLog is the single source of truth;
  // it drives this state via onCategorizationStart / onCategorizationResult callbacks.
  const [isCategorizationPending, setIsCategorizationPending] = useState(false);
  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
  const [isSlidingBack, setIsSlidingBack] = useState(false);
  // Tracks whether slide-closer has already played. Prevents re-triggering
  // the animation when a new generated question replaces an existing one —
  // the image stays in place, only the question text/audio updates.
  const hasSlidCloserRef = useRef(false);
  const generatedQuestionAudioRef = useRef(null);
  const dismissingQuestionRef = useRef(null);
  const imageDescriptionRef = useRef(null);
  const [imageTags, setImageTags] = useState([]);
  const userAttentionRef = useRef(null);
  const pagesWithoutPageQuestionRef = useRef(0);
  const pendingPageQuestionFlag = useRef(false);
  const lastAskedQuestionRef = useRef(null);
  const isPageQuestionPlayingRef = useRef(false);


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

  // Animate the role-image when generated question is playing
  useEffect(() => {
    let intervalId = null;
    if (isGeneratedQuestionPlaying || isPageQuestionPlaying) {
      intervalId = setInterval(changeFrame, 250);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
      // Reset to default frame
      frameIndexRef.current = 0;
      const imgElement = document.getElementById("role-image");
      if (imgElement) imgElement.src = frames[0];
    };
  }, [isGeneratedQuestionPlaying, isPageQuestionPlaying]);

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
    if (hasOffScript) {
      // generatedQuestion already cleared by clearQuestionUI above
    } else {
      // No off-script utterances on this page — counts as no PAGE_QUESTION
      pagesWithoutPageQuestionRef.current += 1;
      if (pagesWithoutPageQuestionRef.current >= 4) {
        const pageQuestion = state.pagesValues[state.page]?.question;
        if (pageQuestion) {
          pendingPageQuestionFlag.current = true;
          pagesWithoutPageQuestionRef.current = 0;
        }
      }
    }
    console.log("sendOffScriptLog called, page:", state.page);
    sendOffScriptLog(offScriptLogRef, state.page, state, hasOffScript ? (result) => {
      setIsCategorizationPending(false);

      const hasPageQuestion = result?.items?.some(i => i.category === 'PAGE_QUESTION');
      if (hasPageQuestion) {
        pagesWithoutPageQuestionRef.current = 0;
      } else {
        // If LLM didn't identify a PAGE_QUESTION, increment the counter
        pagesWithoutPageQuestionRef.current += 1;
      }

      if (pagesWithoutPageQuestionRef.current >= 4) {
        const pageQuestion = state.pagesValues[result.sourcePage]?.question;
        if (pageQuestion) {
          pendingPageQuestionFlag.current = true;
          pagesWithoutPageQuestionRef.current = 0;
          return;
        }
      }

      // if (result?.generatedQuestion) {
      //   setGeneratedQuestion(result.generatedQuestion);
      // }
    } : undefined, imageDescriptionRef, userAttentionRef.current, hasOffScript ? () => setIsCategorizationPending(true) : undefined);
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
      return { ...prevState, page: prevState.page + 1, index: 0 };
    });
  } else {
    navigate('/Home', { state: { id: 1 } });
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
    setState(prevState => ({ ...prevState, page: prevState.page - 1, index: 0 }));
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

// Pre-fetch TTS audio when a generated question arrives (without auto-playing)
useEffect(() => {
  if (!generatedQuestion) return;

  // Clean up old audio before fetching new one
  if (generatedQuestionAudioRef.current) {
    generatedQuestionAudioRef.current.pause();
    generatedQuestionAudioRef.current = null;
  }

  let cancelled = false;
  const narratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
  const voiceName = narratorRole?.VA || "kore";
  const role = narratorRole?.role || null;
  const BASE_URL = process.env.REACT_APP_API_BASE;

  fetch(`${BASE_URL}/live/say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: generatedQuestion, voiceName, emotion: "neutral", role }),
  })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then(blob => {
      if (cancelled) { URL.revokeObjectURL(URL.createObjectURL(blob)); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url));
      audio.addEventListener("error", () => URL.revokeObjectURL(url));
      generatedQuestionAudioRef.current = audio;
    })
    .catch(err => console.error('TTS pre-fetch error:', err));

  return () => { cancelled = true; };
}, [generatedQuestion]);

// Wipe both the displayed question and any in-flight categorization.
// Called on every page transition so stale state can't leak across pages.
const clearQuestionUI = () => {
  abortCurrentCategorization();
  setAwaitingQuestionAnswer(false);
  // Don't null lastAskedQuestionRef here — it gets reseeded with the new
  // page's question by the page-change effect, so reinforcement always has
  // context even if the user never explicitly played the page question.
  setGeneratedQuestion(null);
  setIsSlidingBack(false);
  setIsCategorizationPending(false);
  hasSlidCloserRef.current = false;
  dismissingQuestionRef.current = null;
  if (generatedQuestionAudioRef.current) {
    generatedQuestionAudioRef.current.pause();
    generatedQuestionAudioRef.current = null;
  }
};

const playReinforcement = async (reply) => {
  const question = lastAskedQuestionRef.current;
  lastAskedQuestionRef.current = null;
  console.log("Playing reinforcement. Question:", question, "Reply:", reply);
  if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
  sendContentMessageGemini(question, reply);
};

const speakGenerated = () => {
  // Start slide-back animation to return image to original size.
  // isSlidingBack takes priority over hasGenerated in the className,
  // so slide-back plays even while generatedQuestion is still set.
  // The onAnimationEnd handler on the img clears both states when slide-back finishes.
  setIsSlidingBack(true);

  // Remember which question we're dismissing so slide-back's animationEnd
  // only nulls state if no new question replaced it mid-animation.
  dismissingQuestionRef.current = generatedQuestion;

  // Detach the audio from the prefetch ref so a new question arriving
  // during playback can't pause/null the Audio we're about to play.
  const cachedAudio = generatedQuestionAudioRef.current;
  generatedQuestionAudioRef.current = null;
  const cachedQuestion = generatedQuestion;

  // Mute realtime audio while TTS plays to prevent overlap
  if (remoteAudioRef.current) {
    remoteAudioRef.current.muted = true;
  }
  const unmute = () => {
    if (remoteAudioRef.current && !isMuted) {
      remoteAudioRef.current.muted = false;
    }
  };

  if (cachedAudio) {
    setIsGeneratedQuestionPlaying(true);
    cachedAudio.addEventListener("ended", () => { unmute(); setIsGeneratedQuestionPlaying(false); lastAskedQuestionRef.current = cachedQuestion; setAwaitingQuestionAnswer(true); }, { once: true });
    cachedAudio.currentTime = 0;
    cachedAudio.play();
  } else if (cachedQuestion) {
    const narratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
    const voiceName = narratorRole?.VA || "kore";
    const role = narratorRole?.role || null;
    setIsGeneratedQuestionPlaying(true);
    speak(cachedQuestion, voiceName, "neutral", role)
      .then(() => { unmute(); setIsGeneratedQuestionPlaying(false); lastAskedQuestionRef.current = cachedQuestion; setAwaitingQuestionAnswer(true); })
      .catch(() => { unmute(); setIsGeneratedQuestionPlaying(false); });
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

    // If the scripted page question just finished, arm reinforcement so the next
    // user utterance routes through playReinforcement (same path as generated questions).
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

  // Reset childHasPlayed flag for new line
  setChildHasPlayed(false);

  // Never speak for Parent or Child or Dummy (they're meant to read themselves)
  if (currentRole === "Parent" || currentRole === "Child" || currentRole === "Dummy") {
    // keep highlighting behavior but do not play audio
    if (index > 0) page.text[index - 1].Reading = false;
    page.text[index].Reading = true;

    // If this is the last line, we need to keep isPlaying true briefly
    // and simulate audio ending so the next step (question popup) gets triggered
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

  // turn on "Reading" highlight
  if (index > 0) page.text[index - 1].Reading = false;
  page.text[index].Reading = true;

  // if no voice assigned, just stop/skip
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

  // Strip SSML then TTS
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
const handleNextClick = React.useCallback(() => {

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
       return newState;
     });
 } else {

     // If there's no more text on the current page, check if there are more pages to go to
      if (state.page < state.pagesValues.length - 1) {
        //userUtterancesRef.current = []; // Clear user utterances when moving to next page
        clearQuestionUI();
        if (isPlaying) {
         // Reading finished on this page — show pending page question if any
         setIsPlaying(false);
         if (pendingPageQuestionFlag.current) {
           const pageQuestion = state.pagesValues[state.page]?.question;
           if (pageQuestion) {
             setGeneratedQuestion(pageQuestion);
             // Showing the built-in page question supersedes any in-flight
             // categorization — clear the pending flag so the click lands on
             // speakGenerated (with slide-back) rather than playSound.
             setIsCategorizationPending(false);
           }
           pendingPageQuestionFlag.current = false;
         }
        } else {
         console.log("new page")
         const hasOffScript = offScriptLogRef?.current?.length > 0;
         if (!hasOffScript && questionGenEnabledRef.current) {
           // No off-script utterances — counts as no PAGE_QUESTION
           pagesWithoutPageQuestionRef.current += 1;
           if (pagesWithoutPageQuestionRef.current >= 4) {
             const pageQuestion = state.pagesValues[state.page]?.question;
             if (pageQuestion) {
               pendingPageQuestionFlag.current = true;
               pagesWithoutPageQuestionRef.current = 0;
             }
           }
         }
         if (questionGenEnabledRef.current) {
           console.log("sendOffScriptLog called from handleNextClick, page:", state.page);
           sendOffScriptLog(offScriptLogRef, state.page, state, hasOffScript ? (result) => {
             setIsCategorizationPending(false);

             const hasPageQuestion = result?.items?.some(i => i.category === 'PAGE_QUESTION');
             if (hasPageQuestion) {
               pagesWithoutPageQuestionRef.current = 0;
             } else {
               pagesWithoutPageQuestionRef.current += 1;
             }

             if (pagesWithoutPageQuestionRef.current >= 4) {
               const pageQuestion = state.pagesValues[result.sourcePage]?.question;
               if (pageQuestion) {
                 pendingPageQuestionFlag.current = true;
                 pagesWithoutPageQuestionRef.current = 0;
                 return;
               }
             }

            //  if (result?.generatedQuestion) {
            //    setGeneratedQuestion(result.generatedQuestion);
            //  }
           } : undefined, imageDescriptionRef, userAttentionRef.current, hasOffScript ? () => setIsCategorizationPending(true) : undefined);
         }
         for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
           state.pagesValues[state.page].text[i].Reading=false;
         }
         setState(prevState => {
           const nextPage = prevState.pagesValues[prevState.page + 1];
           const isLastLine = nextPage.text.length === 1;
           continueReading(nextPage, 0, state.CharacterRoles, isLastLine);
           return {...prevState, page: prevState.page + 1, index: 1};
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
         // Show pending page question now that reading is done
         if (pendingPageQuestionFlag.current) {
           const pageQuestion = state.pagesValues[state.page]?.question;
           if (pageQuestion) {
             setGeneratedQuestion(pageQuestion);
             setIsCategorizationPending(false);
           }
           pendingPageQuestionFlag.current = false;
         }
      }
 }


 // If a table container reference exists, scroll it into view
 if (dialogueRefs.current[state.index]) {
     dialogueRefs.current[state.index].scrollIntoView({
         behavior: "smooth",
         block: "center",
     });
 }
 }, [state, isPlaying, dialogueRefs, continueReading]);
const prevStates = useRef({ audioHasEnded, isPlaying, handleNextClick });

React.useEffect(() => {

  // Update the ref with the current state values after logging changes
  prevStates.current = {
    audioHasEnded,
    isPlaying,
    handleNextClick,
  };

  if (audioHasEnded && isPlaying) {
      handleNextClick();
      setAudioHasEnded(false);  // Reset the flag
  }
}, [audioHasEnded, isPlaying, handleNextClick]);

// If the user read the line move to next line.
const lastProcessedUtteranceRef = useRef("");
const userUtterancesRef = useRef([]);
const accumulatedUtterancesRef = useRef([]); // Accumulate utterances for current line
const utteranceQueuesRef = useRef([]); // Parallel queues for each normalizeText variant 
const currentLineTrackingRef = useRef({ page: -1, index: -1 }); // Track which line we're accumulating for
const offScriptLogRef = useRef([]); // Log of off-script words by line, sent to LLM on page change
const currentPageRef = useRef(state.page); // Always holds latest page for async callbacks
React.useEffect(() => { currentPageRef.current = state.page; }, [state.page]);

// Mirror of state for processUserUtterance — lets the effect read current
// state.index / state.page without depending on them, breaking the
// match → advanceToNextLine → state.index change → re-fire cycle.
const stateRef = useRef(state);
React.useEffect(() => { stateRef.current = state; });

// Jump to a specific line index
const jumpToLine = useCallback((lineIndex) => {
  setAudioHasEnded(false);
  setState(prevState => {
    const page = prevState.pagesValues[prevState.page];
    const isLastLine = lineIndex === page.text.length;

    // Clear Reading flag on the current line (the one we're jumping FROM)
    const currentIdx = prevState.index - 1;
    if (currentIdx >= 0 && page.text[currentIdx]) {
      page.text[currentIdx].Reading = false;
    }

    // Also clear any lines between current and target (in case of multi-line jump)
    for (let i = currentIdx + 1; i < lineIndex - 1; i++) {
      if (page.text[i]) {
        page.text[i].Reading = false;
      }
    }

    // Call continueReading to properly set up the new line (Reading flags, audio, etc.)
    continueReading(page, lineIndex - 1, prevState.CharacterRoles, isLastLine);

    return { ...prevState, index: lineIndex };
  });
}, [continueReading]);

React.useEffect(() => { // Whenever userUtterance changes, process it to check for matches with current line and handle off-script categorization
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
    sendContentMessage,
    sendContentMessageGemini,
    gotoNextPage,
    jumpToLine,
    setAudioHasEnded,
    setIsPlaying,
    onCategorizationStart: () => setIsCategorizationPending(true),
    onCategorizationResult: (result) => {
      // Belt-and-suspenders: ignore results from a page the user already left.
      // abortCurrentCategorization() should prevent this, but if the fetch
      // had already started draining bytes when the abort fired, the callback
      // may still arrive — discard it.
      if (result?.sourcePage !== stateRef.current.page) return;
      setIsCategorizationPending(false);

      // Track consecutive pages without PAGE_QUESTION
      const hasPageQuestion = result?.items?.some(i => i.category === 'PAGE_QUESTION');
      if (hasPageQuestion) {
        pagesWithoutPageQuestionRef.current = 0;
      } else {
        pagesWithoutPageQuestionRef.current += 1;
      }

      // If 4+ pages without PAGE_QUESTION, defer the page's built-in question until reading finishes
      if (pagesWithoutPageQuestionRef.current >= 4) {
        const pageQuestion = stateRef.current.pagesValues[result.sourcePage]?.question;
        if (pageQuestion) {
          pendingPageQuestionFlag.current = true;
          pagesWithoutPageQuestionRef.current = 0;
          return;
        }
      }

      // Otherwise use the AI-generated question as usual
      if (result?.generatedQuestion) {
        setGeneratedQuestion(result.generatedQuestion);
      }
    },
    imageDescriptionRef,
    userAttentionRef,
    questionGenEnabledRef,
    onQuestionAnswered: playReinforcement
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
              <div className="role-image-container-text d-flex justify-content-around">  {/* Use flexbox to display images side by side */}
              {currentRole && roleImage && <img src={roleImage} alt={roleName} style={{width: "20%"}}  className="overlay-image"/>}

                {/* Add character image */}
                {characterImage && <img src={characterImage} alt={val.Character} style={{width: "45%"}} className={`${isActiveRow ? "active-roleImage" : ""}`} />}  {/* Adjust width as per requirement */}
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
    const hasGenerated = generatedQuestion && !isCategorizationPending;
    const imageChecker = !!generatedQuestion;
    const questionText = hasGenerated ? generatedQuestion : state.pagesValues[state.page].question;
    const handleClick = hasGenerated ? speakGenerated : playSound;

    return (
           <div>
                <div className="wrapper">
                  <div className="role-image-container">
                    <img
                      id="role-image"
                      src={narratorImage}
                      alt="Narrator"
                      onClick={handleClick}
                      style={{ width: '200px', cursor: 'pointer' }}
                      className={isSlidingBack ? 'slide-back' : imageChecker ? (hasSlidCloserRef.current ? 'slide-closer-hold' : 'slide-closer') : ''}
                      onAnimationEnd={(e) => {
                        if (e.animationName === 'slide-closer') {
                          hasSlidCloserRef.current = true;
                        } else if (e.animationName === 'slide-back') {
                          // Capture into a local BEFORE resetting the ref —
                          // the functional setter below runs asynchronously and
                          // would otherwise read the already-reset null.
                          const dismissed = dismissingQuestionRef.current;
                          dismissingQuestionRef.current = null;
                          setIsSlidingBack(false);
                          // Only clear if no new question arrived during slide-back.
                          setGeneratedQuestion(curr => curr === dismissed ? null : curr);
                          hasSlidCloserRef.current = false;
                        }
                      }}
                    />
                  </div>
                  <div className="question-dialogue d-flex justify-content-center align-items-center" onClick={handleClick} style={{ cursor: 'pointer' }}>
                      <div className="storyTitle m-0"></div>
                      {questionText}
                  </div>
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

    // Check if it's child's turn and they haven't played yet
    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    const currentRoleCheck = currentLine ? state.CharacterRoles.find(
      (option) => option.Character === currentLine.Character
    ) : null;
    // const isChildTurn = currentRoleCheck?.role === "Child" && currentLine?.Reading;

    // // If it's child's turn and they haven't played, don't allow advancement
    // if (isChildTurn && !childHasPlayed) {
    //   console.log("Child must play their line first!");
    //   return;
    // }

    if (state.hasReachedEnd) {
      navigate('/', { state: { id: 1 } }); // Change '/Home' to your desired route
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
        handleNextClick();
      } else {
        console.log("resume reading");
        var currentCharacter = state.CharacterRoles.filter(obj => obj.Character === state.pagesValues[state.page].text[state.index - 1].Character);
        console.log(currentCharacter);
        if (!currentCharacter[0].VA ||
            currentCharacter[0].role === "Parent" ||
            currentCharacter[0].role === "Child" ||
            currentCharacter[0].role === "Dummy") {
          handleNextClick();
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
        {(state.pagesValues[state.page].question !== undefined) && renderQuestion()}
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
