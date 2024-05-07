import React,  { useState, useRef } from "react";
import "../styles/Story.css";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';
import {useHotkeys} from "react-hotkeys-hook";
import { Link, useLocation } from 'react-router-dom';
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import {roles} from "../Book/Roles.js"
import ReactScrollableFeed from 'react-scrollable-feed';



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
  const dialogueRefs = useRef([]);
  const tableContainerRef = useRef(null);
  const parentRole = roles.find(role => role.Role === "Parent");
  console.log("parent role", parentRole)
  const parentImage = parentRole ? parentRole.img : null;

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
  console.log(CurrentBook)

  const [state, setState] = useState({
    page: 0,
    index: 0,
    CharacterRoles: selectedOptions,
    pagesKeys: Object.keys(CurrentBook.pages),
    pagesValues: Object.values(CurrentBook.pages),
    isVolumnOn: false
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [questionVisible, setQuestionVisible] = useState(true);

  const gotoNextPage = () => {
    if (state.page < state.pagesValues.length - 1) {
      setState(prevState => ({ ...prevState, page: prevState.page + 1 }));
      // Add any other state resets or logic needed when changing pages here
    }
  };
  
  const gotoPreviousPage = () => {
    if (state.page > 0) {
      setState(prevState => ({ ...prevState, page: prevState.page - 1 }));
      // Add any other state resets or logic needed when changing pages here
    }
  };

 



  useHotkeys("space", (event) => {
    event.preventDefault();
    handleNextClick();
  });

 
 

  
/**
 * Handle the "Next" button click.
 * This function determines if we should continue reading from the current page
 * or move to the next page.
 */
const handleNextClick = React.useCallback(() => {
  console.log("handleNextClick triggered. Current page:", state.page, "Current Index: ", state.index);
  const container = tableContainerRef.current;


    console.log("no more text")
      // If there's no more text on the current page, check if there are more pages to go to
      if (state.page < state.pagesValues.length - 1) {
        // Move to the next page
          console.log("new page")
          setState(prevState => {
            const newState = {...prevState, page: prevState.page + 1, index: 0};
            return newState;
          });

          if (tableContainerRef.current) {
            tableContainerRef.current.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
            console.log("scrolledup")
          }
          
      } else {
          // If we're on the last page, mark the last text as not being read
          

          // Reset to the first page and reset the reading index
          setState({ ...state, page: 0, index: 0 });


      }
  

  
}, [state]);




function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}


  function parseText(text) {
     // Strip SSML tags
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
          
          const character = CurrentBook.characters.find(c => c.Name === val.Character);
          const characterImage = character ? character.img : "";

          return (
            <div
              ref={(el) => dialogueRefs.current[key] = el}
              className={`row gx-3${isActiveRowParent && isActiveRow ? "active active-parent" : ""}${isActiveRowChild && isActiveRow ? "active active-child" : ""}`}
              key={key}
            >
              
              <div className="col-4">
              <div className="p-3 role-image-container d-flex justify-content-around"> 
              
                {characterImage && <img src={characterImage} alt={val.Character} style={{width: "45%"}} className={`${isActiveRow ? "active-roleImage" : ""}`} />}  {/* Adjust width as per requirement */}
              </div>
              </div>
              <div className="col-8">
                <div className={`p-3 borderless text-size  ${isActiveRow ? "active-dialogue" : ""} `} >
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
              {questionVisible ? (
                <div className="p-3 role-image-container">
                  <img src={parentImage} alt="Parent" />
                  <div className="question-dialogue d-flex justify-content-between align-items-center">
                    <div className="storyTitle m-0"></div>
                    {state.pagesValues[state.page].question}
                </div>
                </div>
              ) : null}
           </div>
     );


  }



  
function renderNavigationButtons() {
  let buttonText;
  let buttonClass = "";  // New variable for button class
  buttonText = "Next Page"
  buttonClass = "highlight-button";  // Apply the class when the text is "Play"

  return (
    <div className="navigation-buttons p-3 d-md-flex justify-content-md-end">
      <div className="btn-group" role="group">
        <button
          type="button"
          className={`btn btn-secondary ${buttonClass}`}  // Add the buttonClass here
          onClick={handleNextClick} // Add this line to attach the event handler
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}


 


  
    
  return (
    <div className="story container-fluid reader-container">
      <div className="navbar navbar-light bg-light row1">
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
