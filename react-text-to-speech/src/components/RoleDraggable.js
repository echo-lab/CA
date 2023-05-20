import React from 'react';
import { Draggable } from "react-beautiful-dnd";
import "../styles/RoleDraggable.css"; // Path to your CSS file
import PlayArrowIcon from '@mui/icons-material/PlayArrow';


function RoleDraggable({ draggableId,role, index }) {

    const playSound = () => {
        
        speak('AIzaSyByB-Lfc_cDmyw2fg6nsJ2_KreRwuuwuNg')
      };
    

      async function speak(apiKey){
        try {
            const request = {
              input: { text: "Hello I am "+role.Role },
              voice: role.RoleParameter,
              audioConfig: { audioEncoding: 'MP3' },
            };
      
            const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + apiKey, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(request),
            });
      
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
      
            const data = await response.json();
            const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
            audio.play();
          } catch (error) {
            console.error('Error in Google Text-to-Speech:', error);
          }
      }
  return (
   
    <Draggable draggableId={String(role.Role)} index={index}>
      {(provided) => (
        <div
            className="RoleDraggable" // apply the class here
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <img src={role.img} alt={role.Role} />
          <span>{role.Role}</span>
          { role.Role !== "Parent" && role.Role !== "Child" && (
                <button onClick={playSound}>
                  <PlayArrowIcon />
                </button>
            )}

        </div>
      )}
    </Draggable>
  );
}

export default RoleDraggable;
