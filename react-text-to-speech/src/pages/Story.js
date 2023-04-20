import React,  { useState } from "react";
import "../styles/Story.css";
import { data } from "../Book/PinnochioBook.js";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { Link, useLocation } from 'react-router-dom';



function Page(img, text) {
  this.image = img;
  this.text = text;
}

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
  
  const [state, setState] = useState({
    page: 0,
    index: 0,
    currentCARole: "Narrator",
    CharacterRoles: Object.values(selectedOptions),
    pagesKeys: Object.keys(CurrentBook.pages),
    pagesValues: Object.values(CurrentBook.pages),
    stop: false,
    isVolumnOn: false,
  });

  
  function handleClick() {
    setState({ ...state, isVolumnOn: !state.isVolumnOn });
  }

  function getState(narrator) {
    setState({
      ...state,
      currentCARole: narrator,
    });
  }

  function renderCharactersOptions() {
    return extractCurrentCharacters(state.pagesValues[state.page]).map((val) => {
      return <option value={val}>{val}</option>;
    });
  }

  function handleNextClick() {
    console.log("Characters:",Object.entries(selectedOptions).map(([key, value]) => ({ [key]: value })));
    if (state.pagesValues[state.page].text.length - 1 >= state.index) {
      continueReading(
        state.pagesValues[state.page],
        state.currentCARole,
        state.index,
        ''
      );
      setState({ ...state, index: state.index + 1 });
      console.log("Index: ", state.index);
    } else {
      if (state.page < state.pagesValues.length - 1) {
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
    return state.pagesValues[state.page].text.map((val, key) => {
      return (
        <div className="row gx-3" key={key}>
          <div className="col-1">
            <div className="p-3 ">
              {val.Reading && <KeyboardDoubleArrowRightIcon />}{" "}
            </div>
          </div>
          <div className="col-2">
            <div className="p-3 borderless">{val.Character}</div>
          </div>
          <div className="col-9">
            <div className="p-3 border bg-light">{val.Dialogue}</div>
          </div>
        </div>
      );
    });
  }

  async function continueReading(page, role, index, apiKey) {
    if (index > 0) {
      page.text[index - 1].Reading = false;
    }
    page.text[index].Reading = true;
    if (page.text[index].Character === role) {
      try {
        const request = {
          input: { text: page.text[index].Dialogue },
          voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
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
  
  
  function extractCurrentCharacters(page){
    var currentCharacters = [];
    for (var i = 0; i < page.text.length; i++) {
      if(currentCharacters.indexOf(page.text[i].Character) === -1) 
      { currentCharacters.push(page.text[i].Character);}
    }
    return currentCharacters;
  }

  function renderNavigationButtons() {
    return (
      <div className="p-3 d-md-flex justify-content-md-end">
        <div className="btn-group" role="group">
          <button type="button" className="btn btn-secondary">
            Previous
          </button>
          <button type="button" className="btn btn-secondary">
            1
          </button>
          <button type="button" className="btn btn-secondary">
            2
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleNextClick}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

    
  return (
    <div className="story container">
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
        <div className="col">
          <div className="image">
            <img src={state.pagesValues[state.page].img} alt="Pinnochio" />
          </div>
        </div>
        <div className="col">
          <div className="container mb-4">
            <label>VA:</label>
            <select
              value={state.currentCARole}
              onChange={(e) => getState(e.target.value)}
            >
              {renderCharactersOptions()}
            </select>
            <button className="volumnBtn" onClick={handleClick}>
              {state.isVolumnOn ? <VolumeUpIcon /> : <VolumeOffIcon />}
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
