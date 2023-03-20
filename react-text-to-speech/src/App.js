import "./App.css"
import arrow  from "./Pictures/arrow.png"; 
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
  




var CurrentBook = new Book(data);






class Reader extends React.Component{


  constructor(props) {
    super(props);
    this.state = {
      page: 7,
      index : 0,
      currentCARole: "Narrator",
      pagesKeys: Object.keys(CurrentBook.pages),
      pagesValues : Object.values(CurrentBook.pages),
      stop: false
    };
  }

  getState(narrator){
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
          console.log(this.state.pagesValues.length -1)
          console.log(this.state.pagesValues[this.state.page].text.length -1 )
          console.log("Page: ",this.state.page);
          console.log("Index: ",this.state.index);
          
            if (this.state.pagesValues[this.state.page].text.length -1 >= this.state.index){ 
            // Check if the current reading position  is not exceding the ammount of elements in the page
          newindex = continueReading(this.state.pagesValues[this.state.page], this.state.currentCARole, this.state.index) 
          // If it does not exceds, we read the dialogue based on the CA role
          console.log(newindex)
          this.setState({...this.state, index : newindex});
          console.log("Index: ",this.state.index);
          } else {
            if(this.state.page < this.state.pagesValues.length-1){
            this.setState( { ...this.state, page : this.state.page+1, index: 0  }  )
            //If it exceds, we just move to a new page
            }else {
              this.setState( { ...this.state, page : 0, index: 0  }  )
            }
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
  if(index > 0) {
    page.text[index-1].Reading = false;
  }
  page.text[index].Reading = true;
  if(page.text[index].Character === role) {
    msg.text = page.text[index].Dialogue
    window.speechSynthesis.speak(msg)
  }
  index +=1
  return index;
  
}








export default Reader
