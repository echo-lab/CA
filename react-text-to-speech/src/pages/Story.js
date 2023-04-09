import React,  { useState } from "react";
import { Link } from 'react-router-dom'
import "../styles/Story.css";
import { data } from "../Book/PinnochioBook.js";
import "bootstrap/dist/css/bootstrap.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';

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

class Reader extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      page: 0,
      index: 0,
      currentCARole: "Narrator",
      pagesKeys: Object.keys(CurrentBook.pages),
      pagesValues: Object.values(CurrentBook.pages),
      stop: false,
      isVolumnOn: false,
    };
  }

  handleClick = () => {
    this.setState({ isVolumnOn: !this.state.isVolumnOn });
  };

  getState(narrator) {
    this.setState({
      ...this.state,
      currentCARole: narrator,
    });
  }

  render() {
    var newindex = 0;
    return (
      <div className="story container">
        <div className="row row1">
           <div className="home btn col-1"><Link to="/"><button className="btn btn-primary"><i><KeyboardDoubleArrowLeftIcon /></i></button></Link></div> 
           <div className=" storyTitle col-9 font-weight-bold display-3"> {CurrentBook.name} </div>
        </div>
        
        <div className="row">
        <div className="col">
          <div className="image">
            <img
              src={
                this.state.pagesValues[this.state.page].img
                /*Map the current picture of the Page*/
              }
              alt="Pinnochio"
            />
          </div>
        </div>
        <div className="col">
          <div className="container mb-4">
            <label>VA:</label>
            <select
              value={this.state.currentCARole /* Get the CA Rol */}
              onChange={
                (e) =>
                  this.getState(
                    e.target.value
                  ) /*When we change the value of the CA, we update the state of the Reader */
              }
            >
              {/*CurrentBook.characters.map((val)*/ 
              extractCurrentCharacters(this.state.pagesValues[this.state.page]).map((val) => {
                /*Map the values from the Book to the CA option selection */
                return <option value={val}>{val}</option>;
              })}
            </select>
            <button className="volumnBtn" onClick={this.handleClick}>{this.state.isVolumnOn ? <VolumeUpIcon /> : <VolumeOffIcon />} </button>
          </div>

          <div className="container-fluid">
            <div>
              {this.state.pagesValues[this.state.page].text.map((val, key) => {
                /*Map the current Page on the Table*/
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
              })}
            </div>
            <div className="p-3 d-md-flex justify-content-md-end">
              <div class="btn-group" role="group">
                <button type="button" class="btn btn-secondary">
                  Previous
                </button>
                <button type="button" class="btn btn-secondary">
                  1
                </button>
                <button type="button" class="btn btn-secondary">
                  2
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => {
                    console.log(this.state.pagesValues.length - 1);
                    console.log(
                      this.state.pagesValues[this.state.page].text.length - 1
                    );
                    console.log("Page: ", this.state.page);
                    console.log("Index: ", this.state.index);

                    if (
                      this.state.pagesValues[this.state.page].text.length - 1 >=
                      this.state.index
                    ) {
                      // Check if the current reading position  is not exceding the ammount of elements in the page
                      newindex = continueReading(
                        this.state.pagesValues[this.state.page],
                        this.state.currentCARole,
                        this.state.index
                      );
                      // If it does not exceds, we read the dialogue based on the CA role
                      console.log(newindex);
                      this.setState({ ...this.state, index: newindex });
                      console.log("Index: ", this.state.index);
                    } else {
                      if (this.state.page < this.state.pagesValues.length - 1) {
                        this.setState({
                          ...this.state,
                          page: this.state.page + 1,
                          index: 0,
                        });
                        //If it exceds, we just move to a new page
                      } else {
                        this.setState({ ...this.state, page: 0, index: 0 });
                      }
                    }
                  }}
                >
                  Next
                </button>
              </div>
            </div>
        </div>
        </div>
        </div>
      </div>
    );
  }
}

function continueReading(page, role, index) {
  const msg = new SpeechSynthesisUtterance();
  msg.lang = "en-US";
  if (index > 0) {
    page.text[index - 1].Reading = false;
  }
  page.text[index].Reading = true;
  if (page.text[index].Character === role) {
    msg.text = page.text[index].Dialogue;
    window.speechSynthesis.speak(msg);
  }
  index += 1;
  return index;
}

function extractCurrentCharacters(page){
  var currentCharacters = [];
  for (var i = 0; i < page.text.length; i++) {
    if(currentCharacters.indexOf(page.text[i].Character) === -1) 
    { currentCharacters.push(page.text[i].Character);}
  }
  return currentCharacters;
}

export default Reader;
