import "./App.css"
import { useState } from "react"
import mainPicture from "./Pictures/pinnochio.png"; 


const firstPage = 
["Narrator: One day, Geppetto made a little boy of wood", 
"Pinnochio: When he finished, Geppetto sighed", 
"Geppetto: I wish this wooden boy were real and could live here with me"];



function App() {
  const [ourText, setOurText] = useState("")
  const msg = new SpeechSynthesisUtterance()
  msg.lang = 'en-US'

  const speechHandler = (msg) => {
    msg.text = ourText
    window.speechSynthesis.speak(msg)
  }

  return (
    <div className='App'>
      <h1>Pinnochio</h1>
      <button onClick={() => speechHandler(msg)}>SPEAK</button>
      <div class="container">
        <div class="image">
      <img src={mainPicture} alt="Pinnochio" />
    </div>
      <div class="text">
        <h1>This is a beautiful picture.</h1>
      </div>
      </div>
      </div>
  )
}

export default App
