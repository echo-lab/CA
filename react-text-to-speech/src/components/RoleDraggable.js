import React from 'react';
import { Draggable } from "react-beautiful-dnd";
import "../styles/RoleDraggable.css"; // Path to your CSS file
import PlayArrowIcon from '@mui/icons-material/PlayArrow';


function RoleDraggable({ draggableId,role, index }) {

    const playSound = () => {
        
        speak()
      };
    

      async function speak(){
        try {
            const request = {
              text: "Hello I am "+role.Role,
              voice: role.RoleParameter
            };
      
            const response = await fetch('http://localhost:5000/synthesize', {
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
