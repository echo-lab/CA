import React,  { useState } from "react";
import "../styles/Story.css";
import { data } from "../Book/PinnochioBook.js";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { Link, useLocation } from 'react-router-dom';


/*Change class to function components */
/* Read about function components*/
function Book(CuurentBook) {
  data.map((val) => {
    return (
      (this.name = val.Book.Name),
      (this.characters = val.Book.Characters),
      (this.pages = val.Book.Pages)
    );
  });
}

var CurrentBook = new Book(data);

function Reader() {
  const location = useLocation();
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const voices = [
     
    {Voice:  "Mate 1", VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-C'  }},
    {Voice:  "Mate 2" ,VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-B'  }},
    {Voice:  "Mate 3" ,VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-A'  }},
    {Voice:  "Mate 4" ,VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-D'  }},
    {Voice:  "Mate 5" ,VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-E'  }},
    {Voice:  "Mate 6" ,VoiceParameter: {languageCode: 'en-US', name :'en-US-Standard-G'  }},
  ]
  const [state, setState] = useState({
    page: 0,
    index: 0,
    CharacterRoles: selectedOptions,
    pagesKeys: Object.keys(CurrentBook.pages),
    pagesValues: Object.values(CurrentBook.pages),
    stop: false,
    isVolumnOn: false,
    voiceOptions: voices
  });

  React.useEffect(() => {
    function handleAudioStateChange(event) {
      if (event.data.type === "MUTE_TAB") {
        Array.from(document.querySelectorAll("audio")).forEach((audio) => {
          audio.muted = true;
        });
      } else if (event.data.type === "UNMUTE_TAB") {
        Array.from(document.querySelectorAll("audio")).forEach((audio) => {
          audio.muted = false;
        });
      }
    }
  
    window.addEventListener("message", handleAudioStateChange);
  
    // Cleanup event listener
    return () => {
      window.removeEventListener("message", handleAudioStateChange);
    };
  }, []);

  
  function handleClick() {
    setState({ ...state, isVolumnOn: !state.isVolumnOn });
    window.audioState = !window.audioState; // Toggle audio state
    if (window.audioState === undefined) {
      window.audioState = true; // Set initial audio state to true (not muted)
    }
    if (window.audioState) {
      // Mute tab
      window.postMessage({ type: "MUTE_TAB" }, "*");
    } else {
      // Unmute tab
      window.postMessage({ type: "UNMUTE_TAB" }, "*");
    }
  }


  function handleNextClick() {
    
    if (state.pagesValues[state.page].text.length - 1 >= state.index) {
      continueReading(
        state.pagesValues[state.page],
        state.index,
        '',
        state.CharacterRoles,
        state.voiceOptions
      );
      setState({ ...state, index: state.index + 1 });
      console.log("Index: ", state.index);
    } else {
      if (state.page < state.pagesValues.length - 1) {
        state.pagesValues[state.page].text[state.index-1].Reading = false;
        setState({
          ...state,
          page: state.page + 1,
          index: 0,
        });
      } else {
        setState({ ...state, page: 0, index: 0 });
      }
    }
  }
  

  function renderPageRows() {
    return (
      <div className="table-column">
        {state.pagesValues[state.page].text.map((val, key) => {
          const isActiveRow = val.Reading;
          return (
            <div
              className={`row gx-3${isActiveRow ? " active-row" : ""}`}
              key={key}
            >
              <div className="col-1">
                <div className="p-3">
                  {val.Reading && <KeyboardDoubleArrowRightIcon />}{" "}
                </div>
              </div>
              <div className="col-2">
                <div className="p-3 borderless">{val.Character}</div>
              </div>
              <div className="col-9">
                <div className="p-3 borderless">{val.Dialogue}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  
  

  async function continueReading(page, index, apiKey, roles, options) {
    //console.log("Characters:",roles.filter(obj => obj.Character === page.text[index].Character));
    var currentCharacter = roles.filter(obj => obj.Character === page.text[index].Character);
    var currentVoice = options.filter( obj => obj.Voice ===  currentCharacter[0].VA);
    //console.log("VA",currentCharacter[0].VA);
    //console.log("Options",options.filter( obj => obj.Voice ==  currentCharacter[0].VA));
    
    if (index > 0) {
      page.text[index - 1].Reading = false;
    }
    page.text[index].Reading = true;
    if (
        currentCharacter[0].VA !== "None" 
    &&  currentCharacter[0].VA!== "Parent" 
    &&  currentCharacter[0].VA!== "Child" 
    &&  currentCharacter[0].VA!== "") {
      try {
        console.log("Parameters", currentVoice[0].VoiceParameter)
        const request = {
          input: { text: page.text[index].Dialogue },
          voice: currentVoice[0].VoiceParameter,
          audioConfig: { audioEncoding: 'MP3' },
        };
  
        const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + apiKey, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });
  
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
  
        const data = await response.json();
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        audio.play();
      } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
      }
    }
  }
  
  

  function renderNavigationButtons() {
    const isLastIndex = state.pagesValues[state.page].text.length === state.index;
  
    return (
      <div className="navigation-buttons p-3 d-md-flex justify-content-md-end">
        <div className="btn-group" role="group">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleNextClick}
          >
            {isLastIndex ? "Next Page" : "Next"}
          </button>
        </div>
      </div>
    );
  }
  
    
  return (
    <div className="story container reader-container">
      <div className="row row1">
        <div className="home btn col-1">
          <Link to={{ pathname: "/.", state: { id: 1 } }}>
            <button className="btn btn-primary">
              <i>
                <KeyboardDoubleArrowLeftIcon />
              </i>
            </button>
          </Link>
        </div>
        <div className="storyTitle col-9 font-weight-bold display-3">
          {CurrentBook.name}
        </div>
      </div>

      <div className="row">
        <div className="col image-column">
          <div className="image">
            <img src={state.pagesValues[state.page].img} alt="Pinnochio" />
          </div>
        </div>
        <div className="col table-column">
          <div className="container mb-4">
            <button className="volumnBtn" onClick={handleClick}>
              {state.isVolumnOn ? <VolumeOffIcon /> : <VolumeUpIcon />}
            </button>
          </div>

          <div className="container-fluid">{renderPageRows()}</div>
          {renderNavigationButtons()}
        </div>
      </div>
    </div>
  );
  




}
export default Reader;
