import "./App.css"
import mainPicture from "./Pictures/pinnochio.png"; 
import arrow  from "./Pictures/arrow.png"; 
import React from "react";



class Page {
  constructor(img,text){
    this.imgage = img;
    this.text = text;
  }
}


class Book {
  constructor(name,pages,characters) {
    this.name = name;
    this.pages = pages;
  }
}
/* Create Data structure



/*class page {
  constructor(img, text) {
      this.img = img;
      this.text = text;
  }
}*/

/*class book extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      Name : "",
      Characters : [],
      pages: []
    };
  }
}*/

var firstPageContent = [ { Reading: false, Character: "Narrator", Dialogue: "One day, Geppetto made a little boy of wood. \n When he finished, Geppetto sighed"}, 
  {Reading: false,Character:"Geppetto", Dialogue: "I wish this wooden boy were real and could live here with me"},
  {Reading: false, Character: "Narrator", Dialogue: "Suddenly it happened! The little wooden boy came to life!. \n Geppetto shouted with joy and, with the laughter of happiness, said"},
  {Reading: false,Character:"Geppetto", Dialogue: "Be Welcome! I’ll call you Pinocchio"}
];

var Characters = ["Narrator", "Geppetto", "Pinocchio"];

var firstPage = new Page(mainPicture, firstPageContent);

var Pinnochio_Book = new Book("Pinnochio", firstPage,Characters);


class Reader extends React.Component{

  constructor(props) {
    super(props);
    this.state = {
      index : 0,
      currentCARole: "Narrator"
    };
  }

  getState(narrator){
    console.log("role ", narrator)
    this.setState({
      ...this.state,
      currentCARole: narrator
    });
  
  }
    
    render(){
     var newindex =0

      return(
        <div className='App'>
      <h1>Pinnochio</h1>
      
      <label>
      VA         
      <select
      value = {this.state.currentCARole}
      onChange= { e => this.getState(e.target.value)}
      >
      {Characters.map((val) => {
        return(
          <option value={val}>{val}</option>
        )
      }
      )}
      </select>
      </label>

      <div className="container">
      <Table/>
        <div className="image">
      <img src={mainPicture} alt="Pinnochio" />
    </div>

      </div>
      <button onClick={
        () => {
          newindex = continueReading(firstPageContent, this.state.currentCARole, this.state.index )
          this.setState({index : newindex, currentCARole: this.state.currentCARole});
        }
        
        }>
        
        Continue
      
      </button>
      </div>
      );
    }
    

}


  
  





function continueReading(page, role, index) {
  const msg = new SpeechSynthesisUtterance()
  msg.lang = 'en-US'
  console.log("role ", role)
  if(index > 0) {
    page[index-1].Reading = false;
  }
  page[index].Reading = true;
  if(page[index].Character === role) {
    msg.text = page[index].Dialogue
    console.log("Reading ", msg.text)
    window.speechSynthesis.speak(msg)
  }
  index +=1
  return index;
}

class Table extends React.Component{

  constructor(props) {
    super(props);
    this.state = {
      update : true
    };
  }

      render(){
        return (
          <div className="table">
          <table>
        {firstPageContent.map((val, key) => {
          return (
            <tr key={key}>
              <td>{val.Reading && <img style={{ width: 20, height: 20 }} src ={arrow} />} </td>
              <td>{val.Character}</td>
              <td>{val.Dialogue}</td>
            </tr>
          )
        })}
        </table>
        </div>
        );
      }
    }

var firstPageContent = [ { Reading: false, Character: "Narrator", Dialogue: "One day, Geppetto made a little boy of wood. \n When he finished, Geppetto sighed"}, 
  {Reading: false,Character:"Geppetto", Dialogue: "I wish this wooden boy were real and could live here with me"},
  {Reading: false, Character: "Narrator", Dialogue: "Suddenly it happened! The little wooden boy came to life!. \n Geppetto shouted with joy and, with the laughter of happiness, said"},
  {Reading: false,Character:"Geppetto", Dialogue: "Be Welcome! I’ll call you Pinocchio"}
];

var Characters = ["Narrator", "Geppetto", "Pinocchio"];



export default Reader
