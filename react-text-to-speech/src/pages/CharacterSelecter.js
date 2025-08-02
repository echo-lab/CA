import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Modal from "react-modal";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import "../styles/CharacterSelecter.css";
import "../styles/RoleDraggable.css";
import "../styles/CharacterCard.css";

import { roles } from "../Book/Roles.js";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";

const url = process.env.REACT_APP_TTSURL;
const port = process.env.REACT_APP_PORT;
const TTSurl = url + (port ? `:${port}` : "");
const ROLE_PRIORITY = { Parent: 0, Child: 1 };

Modal.setAppElement("#root");

// — Draggable role icon — 
function RoleDraggable({ role, index, name, isDragDisabled, style = {} }) {
  const [playDisabled, setPlayDisabled] = useState(false);

  const playSound = () => {
    setPlayDisabled(true);
    speak();
    setTimeout(() => setPlayDisabled(false), 2000);
  };

  async function speak() {
    try {
      const voice =
        role.Role === "Parent" ? "en-US-Wavenet-F" : role.RoleParameter;
      const request = { text: `Hello ${name}, I am ${role.Role}`, voice };
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
    <Draggable
      draggableId={role.Role}
      index={index}
      isDragDisabled={isDragDisabled}
    >
      {(provided, snapshot) => (
        <div
          className="RoleDraggable"
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
          style={{
            ...provided.draggableProps.style,
            ...style,
            zIndex: snapshot.isDragging ? 9999 : "auto",
          }}
        >
          <img src={role.img} alt={role.Role} />
          <span>{role.Role}</span>
          {role.Role !== "Parent" && role.Role !== "Child" && (
            <button onClick={playSound} disabled={playDisabled}>
              <PlayArrowIcon />
            </button>
          )}
        </div>
      )}
    </Draggable>
  );
}

// — Character card (drop target) — 
// ——— One character’s card (drop target) ———
function CharacterCard({ character, role, userName, difficulty }) {
  const defaultMsg =
    "Select a role from the left, then drag it here to assign the voice.";
  return (
    <div className="character-card">
      <div className="card">
        <div className="card-content">
          <div className="left-column">
            <h5 className="card-title">
              {character.Name}
              <span
                className={`difficulty-badge difficulty-${difficulty.toLowerCase()}`}
              >
                {difficulty}
              </span>
            </h5>
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
                className="droppable-area"
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {role ? (
                  // Notice: no style prop here, so full opacity in the box
                  <RoleDraggable
                    key={role.Role}
                    role={role}
                    index={0}
                    name={userName}
                    isDragDisabled={false}
                  />
                ) : (
                  <p className="default-message">{defaultMsg}</p>
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


// — Simple Book wrapper —
function Book(data) {
  this.name = data[0].Book.Name;
  this.characters = data[0].Book.Characters;
  this.pages = data[0].Book.Pages;
}

export default function CharaterSelecter() {
  const location = useLocation();
  const id = location.state?.id;
  const userName = location.state?.name;
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [simPair, setSimPair] = useState(null);

  const [characterValues, setCharacterValues] = useState({});
  const [availableRoles, setAvailableRoles] = useState(
    roles.map((r) => ({ ...r, isAssigned: false }))
  );

  // select book JSON
  const bookData = id === 1 ? data1 : id === 2 ? data2 : data3;
  const book = React.useMemo(() => new Book(bookData), [bookData]);

  // initialize defaults
  useEffect(() => {
    const defaults = {};
    book.characters.forEach((c) => {
      defaults[c.Name] = c.roles?.[0] || "";
    });
    setCharacterValues(defaults);
  }, [book]);

  const initialOrder = React.useMemo(() => {
  const map = new Map();
  roles.forEach((r, idx) => map.set(r.Role, idx));
  return map;
}, []);

const deckRoles = React.useMemo(() => {
  return availableRoles
    .filter((r) => !r.isAssigned)
    .sort((a, b) => {
      const pa = ROLE_PRIORITY[a.Role] ?? 2;
      const pb = ROLE_PRIORITY[b.Role] ?? 2;
      if (pa !== pb) return pa - pb; // Parent/Child first
      return (initialOrder.get(a.Role) ?? 999) - (initialOrder.get(b.Role) ?? 999); // stable fallback
    });
}, [availableRoles, initialOrder]);

  // check for similar voices
  const similarVoicesMapping = {
    Yellow: ["Blue"],
    Blue: ["Yellow"],
    Violet: ["Green"],
    Green: ["Violet"],
  };
  const checkSimilar = () => {
    const assigned = Object.values(characterValues).filter(Boolean);
    for (let i = 0; i < assigned.length; i++) {
      for (let j = i + 1; j < assigned.length; j++) {
        const a = assigned[i].voiceColor,
          b = assigned[j].voiceColor;
        if (similarVoicesMapping[a]?.includes(b)) return [a, b];
      }
    }
    return null;
  };

  // on drag end
  const handleDragEnd = (result) => {
  const { source, destination, draggableId } = result;
  // nothing to do if dropped outside or back into the same list
  if (!destination || source.droppableId === destination.droppableId) return;

  // defer our updates until after the built-in drop animation completes
  window.requestAnimationFrame(() => {
    const newChars = { ...characterValues };
    const newRoles = availableRoles.map((r) => ({ ...r }));

    // 1) If dragging out of a character, unassign it using whatever is in that slot
    if (source.droppableId !== "roles") {
      const srcRoleName = newChars[source.droppableId]?.Role ?? draggableId;
      const srcEntry = newRoles.find((r) => r.Role === srcRoleName);
      if (srcEntry) srcEntry.isAssigned = false;
      newChars[source.droppableId] = "";
    }

    // 2) If dropping onto a character, free any old one and assign the dragged
    if (destination.droppableId !== "roles") {
      const oldRoleName = newChars[destination.droppableId]?.Role;
      if (oldRoleName) {
        const oldEntry = newRoles.find((r) => r.Role === oldRoleName);
        if (oldEntry) oldEntry.isAssigned = false;
      }

      const draggedEntry = newRoles.find((r) => r.Role === draggableId);
      if (draggedEntry) draggedEntry.isAssigned = true;

      // store a CLONE in characterValues to avoid shared mutations with deck
      newChars[destination.droppableId] = draggedEntry ? { ...draggedEntry } : "";
    }

    setCharacterValues(newChars);
    setAvailableRoles(newRoles);
  });
};


  // next button
  const navigateToStory = () => {
    if (Object.values(characterValues).some((v) => !v)) {
      return setModalOpen(true);
    }
    const clash = checkSimilar();
    if (clash) {
      setSimPair(clash);
      return setSimModalOpen(true);
    }
    const selectedOptions = Object.entries(characterValues).map(
      ([Character, role]) => ({
        Character,
        VA: role.RoleParameter,
        role: role.Role,
        img: role.img,
      })
    );
    navigate("/story", { state: { selectedOptions, id } });
  };


  return (
    <div className="characterSelecter">
      {/* Modals */}
      <Modal
        isOpen={modalOpen}
        onRequestClose={() => setModalOpen(false)}
        className="modalContent"
      >
        <h2>TaleMate</h2>
        <p>Please assign one role to each character before continuing.</p>
        <button onClick={() => setModalOpen(false)}>Close</button>
      </Modal>
      <Modal
        isOpen={simModalOpen}
        onRequestClose={() => setSimModalOpen(false)}
        className="modalContent"
      >
        <h2>Warning</h2>
        <p>
          Voices "{simPair?.[0]}" and "{simPair?.[1]}" are too similar.
        </p>
        <p>Please choose different voices to avoid confusion.</p>
        <button onClick={() => setSimModalOpen(false)}>Go Back</button>
        <button
          onClick={() => {
            setSimModalOpen(false);
            navigateToStory();
          }}
        >
          Proceed Anyway
        </button>
      </Modal>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="d-flex flex-column min-vh-100">
          <div className="d-flex justify-content-between p-3 bg-light">
            <button
              className="btn btn-primary"
              onClick={() => navigate("/")}
            >
              <KeyboardDoubleArrowLeftIcon fontSize="large" />
            </button>
            <div className="text-center">
              <h1>Select a Role</h1>
              <p>Drag any role onto each character.</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={navigateToStory}
            >
              <KeyboardDoubleArrowRightIcon fontSize="large" />
            </button>
          </div>

          <div className="d-flex flex-grow-1">
            {/* Left rack: PC first, then always show other roles */}
            <div className="col-2">
              <Droppable droppableId="roles">
                {(provided) => (
                  <div
                    className="DraggableContainer"
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                  >
                    {deckRoles.map((r, i) => (
                      <RoleDraggable
                        key={r.Role}
                        role={r}
                        index={i}
                        name={userName}
                        isDragDisabled={false}
                      />
                    ))}

                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>

            {/* Character cards */}
            <div className="col-9">
              <div className="character-cards-container">
                {book.characters.map((char) => (
                  <CharacterCard
                    key={char.Name}
                    character={char}
                    role={characterValues[char.Name]}
                    userName={userName}
                    difficulty={
                      ({
                        1: { Narrator: "Hard", Clara: "Easy", Zoe: "Medium" },
                        2: { Narrator: "Hard", Clara: "Medium", Zoe: "Easy" },
                        3: { Narrator: "Hard", Clara: "Medium", Zoe: "Easy" },
                      }[id] || {})[char.Name] || ""
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}
