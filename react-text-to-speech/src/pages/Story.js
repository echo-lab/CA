import React,  { useState, useRef } from "react";
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





class Book {
  constructor(data) {
    this.name = data.Book.Name;
    this.characters = data.Book.Characters;
    this.pages = data.Book.Pages;
  }
}



function Reader() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);


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
    isVolumnOn: false,
    hasReachedEnd: false // New state variable
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioHasEnded, setAudioHasEnded] = useState(false);


  const handleTextSelection = () => {
    setTimeout(() => {
      let text = window.getSelection().toString();
      // Remove isolated symbols and punctuation, and trim whitespace
      text = text.replace(/(?<=\s|^)[.,!?;:"'“”‘’\-—]?(?=\s|$)/g, '').trim();
      
      if(text.length > 0) {
        speak(text);
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
      
  speak(state.pagesValues[state.page].question)
};





  async function speak(text){
    try {
        const request = {
          text: text,
          voice: {languageCode: 'en-US', name :'en-US-Wavenet-B' }
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


  const continueReading = React.useCallback( async (page, index, roles) => {
    console.log("continueReading triggered for page:", state.page, "and index:", index, "current lenght", page.text.length);
    if (!page || !page.text || index < 0 || index > page.text.length) {
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
    
    if (index > 0) {
      page.text[index - 1].Reading = false;
    }
    page.text[index].Reading = true;
    if ( currentCharacter.length > 0 
    &&  currentCharacter[0].VA.name!== "") {
      console.log("STT",page.text[index].Dialogue )
      var dialogue = page.text[index].Dialogue.replace(/(?<=\s|^)[.,!?;:"'“”‘’\-—]*(?=\s|$)/g, '').trim();
      console.log("Dialogue", dialogue)


      try {
        const request = {
            text: dialogue,
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
        try {
          const newAudio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
          setAudio(newAudio);
          newAudio.addEventListener("ended", audioEnded);
          await newAudio.play();
        } catch (error) {
          console.error('Error playing audio:', error);
        }
    } catch (error) {
        console.error('Error in Google Text-to-Speech:', error);
    }
    }else if(currentCharacter[0].VA.name === ""){
      setIsPlaying(false);
      
    }
  }, [state.page, audioEnded ]);

/**
 * Handle the "Next" button click.
 * This function determines if we should continue reading from the current page
 * or move to the next page.
 */
const handleNextClick = React.useCallback(() => {
  console.log("handleNextClick triggered. Current page:", state.page, "Current Index: ", state.index);
  console.log("Current isPlaying", isPlaying);

  // Check if there's more text on the current page to read
  if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
    console.log("reading page")
      // Continue reading the current page
      setAudioHasEnded(false);
      setState(prevState => {
        //const newState = {...prevState, index: prevState.index};
        continueReading(
          prevState.pagesValues[prevState.page],
          prevState.index,
          state.CharacterRoles
        );
        const newState = {...prevState, index: prevState.index+1};
        return newState;
      });
  } else {
    console.log("no more text")
      // If there's no more text on the current page, check if there are more pages to go to
      if (state.page < state.pagesValues.length - 1) {
        // Move to the next page
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

          return (
            <div
              ref={(el) => dialogueRefs.current[key] = el}
              className={`row gx-3${isActiveRowParent && isActiveRow ? "active active-parent" : ""}${isActiveRowChild && isActiveRow ? "active active-child" : ""}`}
              key={key}
            >
       
              <div className="col-3">
              <div className="role-image-container-text d-flex justify-content-around">  {/* Use flexbox to display images side by side */}
              {currentRole && currentRole.role === "Parent" && roleImage && <img src={roleImage} alt={roleName} style={{width: "20%"}}  className="overlay-image"/>}
            
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
  }
  
  

  

  
  

  function renderQuestion() {

    return ( 
           <div>
                <div className="wrapper">
                <div className="role-image-container">
                  <img src={parentImage} alt="Parent" />
                  <button onClick={playSound} className="play-sound-button">
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


  }




  
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
  
    // // Disable the button
    // setIsButtonDisabled(true);
  
    // // Re-enable the button after 5 seconds
    // setTimeout(() => {
    //   setIsButtonDisabled(false);
    // }, 2000);
  
    // If we have reached the end, navigate to another page
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
        if (currentCharacter[0].VA.name === "") {
          handleNextClick();
        }
      }
    } else {
      console.log("Was playing and you paused");
    }
  }


  
    
  return (
    <div className="story container-fluid reader-container">
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
    </div>
  );
  




}
export default Reader;
