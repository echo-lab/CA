import React,  { useState, useRef, useCallback, useEffect } from "react";
import "../styles/Story.css";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import {useHotkeys} from "react-hotkeys-hook";
import { Link, useLocation, useNavigate  } from 'react-router-dom';
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import parentImage from "../Pictures/virtual.webp"
import ReactScrollableFeed from 'react-scrollable-feed';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { say } from "../utils/ttsClient";
import { useRealtimeConnection } from "../utils/RealtimeConnectionContext";


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
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);

  const { connected, connect, disconnect, sendContentMessage, isAIResponding, waitingForTrigger, triggerDetected, isMuted, toggleMute, remoteAudioRef } = useRealtimeConnection();

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
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  useEffect(() => {
    console.log("isPopupOpen changed:", isPopupOpen);
  }, [isPopupOpen]); 

  let lastSpokenText = "";
  let lastSpokenTime = 0;
  
  const handleTextSelection = () => {
    setTimeout(() => {
      let text = window.getSelection().toString().trim();
      text = text.replace(/(?<=\s|^)[.,!?;:"'“”‘’\-—]?(?=\s|$)/g, '').trim();
  
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

const gotoNextPage = () => {
  console.log("go to next page button pressed");
  if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);

  setIsPlaying(prevIsPlaying => {
      return false;
  });
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
  // Try narrator voice if assigned; fallback to “kore”
  const narratorRole = state.CharacterRoles.find(o => o.Character === "Narrator");
  const voiceName = narratorRole?.VA || "kore";
  speak(state.pagesValues[state.page].question, voiceName);
};

async function speak(text, voiceName = "kore", emotion = "neutral") {
  try {
    const clean = stripSSMLTags(String(text || "").trim());
    if (!clean) return;

    const { audio } = await say({
      text: clean,
      voiceName,
      emotion,
    });

    setAudio(audio);
    audio.addEventListener("ended", audioEnded);
  } catch (err) {
    console.error("TTS error:", err);
  }
}



  useHotkeys("space", (event) => {
    event.preventDefault();
    handlePlayClick();
  });

 
  const audioEnded = React.useCallback(() => {
    console.log("Audio has finished playing!");
    console.log("audioEnded triggered. Current isPlaying:", isPlaying);

    if (audio) {
        audio.removeEventListener("ended", audioEnded);
    }
    
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

  // Never speak for Parent or Child (they're meant to read themselves)
  if (currentCharacter?.role === "Parent" || currentCharacter?.role === "Child") {
    // keep highlighting behavior but do not play audio
    if (index > 0) page.text[index - 1].Reading = false;
    page.text[index].Reading = true;

    // If this is the last line, we need to keep isPlaying true briefly
    // and simulate audio ending so the next step (question popup) gets triggered
    if (isLastLine) {
      console.log("Last line is Parent/Child - simulating audio end");
      // Use a timeout to trigger the audio ended event
      setTimeout(() => {
        setAudioHasEnded(true);
        // Don't set isPlaying to false yet - let the useEffect handle it
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
    // If this is the last line and no voice, simulate audio ending
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
    // If this is the last line and no dialogue, simulate audio ending
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
      emotion: "neutral", // or decide by character/line later
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
 console.log("Current isPlaying", isPlaying);
 console.log("handleNextClick triggered. Current page:", state.page, "Current Index: ", state.index);


 // Check if there's more text on the current page to read
 if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
   console.log("reading page")
     // Continue reading the current page
     setAudioHasEnded(false);
     setState(prevState => {
       //const newState = {...prevState, index: prevState.index};
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
    setIsPopupOpen(true);
    // Send current page's text to ask an educational question
    const currentText = state.pagesValues[state.page].text;
    sendContentMessage(
      { type: "page.read", content: { text: currentText } },
      "Now generate and ask an educational question to teach the toddlers about patterns based on the content of current page. However, generate question with new examples that are not directly from the text."
    );
  
     // If there's no more text on the current page, check if there are more pages to go to
     if (state.page < state.pagesValues.length - 1) {
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
           console.log("scrolledup")
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
     console.log("scrolledup")
 }
 }, [state, isPlaying, dialogueRefs, continueReading]);
const prevStates = useRef({ audioHasEnded, isPlaying, handleNextClick });

React.useEffect(() => {
  // for debugging purposes, we check which depenency caused thhis useEffect function to run 
  if (prevStates.current.audioHasEnded !== audioHasEnded) {
    console.log('audioHasEnded changed', audioHasEnded);
  }
  if (prevStates.current.isPlaying !== isPlaying) {
    console.log('isPlaying changed', isPlaying);
  }
  if (prevStates.current.handleNextClick !== handleNextClick) {
    console.log('handleNextClick changed', handleNextClick);
  }

  // Update the ref with the current state values after logging changes
  prevStates.current = {
    audioHasEnded,
    isPlaying,
    handleNextClick,
  };

  if (audioHasEnded && isPlaying) {
      console.log("move to the next line");
      handleNextClick();
      setAudioHasEnded(false);  // Reset the flag
  }
}, [audioHasEnded, isPlaying, handleNextClick]);


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
          
          const roleImage = currentRole ? currentRole.img : "";
          const roleName = currentRole ? currentRole.Role : "Role image"; // default alt text
          const character = CurrentBook.characters.find(c => c.Name === val.Character);
          const characterImage = character ? character.img : "";
          const isChild = currentRole?.role === "Child";

          return (
            <div
              ref={(el) => dialogueRefs.current[key] = el}
              className={`row gx-3${isActiveRowParent && isActiveRow ? "active active-parent" : ""}${isActiveRowChild && isActiveRow ? "active active-child" : ""}`}
              key={key}
              onClick={() => {
                const selectedText = window.getSelection().toString().trim();
                if (isChild && val.Reading && selectedText === "") {
                  const currentRole = selectedOptions.find(
                    (option) => option.Character === val.Character
                  );
                  const voiceName = currentRole?.VA || "kore";
                  speak(val.Dialogue, voiceName);
                }
              }}
            >
       
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
  
    let buttonText;
    let buttonClass = "";
  
    if (state.hasReachedEnd) {
      buttonText = 'End';
      buttonClass = "highlight-button";
    } else if (isLastIndex && !isPlaying) {
      buttonText = isLastPage ? 'End' : 'Next Page';
      buttonClass = "highlight-button";
    } else {
      // TODO: Send Current text over to Realtime
      buttonText = (isPlaying && !audioHasEnded) ? "Pause" : "Play";
      if (!isPlaying) {
        buttonClass = "highlight-button";
      }
    }
    console.log("Rendering Button", buttonText);
    return (
      <div className="navigation-buttons p-3 d-md-flex justify-content-md-end">
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-secondary ${isButtonDisabled ? 'disabled' : ''} ${buttonClass}`} // Apply the buttonClass here
            onClick={handlePlayClick}
            disabled={isButtonDisabled}
          >
            {buttonText}
          </button>
        </div>
      </div>
    );
  }



  function handlePlayClick() {
    console.log("handlePlayClick triggered. Current isPlaying:", isPlaying);
  
    if (state.hasReachedEnd) {
      navigate('/', { state: { id: 1 } }); // Change '/Home' to your desired route
      return;
    }
  
    // if this happesn to be last line, no option to pause it, just wait until the playing is done. 
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
            currentCharacter[0].role === "Child") {
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
          <img src={state.pagesValues[state.page].img} alt="current page" />
        {(state.pagesValues[state.page].question !== undefined) && renderQuestion()}   
        </div>     
      <div className="col-md-7 table-container">
      

        <div className="container-fluid">{renderPageRows()}</div>
        {renderNavigationButtons()}
      </div>
    </div>

      {/* Image Generation Modal */}
      {showImageModal && (
        <div className="image-modal-overlay" onClick={() => setShowImageModal(false)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setShowImageModal(false)}>
              ×
            </button>
            <h3>Generated Visual Example</h3>
            {generatedImageUrl ? (
              <img src={generatedImageUrl} alt="Generated example" className="generated-image" />
            ) : (
              <div className="loading-spinner">Loading image...</div>
            )}
          </div>
        </div>
      )}

      {/* AI Conversation Popup */}
      {isPopupOpen && (
        <div className="image-modal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="image-modal-close"
              onClick={() => {
                console.log("AI conversation popup closed by user");
                setIsPopupOpen(false);
              }}
            >
              X
            </button>
            <h3>AI Initiated Conversation</h3>
            <div style={{ padding: '20px', textAlign: 'center' }}>
              {waitingForTrigger ? (
                <>
                  <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#2196F3' }}>
                    🎤 Listening for you to say: "I am ready"
                  </p>
                  <div className="loading-spinner" style={{ margin: '20px auto' }}>
                    Waiting for trigger word...
                  </div>
                  <p style={{ fontSize: '14px', color: '#666', marginTop: '20px' }}>
                    The AI will ask a question once you say "I am ready"
                  </p>
                </>
              ) : triggerDetected || isAIResponding ? (
                <>
                  <p>Listen carefully! The AI is asking an educational question based on what you just read.</p>
                  <div className="loading-spinner" style={{ margin: '20px auto' }}>🎤 Speaking...</div>
                  <p style={{ fontSize: '14px', color: '#666', marginTop: '20px' }}>
                    Close this popup when you're ready to move to the next page
                  </p>
                </>
              ) : (
                <>
                  <p>Preparing conversation...</p>
                  <div className="loading-spinner" style={{ margin: '20px auto' }}>Loading...</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading Indicator for Image Generation */}
      {isGeneratingImage && (
        <div className="image-loading-overlay">
          <div className="loading-spinner">
            <p>Generating visual example...</p>
            <div className="spinner"></div>
          </div>
        </div>
      )}
    </div>
  );
  




}
export default Reader;
