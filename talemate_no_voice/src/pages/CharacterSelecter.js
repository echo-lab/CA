import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import CharacterCard from "../components/CharacterCard.js";
import "../styles/CharacterSelecter.css"; // Path to your CSS file
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { useNavigate } from "react-router-dom";
import {roles} from "../Book/Roles.js"
import { DragDropContext ,Droppable } from "react-beautiful-dnd";
import RoleDraggable from "../components/RoleDraggable.js"; // Your RoleDraggable component
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import Modal from 'react-modal';



function Book(data) {

  data.map((val) => {
    return (
      (this.name = val.Book.Name),
      (this.characters = val.Book.Characters),
      (this.pages = val.Book.Pages)
    );
  });
}

Modal.setAppElement('#root') // Replace #root with your app's root element id

function CharaterSelecter() {
  const location = useLocation();
  const id = location.state ? location.state.id : null;
  const userName = location.state ? location.state.name : null;
  const [modalIsOpen, setModalIsOpen] = useState(false);



   // Generate book based on id
   let bookData
   switch (id) {
     case 1:
       bookData = data1;
       break;
     case 2:
       bookData = data2;
       break;
     case 3:
       bookData = data3;
       break;
     default:
       throw new Error("Invalid book id");
   }

   const book = React.useMemo(() => new Book(bookData), [bookData]);


  const [characterValues, setCharacterValues] = useState({});
  const [availableRoles, setAvailableRoles] = useState(roles);

  // Populate default character values
  useEffect(() => {
    if (book) {
      const defaultValues = book.characters.reduce((acc, character) => {
        if (character.roles && character.roles.length > 0) {
          acc[character.Name] = character.roles[0];
        } else {
          acc[character.Name] = "";
        }
        return acc;
      }, {});
      setCharacterValues(defaultValues);
    }
  }, [book]);

  


  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    console.log(result.source);
    console.log(result.destination);
    console.log(result.draggableId);
  
    // If there's no destination or the item is dropped back to the same place, do nothing
    if (!destination || (source.droppableId === destination.droppableId)) {
      console.log(destination ? "Dragged to the same spot!" : "No destination found!");
      return;
    }
  
  const roleDragged = availableRoles.find(role => role.Role === draggableId);
  console.log("Role Dragged:", roleDragged);
  const roleAtDestination = characterValues[destination.droppableId];
  let updatedAvailableRoles = [...availableRoles];

  if (source.droppableId === "roles") {
    // Remove the dragged role from availableRoles
    updatedAvailableRoles = updatedAvailableRoles.filter(role => role.Role !== draggableId);

    // If the destination character had a role, add it back to availableRoles
    if (roleAtDestination) {
      updatedAvailableRoles.push(roleAtDestination);
    }
  }

  const newCharacterValues = { ...characterValues };
  
  if (source.droppableId !== "roles" && destination.droppableId !== "roles") {
    // Swap roles between two characters
    newCharacterValues[destination.droppableId] = characterValues[source.droppableId];
    newCharacterValues[source.droppableId] = roleAtDestination;
  } else {
    // If the role was dragged from the roles list
    newCharacterValues[destination.droppableId] = roleDragged;
  }
  
  console.log("New character values after swap:", newCharacterValues);
  console.log(updatedAvailableRoles);
  setAvailableRoles(updatedAvailableRoles);
  setCharacterValues(newCharacterValues);
  console.log(characterValues);
};

  
  
  
  

  const navigate = useNavigate();

  const handleNextButtonClick = () => {
    const hasAllRolesAssigned = Object.values(characterValues).every(value => value !== "");
  
    if (!hasAllRolesAssigned) {
      setModalIsOpen(true);
      return;
    }
  
    const selectedOptions = Object.keys(characterValues).map((characterName) => ({
      Character: characterName,
      VA: characterValues[characterName].RoleParameter,
      role:characterValues[characterName].Role,
      img: characterValues[characterName].img
    }));

    navigate("/story", { state: { selectedOptions,id } });
  };
  
  const handleBackButtonClick = () => {
    navigate('/');
  };

    
  
  return (
    <div className="characterSelecter">
     <Modal isOpen={modalIsOpen} onRequestClose={()=> setModalIsOpen(false)}  className="modalContent">
        <h2>Tale Mate</h2>
        <p>Please assign one role to each character before continuing</p>
        <button onClick={()=> setModalIsOpen(false)}>Close</button>
      </Modal>
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="d-flex flex-column align-items-stretch min-vh-100">
        <div className="d-flex justify-content-between p-3 bg-light">
            <button className="btn btn-primary next-btn" onClick={handleBackButtonClick}>
              <KeyboardDoubleArrowLeftIcon style={{ fontSize: "2rem" }}/>
            </button>
          <div className="text-center">
            <div className="sectionTitle display-3">Select a Role</div>
            <p>Select a role from the left side, then drag and drop it onto a character on the right to assign voices.</p>
          </div>
          <button className="btn btn-primary next-btn" onClick={handleNextButtonClick}>
            <KeyboardDoubleArrowRightIcon style={{ fontSize: "2rem" }}/>
          </button>
        </div>
  
        <div className="d-flex flex-row justify-content-around flex-grow-1">
          <div className="col-2">
            <Droppable droppableId="roles">
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="DraggableContainer"
                >
                  {availableRoles.map((role, index) => (
                     <RoleDraggable key={role.Role} role={role} draggableId={role.Role} index={index} name={userName} />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
    
          <div className="col-9">
            <div className="character-cards-container">
              {book && book.characters.map((character, index) => {
                const role = characterValues[character.Name];
                return (
                  <CharacterCard character={character} role={role} key={index}/>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DragDropContext>
    </div>
  );
  
  
  
  
}

export default CharaterSelecter;
