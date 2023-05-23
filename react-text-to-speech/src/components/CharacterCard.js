import React from "react";
import "../styles/CharacterCard.css";
import { Droppable } from "react-beautiful-dnd";
import RoleDraggable from "../components/RoleDraggable.js";



function CharacterCard({ character, role  }) {


  return (
    <div className="character-card">
      <div className="card">
        <div className="card-content">
          <div className="left-column">
            <h5 className="card-title">{character.charater_name}</h5>
            <div className="card-img-container">
              <img
                src={character.img}
                className="card-img-top"
                alt={character.charater_name}
              />
            </div>
          </div>
          <Droppable droppableId={character.charater_name}>
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="droppable-area"
              >
                {role && <RoleDraggable draggableId={role.Role} role={role} index={0} />}
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