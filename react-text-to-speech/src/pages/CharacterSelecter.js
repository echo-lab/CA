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

  const handleOptionChange = (characterName, value) => {
    
    setCharacterValues({ ...characterValues, [characterName]: value });
  };

  const handleDragEnd = (result) => {
    // Check if the item was dropped outside of a droppable area
    if (!result.destination) {
        return;
    }
    const newCharacterValues = { ...characterValues };
    console.log(newCharacterValues)
    const role = roles.find(role => role.Role === result.draggableId); // find the actual role object
    newCharacterValues[result.destination.droppableId] = role; // store the role object instead of id
    setCharacterValues(newCharacterValues);
    console.log(newCharacterValues)
};

  const navigate = useNavigate();

  const handleNextButtonClick = () => {
    const selectedOptions = Object.keys(characterValues).map((characterName) => ({
      Character: characterName,
      VA: characterValues[characterName].RoleParameter,
    }));
    console.log("Print",selectedOptions);
    navigate("/story", { state: { selectedOptions } });
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
    <div>
      <div className="row">
        <div className="rightbutton col-1">
          <Link to="/">
            <button className="btn btn-primary">
              <i>
                <KeyboardDoubleArrowLeftIcon />
              </i>
            </button>
          </Link>
        </div>
        <div className="col-8">
          <div className="sectionTitle display-3 m-7">Select Character's Role</div>
          <Droppable droppableId="roles">
        {(provided) => (
          <div 
            {...provided.droppableProps} 
            ref={provided.innerRef}
            className="DraggableContainer" // Apply the CSS class
          >
            {roles.map((role, index) => (
               <RoleDraggable key={role.Role} role={role} draggableId={role.Role} index={index} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      <div className="character-cards-container">

          {book &&
            book.Characters.map((character, index) => {
              const role = characterValues[character.charater_name];
              return (
                <div key={index}>
                  <CharacterCard character={character} role={role} />
                </div>
              );
            })}
        </div>
        </div>
        <div className="leftbutton col-1">
          <button className="btn btn-primary" onClick={handleNextButtonClick}>
            <i>
              <KeyboardDoubleArrowRightIcon />
            </i>
          </button>
        </div>
      </div>
    </div>
    </DragDropContext>
  );
}

export default CharaterSelecter;
