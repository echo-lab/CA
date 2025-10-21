import React, { useState } from "react";
import { Draggable } from "react-beautiful-dnd";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import "../styles/RoleDraggable.css";

const url = process.env.REACT_APP_TTSURL;
const port = process.env.REACT_APP_PORT;
const TTSurl = url + (port ? `:${port}` : "");

function RoleDraggable({ role, index, name, isDragDisabled, style }) {
  const [isPlayButtonDisabled, setIsPlayButtonDisabled] = useState(false);

  const playSound = () => {
    setIsPlayButtonDisabled(true);
    speak();
    setTimeout(() => setIsPlayButtonDisabled(false), 2000);
  };

  async function speak() {
    try {
      const request = {
        text: "Hello " + name + ", I am " + role.Role,
        voice: role.Role === "Parent" ? "en-US-Wavenet-F" : role.RoleParameter,
      };
      const res = await fetch(`${TTSurl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      new Audio(`data:audio/mp3;base64,${data.audioContent}`).play();
    } catch (err) {
      console.error("TTS error:", err);
    }
  }

  return (
    <Draggable draggableId={role.Role} index={index} isDragDisabled={isDragDisabled}>
  {(provided, snapshot) => {
    // build a combined transform string:
    const baseTransform = provided.draggableProps.style?.transform || "";
    // only scale when NOT dragging:
    const transform = snapshot.isDragging
      ? baseTransform
      : `${baseTransform} scale(0.8)`;

    return (
      <div
        className="RoleDraggable"
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        ref={provided.innerRef}
        style={{
          ...provided.draggableProps.style,
          ...style,              // your passed-in opacity / pointerEvents
          transform,             // our conditional scale
          zIndex: snapshot.isDragging ? 9999 : "auto",
        }}
      >
        <img src={role.img} alt={role.Role} />
        <span>{role.Role}</span>
        {role.Role !== "Parent" && role.Role !== "Child" && (
          <button onClick={playSound} disabled={isPlayButtonDisabled}>
            <PlayArrowIcon />
          </button>
        )}
      </div>
    );
  }}
</Draggable>

  );
}

export default RoleDraggable;
