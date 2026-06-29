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
import { useReinforcement } from "../hooks/useReinforcement";
import { useStoryNavigation } from "../hooks/useStoryNavigation";
// Utils
import { warmSay } from "../utils/warmSay";
import { openDebugMonitor } from "../utils/debugMonitor";
import { AUDIO_SOURCES } from "../utils/audioPlaybackLock";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import { ImageAnalysis, ImageTagging, prefetchPage } from "../utils/imageAnalysis";
import { processUserUtterance, abortCurrentCategorization, setAwaitingQuestionAnswer, setCurrentBookId } from "../utils/utteranceProcessor";

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
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const name = location.state?.name || null;
  const isTraining = location.state?.training === true;
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  const PRELOAD_CONCURRENCY = 1;
  const TEST_GENERATED_QUESTION = "How do you think Zoe is feeling?";
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

  const [isCategorizationPending, setIsCategorizationPending] = useState(false);
  const [questionHistory, setQuestionHistory] = useState([]);
  const [showAvatar, setShowAvatar] = useState(false);
  const [inReinforcementLoop, setInReinforcementLoop] = useState(false);
  const [avatarPhase, setAvatarPhase] = useState('question');

  const showAvatarRef = useRef(false);
  useEffect(() => { showAvatarRef.current = showAvatar; }, [showAvatar]);

  const inReinforcementLoopRef = useRef(false);
  useEffect(() => { inReinforcementLoopRef.current = inReinforcementLoop; }, [inReinforcementLoop]);

  const questionGenEnabledRef = useRef(QUESTION_GEN_ENABLED);
  const hasSlidCloserRef = useRef(false);
  const dismissingQuestionRef = useRef(null);
  const wasGeminiAudioPlayingRef = useRef(false);
  const imageDescriptionRef = useRef(null);
  const [imageTags, setImageTags] = useState([]);
  const userAttentionRef = useRef(null);
  const pendingGeneratedQuestionRef = useRef(null);
  const lastAskedQuestionRef = useRef(null);
  const lastExpectedAnswerRef = useRef(null);
  const generatedQuestionPendingRef = useRef(false);
  const reinforcementFromPageQuestionRef = useRef(false);

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
    handleTestQuestionClick,
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
    setInReinforcementLoop,
    setAvatarPhase,
    setIsCategorizationPending,
    hasSlidCloserRef,
    lastAskedQuestionRef,
    pendingGeneratedQuestionRef,
    reinforcementFromPageQuestionRef,
    generatedQuestionPendingRef,
    questionGenEnabledRef,
    state,
    narratorRole,
    TEST_GENERATED_QUESTION,
  });

  const {
    isReinforcementPlaying,
    revealedReinforcement,
    reinforcementModeRef,
    playReinforcement,
    closeReinforcementMode,
    resetReinforcementRevealState,
  } = useReinforcement({
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
    reinforcementFromPageQuestionRef,
    generatedQuestionPendingRef,
    imageDescriptionRef,
    userAttentionRef,
    setQuestionHistory,
    setInReinforcementLoop,
    setAvatarPhase,
    setShowAvatar,
  });

  const clearQuestionUI = () => {
    closeReinforcementMode();
    abortCurrentCategorization();
    setAwaitingQuestionAnswer(false);
    setGeneratedQuestion(null);
    resetGeneratedQuestionState();
    setIsCategorizationPending(false);
    setShowAvatar(false);
    setQuestionHistory([]);
    resetReinforcementRevealState();
    setAvatarPhase('question');
    reinforcementFromPageQuestionRef.current = false;
    lastExpectedAnswerRef.current = null;
    hasSlidCloserRef.current = false;
    dismissingQuestionRef.current = null;
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
    inReinforcementLoopRef,
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

  useEffect(() => {
    const pageText = state.pagesValues[state.page]?.text
      ?.map(t => stripSSMLTags(t.Dialogue)).join(' ') || '';
    userAttentionRef.current = null;
    lastExpectedAnswerRef.current = null;
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
      onQuestionReady: (questionText, expectedAnswer = null) => {
        if (!questionGenEnabledRef.current) return;
        if (isGeneratedQuestionPlayingRef.current) {
          suppressGeneratedAudioStreamRef.current = true;
          return;
        }
        lastExpectedAnswerRef.current = expectedAnswer;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userUtterance]);

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
        <QuestionAvatar
          questionHistory={questionHistory}
          showAvatar={showAvatar}
          inReinforcementLoop={inReinforcementLoop}
          avatarPhase={avatarPhase}
          isThoughtRevealed={isThoughtRevealed}
          revealedQuestion={revealedQuestion}
          revealedReinforcement={revealedReinforcement}
          isGeneratedQuestionPlaying={isGeneratedQuestionPlaying}
          isPageQuestionPlaying={isPageQuestionPlaying}
          isReinforcementPlaying={isReinforcementPlaying}
          narratorImage={narratorImage}
          frames={frames}
          listeningImage={listeningImage}
          narratorRole={narratorRole}
          onSpeakGenerated={speakGenerated}
          onPlaySound={playSound}
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
