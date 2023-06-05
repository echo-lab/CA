import React from "react";
import "../styles/CharacterCard.css";
import { Droppable } from "react-beautiful-dnd";
import RoleDraggable from "../components/RoleDraggable.js";



function CharacterCard({ character, role  }) {

  const defaultMessage = "Select a role from the left side, then drag and drop it onto this box that role to this character voices.";



  return (
    <div className="character-card">
      <div className="card">
        <div className="card-content">
          <div className="left-column">
            <h5 className="card-title">{character.Name}</h5>
            <div className="card-img-container">
              <img
                src={character.img}
                className="card-img-top"
                alt={character.Name}
              />
            </div>
          </div>
          <Droppable droppableId={character.Name}>
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="droppable-area"
              >
              {role ? <RoleDraggable draggableId={role.Role} role={role} index={0} /> : <p className="default-message">{defaultMessage}</p>}
              {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </div>
  );
}

export default CharacterCard;