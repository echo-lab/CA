import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import CharacterCard from "../components/CharacterCard.js";
import "../styles/CharacterSelecter.css"; // Path to your CSS file
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { booksSummery } from "../Book/BooksSummery";
import { useNavigate } from "react-router-dom";
import {roles} from "../Book/Roles.js"
import { DragDropContext, Draggable ,Droppable } from "react-beautiful-dnd";
import RoleDraggable from "../components/RoleDraggable.js"; // Your RoleDraggable component


function CharaterSelecter() {
  const location = useLocation();
  const id = location.state ? location.state.id : null;

  const book = booksSummery.find((book) => book.id === id);
  const [characterValues, setCharacterValues] = useState({});
  const [availableRoles, setAvailableRoles] = useState(roles);


  // Populate default character values
  useEffect(() => {
    if (book) {
      const defaultValues = book.Characters.reduce((acc, character) => {
        if (character.roles && character.roles.length > 0) {
          acc[character.charater_name] = character.roles[0];
        } else {
          acc[character.charater_name] = "";
        }
        return acc;
      }, {});
      setCharacterValues(defaultValues);
    }
  }, [book]);

  



  const handleDragEnd = (result) => {
    if (!result.destination) {
      return;
    }
  
    const newCharacterValues = { ...characterValues };
    const role = availableRoles.find((role) => role.Role === result.draggableId);
    const currentRole = newCharacterValues[result.destination.droppableId];
  
    // If there is already a role, prepare it to be added back to the available roles
    let rolesToAddBack = [];
    if (currentRole) {
      rolesToAddBack = [currentRole];
    }
  
    // Update the character value with the selected role
    newCharacterValues[result.destination.droppableId] = role;
  
    // Remove the selected role from the available roles and add back the old role (if any)
    const updatedAvailableRoles = [...availableRoles, ...rolesToAddBack].filter((r) => r.Role !== result.draggableId);
  
    setCharacterValues(newCharacterValues);
    setAvailableRoles(updatedAvailableRoles);
  };
  
  
  

  const navigate = useNavigate();

  const handleNextButtonClick = () => {
    const selectedOptions = Object.keys(characterValues).map((characterName) => ({
      Character: characterName,
      VA: characterValues[characterName].RoleParameter,
      img: characterValues[characterName].img
    }));
    navigate("/story", { state: { selectedOptions } });
  };
  const handleBackButtonClick = () => {
    navigate('/');
  };

    
  
  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="d-flex flex-column align-items-stretch min-vh-100">
        <div className="d-flex justify-content-between p-3 bg-light">
            <button className="btn btn-primary" onClick={handleBackButtonClick}>
              <KeyboardDoubleArrowLeftIcon />
            </button>
          <div className="text-center">
            <div className="sectionTitle display-3">Select a Role</div>
            <p>Select a role from the left side, then drag and drop it onto a character on the right to assign voices.</p>
          </div>
          <button className="btn btn-primary" onClick={handleNextButtonClick}>
            <KeyboardDoubleArrowRightIcon />
          </button>
        </div>
  
        <div className="d-flex flex-row justify-content-around flex-grow-1">
          <div className="col-4">
            <Droppable droppableId="roles">
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="DraggableContainer"
                >
                  {availableRoles.map((role, index) => (
                     <RoleDraggable key={role.Role} role={role} draggableId={role.Role} index={index} />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
    
          <div className="col-8">
            <div className="character-cards-container">
              {book && book.Characters.map((character, index) => {
                const role = characterValues[character.charater_name];
                return (
                  <CharacterCard character={character} role={role} key={index}/>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DragDropContext>
  );
  
  
  
  
}

export default CharaterSelecter;
