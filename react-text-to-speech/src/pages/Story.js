import mainPicture from "../Pictures/pinnochio.png"; 
import arrow  from "../Pictures/arrow.png"; 
import secondPicture from "../Pictures/SecondPicture.gif"; 
import React from "react";
import '../styles/Story.css'



class Page {
  constructor(img,text){
    this.image = img;
    this.text = text;
  }


}


class Book {
  constructor(name,pages,characters) {
    this.name = name;
    this.pages = pages;
    this.characters = characters;
  }

  getCharacters(){
    return this.characters;
  }

  getNextPage(currentPage){
    if(currentPage < this.pages.lenght){
      return this.pages[currentPage+1];
    } else{
      return null;
    }

  }
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



var Characters = ["Narrator", "Geppetto", "Pinocchio","Blue Fairy"];

var firstPage = new Page(mainPicture, firstPageContent);
var secondPage = new Page(secondPicture, secondPageContent);

var Pages = [firstPage,secondPage];

var CurrentBook = new Book("Pinnochio", Pages,Characters);


class Reader extends React.Component{


  constructor(props) {
    super(props);
    this.state = {
      page: 0,
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
      <h1> {CurrentBook.name} </h1> 
      
      <label>
      VA:        
      <select
      value = {this.state.currentCARole /* Get the CA Rol */}
      onChange= { e => this.getState(e.target.value) /*When we change the value of the CA, we update the state of the Reader */}
      >
      {CurrentBook.getCharacters().map((val) => { /*Map the values from the Book to the CA option selection */
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
        {CurrentBook.pages[this.state.page].text.map((val, key) => { /*Map the current Page on the Table*/ 
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
      <img src={CurrentBook.pages[this.state.page].image /*Map the current picture of the Page*/ } alt="Pinnochio" /> 
    </div>

      </div>
      <button onClick={
        () => {
          console.log("Page: ",this.state.page);
          console.log("Index: ",this.state.index)
          if (CurrentBook.pages[this.state.page].text.length > this.state.index){ 
            // Check if the current reading position  is not exceding the ammount of elements in the page
          newindex = continueReading(CurrentBook.pages[this.state.page], this.state.currentCARole, this.state.index ) 
          // If it does not exceds, we read the dialogue based on the CA role

          this.setState({...this.state,index : newindex});
          } else {
            this.setState( { ...this.state, page : +1, index: 0  }  )
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
