import "./App.css"
import { useState } from "react"
import mainPicture from "./Pictures/pinnochio.png"; 


const firstPage = 
[ {Character: "Narrator", Dialogue: "One day, Geppetto made a little boy of wood. \n When he finished, Geppetto sighed"}, 
{Character:"Geppetto", Dialogue: "I wish this wooden boy were real and could live here with me"}];




function App() {
  const msg = new SpeechSynthesisUtterance()
  msg.lang = 'en-US'
  var character = "Narrator";
  var stats = 0;



  function pauser() {
    return new Promise(resolve => {
        let playbuttonclick = function () {
  
            // Remove the event from play button
            // after clicking play button 
            document.getElementById("continue")
                .removeEventListener("click", playbuttonclick);
            stats = 0;
            resolve("resolved");
        }
  
        // Here is the event listener for play
        // button (instead of setTimeout) which
        // will wait for the element to get click
        // to get resolved until then it will be
        // remain stucked inside Promise 
        document.getElementById("continue")
            .addEventListener("click", playbuttonclick)
    })
}

  async function speech(page, role) {
    for (let key in page) {
      if(page[key].Character === role){
      msg.text = page[key].Dialogue
      window.speechSynthesis.speak(msg)
      } else {
        await pauser();
      }
    }
  
}

    
  

  return (
    <div className='App'>
      <h1>Pinnochio</h1>

      <button onClick={
        () => {speech(firstPage, character)}
        
        }>
        
        PLAY
      
      </button>

      <button onClick={
        () => {character = "Narrator"}
        
        }>
        
        Narrator
      
      </button>

      <button onClick={
        () => {character = "Geppetto"}
        
        }>
        
        Geppetto
      
      </button>

      <button id="continue" onClick={
        () => {}
        
        }>
        
        Continue
      
         </button>


      <div class="container">
      <div class="table">
      <table>
        {firstPage.map((val, key) => {
          return (
            <tr key={key}>
              <td>{val.Character}</td>
              <td>{val.Dialogue}</td>
            </tr>
          )
        })}
      </table>
      </div>
        <div class="image">
      <img src={mainPicture} alt="Pinnochio" />
    </div>

      </div>
      </div>
  )
}

export default App
