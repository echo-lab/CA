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
import parentImage from "../Pictures/virtual.webp"
import ReactScrollableFeed from 'react-scrollable-feed';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { say } from "../utils/ttsClient";
import { warmSay } from "../utils/warmSay";
import { useRealtimeConnection } from "../utils/RealtimeConnectionContext";
import { processUserUtterance, sendOffScriptLog } from "../utils/utteranceProcessor";

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
  const [childHasPlayed, setChildHasPlayed] = useState(false);
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  // How many warm requests to run in parallel
  const PRELOAD_CONCURRENCY = 1;
  const inflightRequests = useRef(new Map());

  const {
    connected,
    connect,
    disconnect,
    sendContentMessage,
    isMuted,
    userUtterance,
    speakerLabels,
    toggleMute,
    remoteAudioRef,
    deepgramConnected,
    deepgramTranscript,
    connectToDeepgram,
    disconnectDeepgram,
  } = useRealtimeConnection();

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



  let lastSpokenText = "";
  let lastSpokenTime = 0;

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
  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);

  setIsPlaying(prevIsPlaying => {
      return false;
  });

  sendOffScriptLog(offScriptLogRef, state.page, state);

  if (state.page < state.pagesValues.length - 1) {

    for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
      state.pagesValues[state.page].text[i].Reading=false;
    }
    setState(prevState => ({ ...prevState, page: prevState.page + 1, index: 0 }));
  } else {
    navigate('/Home', { state: { id: 1 } });
  }
};


const gotoPreviousPage = () => {
  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);

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
  speak(state.pagesValues[state.page].question, voiceName, "neutral", role);
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

    setIsAudioPlaying(false);
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
    setAudio(audio);
    audio.addEventListener("ended", audioEnded);
    await audio.play?.(); // say() already calls play(), but this is harmless
  } catch (error) {
    console.error("TTS error:", error);
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
    const currentText = state.pagesValues[state.page].text;

     // If there's no more text on the current page, check if there are more pages to go to
      if (state.page < state.pagesValues.length - 1) {
        userUtterancesRef.current = []; // Clear user utterances when moving to next page
        if (isPlaying) {
         // Move to the next page
         setIsPlaying(false);
        } else {
         console.log("new page")
         for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
           state.pagesValues[state.page].text[i].Reading=false;
         }
         setState(prevState => {
           const newState = {...prevState, page: prevState.page + 1, index: 0};
           return newState;
         });
         setIsPlaying(false);
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
const silenceTimeoutRef = useRef(null); // Track timeout for silence detection
const pendingUtteranceRef = useRef(""); // Store utterance waiting to be sent after silence
const offScriptLogRef = useRef([]); // Log of off-script words by line, sent to LLM on page change

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

React.useEffect(() => {
  processUserUtterance({
    userUtterance,
    lastProcessedUtteranceRef,
    userUtterancesRef,
    accumulatedUtterancesRef,
    utteranceQueuesRef,
    currentLineTrackingRef,
    silenceTimeoutRef,
    pendingUtteranceRef,
    offScriptLogRef,
    state,
    speakerLabels,
    sendContentMessage,
    gotoNextPage,
    jumpToLine,
    setAudioHasEnded,
    setIsPlaying
  });
}, [userUtterance, state.index, state.page, state.pagesValues, state.CharacterRoles, speakerLabels, sendContentMessage, gotoNextPage, jumpToLine]);


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

    return (
           <div>
                <div className="wrapper">
                <div className="role-image-container">
                  <img src={parentImage} alt="Parent" />
                  <button onClick={() => { playSound(); }} className="play-sound-button">
                  <PlayArrowIcon />
                  </button>
                  </div>

                  <div className="question-dialogue d-flex justify-content-between align-items-center">
                    <div className="storyTitle m-0"></div>
                    {state.pagesValues[state.page].question}
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
    const shouldDisableButton = isButtonDisabled || isAudioPlaying || (isChildTurn && !childHasPlayed);

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
    const isChildTurn = currentRoleCheck?.role === "Child" && currentLine?.Reading;

    // If it's child's turn and they haven't played, don't allow advancement
    if (isChildTurn && !childHasPlayed) {
      console.log("Child must play their line first!");
      return;
    }

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
      <div className="realtime-toggle-container">
        <span className="toggle-label">Realtime</span>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={connected}
            onChange={() => connected ? disconnect() : connect()}
          />
          <span className="toggle-slider"></span>
        </label>
        <span className={`toggle-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="realtime-toggle-container">
        <span className="toggle-label">AI Audio</span>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={!isMuted}
            onChange={toggleMute}
            disabled={!connected}
          />
          <span className="toggle-slider"></span>
        </label>
        <span className={`toggle-status ${!isMuted ? 'connected' : 'disconnected'}`}>
          {!isMuted ? 'Unmuted' : 'Muted'}
        </span>
      </div>

      <div className="realtime-toggle-container">
        <span className="toggle-label">Deepgram</span>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={deepgramConnected}
            onChange={() => deepgramConnected ? (disconnectDeepgram(), disconnect()) : (connectToDeepgram(), connect())}
          />
          <span className="toggle-slider"></span>
        </label>
        <span className={`toggle-status ${deepgramConnected ? 'connected' : 'disconnected'}`}>
          {deepgramConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

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
          <img src={state.pagesValues[state.page].img} alt="current page" />
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
