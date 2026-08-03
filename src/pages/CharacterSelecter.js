import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import Modal from "react-modal";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import "../styles/CharacterSelecter.css";
import "../styles/RoleDraggable.css";
import "../styles/CharacterCard.css";

import { roles } from "../Book/Roles.js";
import { getRoleKind, isVoiceRole } from "../utils/roles";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";

import { say, unlockTtsAudio } from "../utils/ttsClient";
import { prefetchImageAnalysis } from "../utils/imageAnalysis";

const ROLE_PRIORITY = { Parent: 0, Child: 1 };
const ROLES_DROPPABLE_ID = "roles";

Modal.setAppElement("#root");

const DIFFICULTY_MAP = {
  1: {
    Narrator: "",
    Clara: "Easy",
    Zoe: "Hard",
  },
  2: {
    Narrator: "",
    Clara: "Easy",
    Zoe: "Hard",
  },
  3: {
    Narrator: "",
    Clara: "Easy",
    Zoe: "Hard",
  },
};

function getDifficultyLabel(bookId, characterName) {
  return DIFFICULTY_MAP[bookId]?.[characterName] ?? "";
}

function collisionDetection(args) {
  const pointerHits = pointerWithin(args);
  return pointerHits.length ? pointerHits : rectIntersection(args);
}

function RoleTileVisual({ role }) {
  return (
    <>
      <img src={role.img} alt={role.Role} />
      <span>{role.Role}</span>
    </>
  );
}

// — Draggable role icon (dnd-kit) —
function RoleDraggable({ role, name, needsAssignment }) {
  const [playDisabled, setPlayDisabled] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: role.Role,
  });

  const playSound = () => {
    setPlayDisabled(true);
    speak();
    setTimeout(() => setPlayDisabled(false), 2000);
  };

  async function speak() {
    try {
      const defaultVoice =
        role.Role === "Parent" ? "Kore" : role.RoleParameter || "Puck";
      await say({
        text: `Hello ${name}, I am ${role.Role}`,
        voiceName: defaultVoice,
        emotion: role.Emotion || "neutral",
      });
    } catch (err) {
      console.error("TTS error:", err);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`RoleDraggable${needsAssignment ? " needs-assignment" : ""}`}
      style={{
        touchAction: "none",
        cursor: "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <RoleTileVisual role={role} />
      {isVoiceRole(role.Role) && (
        <button
          onClick={playSound}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={playDisabled}
        >
          <PlayArrowIcon />
        </button>
      )}
    </div>
  );
}

function RolesRail({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROLES_DROPPABLE_ID });
  return (
    <aside
      ref={setNodeRef}
      className={`left-rail${isOver ? " is-over" : ""}`}
    >
      <div className="DraggableContainer">{children}</div>
    </aside>
  );
}

// — Droppable character card —
function CharacterCard({ character, role, userName, difficulty }) {
  const defaultMsg =
    "Select a role from the left, then drag it here to assign the voice.";
  const hasBadge = Boolean(difficulty);
  const badgeClass = hasBadge
    ? `difficulty-badge difficulty-${difficulty.toLowerCase()}`
    : "";
  const { setNodeRef, isOver } = useDroppable({ id: character.Name });

  return (
    <div className="character-card">
      <div className="card">
        <div className="card-content">
          <div className="left-column">
            <h5 className="card-title">
              {character.Name}
              {hasBadge && <span className={badgeClass}>{difficulty}</span>}
            </h5>
            <div className="card-img-container">
              <img
                src={character.img}
                className="card-img-top"
                alt={character.Name}
              />
            </div>
          </div>

          <div
            ref={setNodeRef}
            className={`droppable-area${isOver ? " is-over" : ""}`}
          >
            {role ? (
              <RoleDraggable key={role.Role} role={role} name={userName} />
            ) : (
              <p className="default-message">{defaultMsg}</p>
            )}
          </div>
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
  const userName = location.state?.name || location.state?.userName || "";
  const training = location.state?.training === true;
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [needsParent, setNeedsParent] = useState(false);

  const [characterValues, setCharacterValues] = useState({});
  const [activeRole, setActiveRole] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // select book JSON
  const bookData = id === 1 ? data1 : id === 2 ? data2 : data3;
  const book = React.useMemo(() => new Book(bookData), [bookData]);

  useEffect(() => {
    if (id && book.pages) prefetchImageAnalysis(id, Object.values(book.pages));
  }, [id, book.pages]);

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

  const assignedRoleNames = React.useMemo(
    () =>
      new Set(
        Object.values(characterValues)
          .filter((v) => v && v.Role)
          .map((v) => v.Role)
      ),
    [characterValues]
  );

  // Drop the highlight as soon as the Parent lands on a character.
  useEffect(() => {
    if (needsParent && assignedRoleNames.has("Parent")) setNeedsParent(false);
  }, [assignedRoleNames, needsParent]);

  const deckRoles = React.useMemo(() => {
    return roles
      .filter((r) => !assignedRoleNames.has(r.Role))
      .sort((a, b) => {
        const pa = ROLE_PRIORITY[a.Role] ?? 2;
        const pb = ROLE_PRIORITY[b.Role] ?? 2;
        if (pa !== pb) return pa - pb;
        return (
          (initialOrder.get(a.Role) ?? 999) - (initialOrder.get(b.Role) ?? 999)
        );
      });
  }, [assignedRoleNames, initialOrder]);

  const handleDragStart = ({ active }) => {
    setActiveRole(roles.find((r) => r.Role === active.id) || null);
  };

  const handleDragEnd = ({ active, over }) => {
    setActiveRole(null);
    if (!over) return;

    const draggableId = active.id; // role name
    const destId = over.id; // "roles" or a character name

    setCharacterValues((prevChars) => {
      const sourceId =
        Object.keys(prevChars).find(
          (c) => prevChars[c] && prevChars[c].Role === draggableId
        ) || ROLES_DROPPABLE_ID;

      if (sourceId === destId) return prevChars; // dropped where it started

      const draggedRole =
        (sourceId !== ROLES_DROPPABLE_ID ? prevChars[sourceId] : null) ||
        roles.find((r) => r.Role === draggableId);

      const next = { ...prevChars };

      if (sourceId !== ROLES_DROPPABLE_ID) next[sourceId] = "";

      if (destId !== ROLES_DROPPABLE_ID) {
        next[destId] = draggedRole ? { ...draggedRole } : "";
      }

      return next;
    });
  };

  // Closing the missing-Parent error
  const dismissModal = () => {
    setModalOpen(false);
    if (!needsParent) return;
    requestAnimationFrame(() => {
      document
        .querySelector(".RoleDraggable.needs-assignment")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  // next button
  const navigateToStory = () => {
    if (Object.values(characterValues).some((v) => !v)) {
      setNeedsParent(false);
      setModalMessage("Please assign one role to each character before continuing.");
      return setModalOpen(true);
    }
    // A session with no Parent has nobody stop here rather than navigating into an unusable reading session.
    const hasParent = Object.values(characterValues).some((v) => v?.Role === "Parent");
    if (!hasParent) {
      setNeedsParent(true);
      setModalMessage("One character must be read by the Parent. Drag the Parent role onto a character before continuing.");
      return setModalOpen(true);
    }
    unlockTtsAudio();
    const selectedOptions = Object.entries(characterValues).map(
      ([Character, role]) => ({
        Character,
        VA: role.RoleParameter,
        role: role.Role,
        roleKind: getRoleKind(role.Role),
        cloudVoice: role.cloudVoice,
        voiceColor: role.voiceColor,
        img: role.img,
      })
    );

    navigate("/story", {
      state: { selectedOptions, id, name: userName, training },
    });
  };

  return (
    <div className="characterSelecter">
      {/* Modals */}
      <Modal
        isOpen={modalOpen}
        onRequestClose={dismissModal}
        className="modalContent"
      >
        <h2>JENNIE</h2>
        <p>{modalMessage}</p>
        <button onClick={dismissModal}>
          {needsParent ? "Assign Parent" : "Close"}
        </button>
      </Modal>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveRole(null)}
      >
        <div className="d-flex flex-column min-vh-100">
          <div className="d-flex justify-content-between p-3 bg-light">
            <button className="btn btn-primary" onClick={() => navigate("/Home")}>
              <KeyboardDoubleArrowLeftIcon fontSize="large" />
            </button>
            <div className="text-center">
              <h1>Select a Role</h1>
              <p>Drag any role onto each character.</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                navigateToStory();
              }}
            >
              <KeyboardDoubleArrowRightIcon fontSize="large" />
            </button>
          </div>

          <div className="flex-body">
            <RolesRail>
              {deckRoles.map((r) => (
                <RoleDraggable
                  key={r.Role}
                  role={r}
                  name={userName}
                  needsAssignment={needsParent && r.Role === "Parent"}
                />
              ))}
            </RolesRail>

            <main className="main-column">
              <div className="character-cards-container">
                {book.characters.map((char) => (
                  <CharacterCard
                    key={char.Name}
                    character={char}
                    role={characterValues[char.Name]}
                    userName={userName}
                    difficulty={getDifficultyLabel(id, char.Name)}
                  />
                ))}
              </div>
            </main>
          </div>
        </div>

        {/* Floating copy that follows the pointer — renders at the top layer,
            so it can't be clipped by scroll containers (no portal hack needed). */}
        <DragOverlay modifiers={[restrictToWindowEdges]}>
          {activeRole ? (
            <div className="RoleDraggable" style={{ cursor: "grabbing" }}>
              <RoleTileVisual role={activeRole} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
