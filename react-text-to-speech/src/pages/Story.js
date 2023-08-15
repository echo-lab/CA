import React,  { useState } from "react";
import "../styles/Story.css";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import {useHotkeys} from "react-hotkeys-hook";
import { Link, useLocation } from 'react-router-dom';
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";



class Book {
  constructor(data) {
    this.name = data.Book.Name;
    this.characters = data.Book.Characters;
    this.pages = data.Book.Pages;
  }
}



function Reader() {
  const location = useLocation();
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  console.log(id)
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

  const [state, setState] = useState({
    page: 0,
    index: 0,
    CharacterRoles: selectedOptions,
    pagesKeys: Object.keys(CurrentBook.pages),
    pagesValues: Object.values(CurrentBook.pages),
    stop: false,
    isVolumnOn: false
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

  
  useHotkeys("space", (event) => {
    event.preventDefault();
    handleNextClick();
  });

  function handlePreviousClick() {
    console.log("Index: ", state.index);
    if (state.index > 0) {
      let newState = {...state}; // copy the state
      if (state.pagesValues[state.page] && state.pagesValues[state.page].text[state.index-1]) {
        state.pagesValues[state.page].text[state.index-1].Reading = false;
      }
      
      if (state.pagesValues[state.page] && state.pagesValues[state.page].text[state.index-2]) {
        state.pagesValues[state.page].text[state.index-2].Reading = true;
      }
      newState.index = state.index - 1;
      setState(newState); // update state
      continueReading(
        state.pagesValues[state.page],
        state.index-2,
        state.CharacterRoles
      );
    } else if (state.page > 0) {
      let prevPage = state.pagesValues[state.page - 1];
    setState({
      ...state,
      page: state.page - 1,
      index: prevPage.text.length+1, // index of the last sentence
    });
    }
  }



  function handleNextClick() {
    if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
      continueReading(
        state.pagesValues[state.page],
        state.index,
        state.CharacterRoles
      );
      setState({ ...state, index: state.index + 1 });
      console.log("Index: ", state.index);
    } else {
      if (state.page < state.pagesValues.length - 1) {
        if(state.pagesValues[state.page]?.text && state.pagesValues[state.page].text[state.index - 1]){
          state.pagesValues[state.page].text[state.index-1].Reading = false;
        }
        setState({
          ...state,
          page: state.page + 1,
          index: 0,
        });
      } else {
        if(state.pagesValues[state.page]?.text && state.pagesValues[state.page].text[state.index - 1]){
          state.pagesValues[state.page].text[state.index-1].Reading = false;
        }
        setState({ ...state, page: 0, index: 0 });
      }
    }
  }
  
  
  function renderPageRows() {
    return (
      <div className="table-column">
        {state.pagesValues[state.page]?.text?.map((val, key) => {
          const isActiveRow = val.Reading;
          const currentRole = selectedOptions.find(
            (option) => option.Character === val.Character
          );
          
          const roleImage = currentRole ? currentRole.img : "";
          const roleName = currentRole ? currentRole.Role : "Role image"; // default alt text
          const character = CurrentBook.characters.find(c => c.Name === val.Character);
          const characterImage = character ? character.img : "";

          return (
            <div
              className={`row gx-3${isActiveRow ? " active-row" : ""}`}
              key={key}
            >
              <div className="col-3">
              <div className="p-3 role-image-container d-flex justify-content-around">  {/* Use flexbox to display images side by side */}
                {roleImage && <img src={roleImage} alt={roleName} style={{width: "45%"}} />}  {/* Adjust width as per requirement */}

                {/* Add character image */}
                {characterImage && <img src={characterImage} alt={val.Character} style={{width: "45%"}} />}  {/* Adjust width as per requirement */}
              </div>
              </div>
              <div className="col-2">
                <div className="p-3 borderless text-size">{val.Character}</div>
              </div>
              <div className="col-7">
                <div className="p-3 borderless text-size">{val.Dialogue}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  
  

  

  async function continueReading(page, index, roles) {
    if (!page || !page.text || index < 0 || index >= page.text.length) {
      console.error(`Invalid arguments to continueReading: page=${page}, index=${index}`);
      return;
    }
    var currentCharacter = roles.filter(obj => obj.Character === page.text[index].Character);
    var currentVoice;
    if (currentCharacter.length > 0) {
      currentVoice = currentCharacter[0].VA;
    } else {
      currentVoice = null;
    }
    console.log("currentChar",currentCharacter[0].VA.name);
    //console.log("currentVoice",currentVoice);
    //console.log("VA",currentCharacter[0].VA);
    //console.log("Options",options.filter( obj => obj.Voice ==  currentCharacter[0].VA));
    
    if (index > 0) {
      page.text[index - 1].Reading = false;
    }
    page.text[index].Reading = true;
    if ( currentCharacter.length > 0 
    &&  currentCharacter[0].VA.name!== "") {
      try {
        const request = {
            text: page.text[index].Dialogue,
            voice: currentVoice,
        };

        const response = await fetch('https://talemate.cs.vt.edu:5000/synthesize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        });

        const data = await response.json();
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        audio.play()
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
    }
    }
  }
  
  

  function renderNavigationButtons() {
    const isLastIndex = state.pagesValues[state.page].text.length === state.index;
    const isFirstIndex = state.index === 0;
    const isFirstPage = state.page === 0;

  
    return (
      <div className="navigation-buttons p-3 d-md-flex justify-content-md-end">
        <div className="btn-group" role="group">
        <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePreviousClick}
            disabled={isFirstIndex&&isFirstPage}
          >
            {isFirstIndex ? "Last Page" : "Back"}
          </button>
        </div>

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
    <div className="story container-fluid reader-container">
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
      </div>

      <div className="row">
        <div className="col-md-5 image-column">
          <div className="image">
            <img src={state.pagesValues[state.page].img} alt="current page picture" />
          </div>
        </div>
        <div className="col-md-7 table-column">
        

          <div className="container-fluid">{renderPageRows()}</div>
          {renderNavigationButtons()}
        </div>
      </div>
    </div>
  );
  




}
export default Reader;
