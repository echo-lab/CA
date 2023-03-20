import "./App.css"
import mainPicture from "./Pictures/pinnochio.png"; 
import arrow  from "./Pictures/arrow.png"; 
import secondPicture from "./Pictures/SecondPicture.gif"; 
import React from "react";
import { data } from "./Book/PinnochioBook.js";




function Page (img,text){
    this.image = img;
    this.text = text;
  }


/*Change class to function components */
/* Read about function components*/
function Book (CuurentBook) {
      data.map( val => {
        return(
          this.name = val.Book.Name,
          this.characters = val.Book.Characters,
          this.pages = val.Book.Pages
        )
          }
          )
        
      }
  



var firstPageContent = [ { Reading: false, Character: "Narrator", Dialogue: "One day, Geppetto made a little boy of wood. \n When he finished, Geppetto sighed"}, 
  {Reading: false,Character:"Geppetto", Dialogue: "I wish this wooden boy were real and could live here with me"},
  {Reading: false, Character: "Narrator", Dialogue: "Suddenly it happened! The little wooden boy came to life!. \n Geppetto shouted with joy and, with the laughter of happiness, said"},
  {Reading: false,Character:"Geppetto", Dialogue: "Be Welcome! I’ll call you Pinocchio"}
];

var secondPageContent = [ {Reading: false, Character: "Narrator", Dialogue: "Geppetto helped Pinocchio dress, gave him some books, \n kissed him on the cheek, and sent him to school to learn to read and write. \n But he warned him:"},
{Reading: false, Character:"Geppetto", Dialogue:"As soon as school is finished, \n Pinocchio will come home" },
{Reading: false, Character: "Pinocchio", Dialogue: "Yes! I will do that"},
{Reading: false, Character: "Narrator", Dialogue: "Pinocchio happily walked towards the school."}
];


/*Make this dynamic, so we only see Characters avaliable in each page */
var Characters = ["Narrator", "Geppetto", "Pinocchio","Blue Fairy"];

var firstPage = new Page(mainPicture, firstPageContent);
var secondPage = new Page(secondPicture, secondPageContent);

var Pages = [firstPage,secondPage];
/*Map the book, from json file to create this class
We want to load the book from this file */
var CurrentBook = new Book(data);






class Reader extends React.Component{


  constructor(props) {
    super(props);
    this.state = {
      page: 0,
      index : 0,
      currentCARole: "Narrator",
      pagesKeys: Object.keys(CurrentBook.pages),
      pagesValues : Object.values(CurrentBook.pages),
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
      console.log(CurrentBook.pages)
      
      var newindex =0
      return(
        <div className='App'>
      <h1> {CurrentBook.name} </h1> 
      
      <label>
      VA:        
      <select
      value = {this.state.currentCARole /* Get the CA Rol */}
      onChange= { e => this.getState(e.target.value) /*When we change the value of the CA, we update the state of the Reader */}
      >
      {CurrentBook.characters.map((val) => { /*Map the values from the Book to the CA option selection */
        return(
          <option value={val}>{val}</option>
        )
      }
      )}
      </select>
      </label>

      <div className="container">
      <div className="table">
          <table>
        {this.state.pagesValues[this.state.page].text.map((val, key) => { /*Map the current Page on the Table*/ 
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
        <div className="image">
      <img src={
        this.state.pagesValues[this.state.page].img
     /*Map the current picture of the Page*/ 
        } alt="Pinnochio" /> 
    </div>

      </div>
      <button onClick={
        () => {
          console.log("Page: ",this.state.page);
          console.log("Index: ",this.state.index)
          if (this.state.pagesValues[this.state.page].text.length > this.state.index){ 
            // Check if the current reading position  is not exceding the ammount of elements in the page
          newindex = continueReading(this.state.pagesValues[this.state.page], this.state.currentCARole, this.state.index ) 
          // If it does not exceds, we read the dialogue based on the CA role

          this.setState({...this.state,index : newindex});
          } else {
            this.setState( { ...this.state, page : this.state.page+1, index: 0  }  )
            //If it exceds, we just move to a new page
          }
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
  console.log(page);
  console.log(index)
  if(index > 0) {
    page.text[index-1].Reading = false;
  }
  page.text[index].Reading = true;
  if(page.text[index].Character === role) {
    msg.text = page.text[index].Dialogue
    console.log("Reading ", msg.text)
    window.speechSynthesis.speak(msg)
  }
  index +=1
  return index;
}








export default Reader
