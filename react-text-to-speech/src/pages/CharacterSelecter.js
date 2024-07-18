import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import "../styles/CharacterSelecter.css"; // Path to your CSS file
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { useNavigate } from "react-router-dom";
import {roles} from "../Book/Roles.js"
import { DragDropContext ,Droppable } from "react-beautiful-dnd";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import Modal from 'react-modal';
import { Draggable } from "react-beautiful-dnd";
import "../styles/RoleDraggable.css"; // Path to your CSS file
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import "../styles/CharacterCard.css";


const [isPlayButtonDisabled, setIsPlayButtonDisabled] = useState(false);
function CharacterCard({ draggableId, character, role  }) {

  const defaultMessage = "Select a role from the left side, then drag and drop it onto this box to assign a voice to this character.";
 

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
            {role ? (
              <RoleDraggable draggableId={String(draggableId)} role={role} index={0} />
            ) : (
              <>
                <p className="default-message">{defaultMessage}</p>
                <div className="placeholder"></div>
              </>
            )}
            {provided.placeholder}
            </div>
          )}
          </Droppable>
        </div>
      </div>
    </div>
  );
}



function RoleDraggable({ draggableId,role, index, name, isDragDisabled, style}) {


  const playSound = () => {

    // Disable the button
  setIsPlayButtonDisabled(true);

   // Disable the button
   setIsPlayButtonDisabled(true);

   // Re-enable the button after 5 seconds
   setTimeout(() => {
     setIsPlayButtonDisabled(false);
   }, 5000);

      
      speak()

      // Re-enable the button after 5 seconds
  setTimeout(() => {
    setIsPlayButtonDisabled(false);
  }, 5000);
      
    };
  

    async function speak(){
      try {
          const request = {
            text: "Hello " +name+ ", I am "+role.Role,
            voice: role.RoleParameter
          };
    
          const response = await fetch('https://talemate.cs.vt.edu:5000/synthesize', {
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
 
  <Draggable draggableId={String(draggableId)} index={index}  isDragDisabled={isDragDisabled}>
    {(provided) => (
      <div
          className="RoleDraggable" // apply the class here
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        ref={provided.innerRef}
        style={{ ...provided.draggableProps.style, ...style }}
        
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
  const [availableRoles, setAvailableRoles] = useState(roles.map(role => ({ ...role, isAssigned: false })));


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
    console.log(`Drag operation started:`, {source, destination, draggableId});
  
    if (!destination || (source.droppableId === destination.droppableId)) {
      console.log("Dragged to the same spot or no destination found!");
      return;
    }
  
    // Copying state in a way to ensure re-render
    const updatedCharacterValues = { ...characterValues };
    const updatedAvailableRoles = availableRoles.map(role => ({ ...role }));
    console.log(`State before update:`, { updatedCharacterValues, updatedAvailableRoles });
  
    const sourceRole = updatedAvailableRoles.find(role => role.Role === draggableId);
    const destinationCharacterRole = updatedCharacterValues[destination.droppableId];
  
    if (source.droppableId === "roles") {
      if (destinationCharacterRole) {
        // Make the previously assigned role available again
        const oldRole = updatedAvailableRoles.find(role => role.Role === destinationCharacterRole.Role);
        if (oldRole) oldRole.isAssigned = false;
        //updatedCharacterValues[source.droppableId] = null; // Ensure this character no longer references
      }
      updatedCharacterValues[destination.droppableId] = sourceRole;
      sourceRole.isAssigned = true;
    } else {
      if (destination.droppableId !== "roles") {
        const tempRole = destinationCharacterRole;
        if (tempRole) {
          // Make the replaced role available again
          const replacedRole = updatedAvailableRoles.find(role => role.Role === tempRole.Role);
          if (replacedRole) replacedRole.isAssigned = false;
        }
        updatedCharacterValues[destination.droppableId] = updatedCharacterValues[source.droppableId];
        updatedCharacterValues[source.droppableId] = tempRole;
      } else {
        sourceRole.isAssigned = false;
        updatedCharacterValues[source.droppableId] = null;
      }
    }
  
    // Re-check assignment of roles
    updatedAvailableRoles.forEach(role => {
      role.isAssigned = Object.values(updatedCharacterValues).some(charRole => charRole && charRole.Role === role.Role);
    });
  
    setCharacterValues(updatedCharacterValues);
    setAvailableRoles(updatedAvailableRoles);
    console.log(`State after update:`, { updatedCharacterValues, updatedAvailableRoles });
    console.log("Roles", availableRoles)
    
  };
  
  
  
  
  
  
  

  const navigate = useNavigate();

  const handleNextButtonClick = () => {
    const hasAllRolesAssigned = Object.values(characterValues).every(value => value !== "");
  
    if (!hasAllRolesAssigned) {
      setModalIsOpen(true);
      return;
    }
    console.log(characterValues)
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
          <div className="col-2">
            <Droppable droppableId="roles">
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="DraggableContainer"
                >
                  {availableRoles.map((role, index) => (
                     < RoleDraggable key={role.Role} role={role} draggableId={role.Role} index={index} name={userName} isDragDisabled={role.isAssigned} style={{ opacity: role.isAssigned ? 0.1 : 1 }}  // Adjust opacity based on assignment
                     />
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
                  <CharacterCard draggableId = {role} character={character} role={role} key={index}/>
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
