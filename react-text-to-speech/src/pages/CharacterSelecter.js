import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../styles/CharacterSelecter.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { roles } from "../Book/Roles.js";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import Modal from "react-modal";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import "../styles/RoleDraggable.css";
import "../styles/CharacterCard.css";

const url = process.env.REACT_APP_TTSURL;
const port = process.env.REACT_APP_PORT;
const TTSurl = url + (port ? ":" + port : "");

Modal.setAppElement("#root"); 

// Mapping from book id to difficulty rating for each character
const difficultyMapping = {
  1: { Narrator: "Hard", Clara: "Easy", Zoe: "Medium" },
  2: { Narrator: "Hard", Clara: "Medium", Zoe: "Easy" },
  3: { Narrator: "Hard", Clara: "Medium", Zoe: "Easy" },
};

const similarVoicesMapping = {
  Yellow: ["Blue"],
  Blue: ["Yellow"],
  Violet: ["Green"],
  Green: ["Violet"],
};

function CharacterCard({ draggableId, character, role, userName, difficulty }) {
  const defaultMessage =
    "Select a role from the left side, then drag and drop it onto this box to assign a voice to this character.";
  return (
    <div className="character-card">
      <div className="card">
        <div className="card-content">
          <div className="left-column">
            <h5 className="card-title">
              {character.Name}
              <span className={`difficulty-badge difficulty-${difficulty.toLowerCase()}`}>
                {difficulty}
              </span>
            </h5>
            <div className="card-img-container">
              <img src={character.img} className="card-img-top" alt={character.Name} />
            </div>
          </div>
          <Droppable droppableId={character.Name}>
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="droppable-area">
                {role ? (
                  <RoleDraggable draggableId={String(draggableId)} name={userName} role={role} index={0} />
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

// Draggable component for a role
function RoleDraggable({ draggableId, role, index, name, isDragDisabled, style }) {
  const [isPlayButtonDisabled, setIsPlayButtonDisabled] = useState(false);

  const playSound = () => {
    setIsPlayButtonDisabled(true);
    speak();
    setTimeout(() => {
      setIsPlayButtonDisabled(false);
    }, 2000);
  };

  async function speak() {
    try {
      const voice = role.Role === "Parent" ? "en-US-Wavenet-F" : role.RoleParameter;
      const request = {
        text: "Hello " + name + ", I am " + role.Role,
        voice: voice,
      };
      const response = await fetch(TTSurl + "/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json();
      const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
      audio.play();
    } catch (error) {
      console.error("Error in Google Text-to-Speech:", error);
    }
  }

  return (
    <Draggable draggableId={String(draggableId)} index={index} isDragDisabled={isDragDisabled}>
      {(provided) => (
        <div
          className="RoleDraggable"
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
          style={{ ...provided.draggableProps.style, ...style }}
        >
          <img src={role.img} alt={role.Role} />
          <span>{role.Role}</span>
          {role.Role !== "Child" && role.Role !== "Parent" && (
            <button onClick={playSound} disabled={isPlayButtonDisabled}>
              <PlayArrowIcon />
            </button>
          )}
        </div>
      )}
    </Draggable>
  );
}



// Helper constructor for Book data
function Book(data) {
  this.name = data[0].Book.Name;
  this.characters = data[0].Book.Characters;
  this.pages = data[0].Book.Pages;
}

function CharaterSelecter() {
  const location = useLocation();
  const id = location.state ? location.state.id : null;
  const userName = location.state ? location.state.name : null;
  const navigate = useNavigate();

  // Modal state
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [similarVoiceModalOpen, setSimilarVoiceModalOpen] = useState(false);
  const [similarVoicePair, setSimilarVoicePair] = useState(null);

  // Character and role state
  const [characterValues, setCharacterValues] = useState({});
  const [availableRoles, setAvailableRoles] = useState(roles.map(role => ({ ...role, isAssigned: false })));

  // Select book data based on id
  let bookData;
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

  const checkForSimilarVoices = () => {
    const assignedRoles = Object.values(characterValues).filter(role => role !== "");
    for (let i = 0; i < assignedRoles.length; i++) {
      for (let j = i + 1; j < assignedRoles.length; j++) {
        const colorA = assignedRoles[i].voiceColor;
        const colorB = assignedRoles[j].voiceColor;
        if (
          similarVoicesMapping[colorA] &&
          similarVoicesMapping[colorA].includes(colorB)
        ) {
          return { found: true, pair: [colorA, colorB] };
        }
      }
    }
    return { found: false };
  };

  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    console.log("Drag operation started:", { source, destination, draggableId });
    if (!destination || source.droppableId === destination.droppableId) {
      console.log("Dragged to the same spot or no destination found!");
      return;
    }
    const updatedCharacterValues = { ...characterValues };
    const updatedAvailableRoles = availableRoles.map(role => ({ ...role }));
    console.log("State before update:", { updatedCharacterValues, updatedAvailableRoles });
    const sourceRole = updatedAvailableRoles.find(role => role.Role === draggableId);
    const destinationCharacterRole = updatedCharacterValues[destination.droppableId];
    if (source.droppableId === "roles") {
      if (destinationCharacterRole) {
        const oldRole = updatedAvailableRoles.find(role => role.Role === destinationCharacterRole.Role);
        if (oldRole) oldRole.isAssigned = false;
      }
      updatedCharacterValues[destination.droppableId] = sourceRole;
      sourceRole.isAssigned = true;
    } else {
      if (destination.droppableId !== "roles") {
        const tempRole = destinationCharacterRole;
        if (tempRole) {
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
    updatedAvailableRoles.forEach(role => {
      role.isAssigned = Object.values(updatedCharacterValues).some(
        charRole => charRole && charRole.Role === role.Role
      );
    });
    setCharacterValues(updatedCharacterValues);
    setAvailableRoles(updatedAvailableRoles);
    console.log("State after update:", { updatedCharacterValues, updatedAvailableRoles });
  };

  const navigateToStory = () => {
    const hasAllRolesAssigned = Object.values(characterValues).every(value => value !== "");
    if (!hasAllRolesAssigned) {
      setModalIsOpen(true);
      return;
    }

    const similarCheck = checkForSimilarVoices();
    if (similarCheck.found) {
      setSimilarVoicePair(similarCheck.pair);
      setSimilarVoiceModalOpen(true);
      return;
    }


    const selectedOptions = Object.keys(characterValues).map(characterName => ({
      Character: characterName,
      VA: characterValues[characterName].RoleParameter,
      role: characterValues[characterName].Role,
      img: characterValues[characterName].img,
    }));
    navigate("/story", { state: { selectedOptions, id } });
  };

  const handleBackButtonClick = () => {
    navigate("/");
  };

  return (
    <div className="characterSelecter">
      <Modal isOpen={modalIsOpen} onRequestClose={() => setModalIsOpen(false)} className="modalContent">
        <h2>TaleMate</h2>
        <p>Please assign one role to each character before continuing</p>
        <button onClick={() => setModalIsOpen(false)}>Close</button>
      </Modal>
      <Modal isOpen={similarVoiceModalOpen} onRequestClose={() => setSimilarVoiceModalOpen(false)} className="modalContent">
        <h2>Warning</h2>
        <p>
          The selected voices ({similarVoicePair ? similarVoicePair[0] : ""} and {similarVoicePair ? similarVoicePair[1] : ""}) are similar.
        </p>
        <p>Please consider choosing different voices to avoid confusion.</p>
        <button onClick={() => setSimilarVoiceModalOpen(false)}>Okay, I'll change them</button>
        <button onClick={() => {
          const selectedOptions = Object.keys(characterValues).map(characterName => ({
            Character: characterName,
            VA: characterValues[characterName].RoleParameter,
            role: characterValues[characterName].Role,
            img: characterValues[characterName].img,
          }));
          setSimilarVoiceModalOpen(false);
          navigate("/story", { state: { selectedOptions, id } });
        }}>Proceed Anyway</button>
      </Modal>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="d-flex flex-column align-items-stretch min-vh-100">
          <div className="d-flex justify-content-between p-3 bg-light">
            <button className="btn btn-primary next-btn" onClick={handleBackButtonClick}>
              <KeyboardDoubleArrowLeftIcon style={{ fontSize: "2rem" }} />
            </button>
            <div className="text-center">
              <div className="sectionTitle display-3">Select a Role</div>
              <p>Select a role from the left side, then drag and drop it onto a character on the right to assign voices.</p>
            </div>
            <button className="btn btn-primary next-btn" onClick={navigateToStory}>
              <KeyboardDoubleArrowRightIcon style={{ fontSize: "2rem" }} />
            </button>
          </div>
          <div className="d-flex flex-row justify-content-around flex-grow-1">
            <div className="col-2">
              <Droppable droppableId="roles">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="DraggableContainer">
                    {/* Render Parent and Child icons on top in a row with smaller size */}
                    <div
                      className="parent-child-row"
                      style={{ display: "flex", flexDirection: "row", justifyContent: "center", marginBottom: "1rem" }}
                    >
                      {[...availableRoles]
                        .filter(role => (role.Role === "Parent" || role.Role === "Child") && !role.isAssigned)
                        .map((role, index) => (
                          <div key={role.Role} style={{ margin: "0 0.5rem", transform: "scale(0.8)" }}>
                            <RoleDraggable
                              role={role}
                              draggableId={role.Role}
                              index={index}
                              name={userName}
                              isDragDisabled={false}
                              style={{ opacity: role.isAssigned ? 0.3 : 1, pointerEvents: role.isAssigned ? "none" : "auto" }}
                            />
                          </div>
                      ))}
                    </div>
                    {/* Render other roles */}
                    {[...availableRoles]
                      .filter(role => role.Role !== "Parent" && role.Role !== "Child" && !role.isAssigned)
                      .map((role, index) => (
                        <RoleDraggable
                          key={role.Role}
                          role={role}
                          draggableId={role.Role}
                          index={index + 1}
                          name={userName}
                          isDragDisabled={false}
                          style={{ opacity: role.isAssigned ? 0.3 : 1, pointerEvents: role.isAssigned ? "none" : "auto" }}
                        />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
            <div className="col-9">
              <div className="character-cards-container">
                {book &&
                  book.characters.map((character, index) => {
                    const role = characterValues[character.Name];
                    const difficulty = difficultyMapping[id] ? difficultyMapping[id][character.Name] : "";
                    return (
                      <CharacterCard
                        draggableId={role ? role.Role : ""}
                        character={character}
                        role={role}
                        key={index}
                        userName={userName}
                        difficulty={difficulty}
                      />
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
