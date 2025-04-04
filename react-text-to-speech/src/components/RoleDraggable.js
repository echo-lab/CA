import React from 'react';
import { Draggable } from "react-beautiful-dnd";
import "../styles/RoleDraggable.css"; // Path to your CSS file
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

const url = process.env.REACT_APP_TTSURL;
const port = process.env.REACT_APP_PORT;
const TTSurl = url + (port?":"+port:"");
function RoleDraggable({ draggableId,role, index, name, isDragDisabled}) {

    const playSound = () => {
        
        speak()
      };
    

      async function speak(){
        try {
            const request = {
              text: "Hello " +name+ ", I am "+role.Role,
              voice: role.RoleParameter
            };
      
            const response = await fetch(TTSurl+'/synthesize', {
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
   
    <Draggable draggableId={String(role.Role)} index={index}  isDragDisabled={isDragDisabled}>
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
