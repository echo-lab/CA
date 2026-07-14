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
    Clara: "Child",
    Zoe: "Parent",
  },
  2: {
    Narrator: "",
    Clara: "Child",
    Zoe: "Parent",
  },
  3: {
    Narrator: "",
    Clara: "Child",
    Zoe: "Parent",
  },
};

function getDifficultyLabel(bookId, characterName) {
  return DIFFICULTY_MAP[bookId]?.[characterName] ?? "";
}

function isVoiceRole(roleName) {
  return roleName !== "Parent" && roleName !== "Child" && roleName !== "Dummy";
}

// Prefer whatever droppable is under the pointer/finger; fall back to rect
// overlap. This makes dropping a role back onto the left rail reliable, instead
// of the tile snapping to the nearest card's center.
function collisionDetection(args) {
  const pointerHits = pointerWithin(args);
  return pointerHits.length ? pointerHits : rectIntersection(args);
}

// Static visual for a role tile — shared by the live draggable and the
// DragOverlay so the floating copy looks identical to the source.
function RoleTileVisual({ role }) {
  return (
    <>
      <img src={role.img} alt={role.Role} />
      <span>{role.Role}</span>
    </>
  );
}

// — Draggable role icon (dnd-kit) —
function RoleDraggable({ role, name }) {
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
      className="RoleDraggable"
      style={{
        // Required so touch drags aren't stolen by the browser as scrolls.
        touchAction: "none",
        cursor: "grab",
        // The floating copy is the DragOverlay; dim the original in place.
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <RoleTileVisual role={role} />
      {isVoiceRole(role.Role) && (
        <button
          onClick={playSound}
          // Stop the drag sensor from claiming the press so the tap registers.
          onPointerDown={(e) => e.stopPropagation()}
          disabled={playDisabled}
        >
          <PlayArrowIcon />
        </button>
      )}
    </div>
  );
}

// — Droppable role deck (the whole left rail is the drop zone, so returning a
//   role to the pane works even when the deck is nearly empty) —
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

  const [characterValues, setCharacterValues] = useState({});
  const [activeRole, setActiveRole] = useState(null);

  // Fluid drag: a drag begins as soon as the pointer/finger moves 8px — no
  // press-and-hold. Replaces react-beautiful-dnd's long-press touch behavior.
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

  // characterValues is the single source of truth; the deck is simply every
  // role not currently assigned to a character.
  const assignedRoleNames = React.useMemo(
    () =>
      new Set(
        Object.values(characterValues)
          .filter((v) => v && v.Role)
          .map((v) => v.Role)
      ),
    [characterValues]
  );

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
      // Source = whichever character currently holds this role, else the deck.
      const sourceId =
        Object.keys(prevChars).find(
          (c) => prevChars[c] && prevChars[c].Role === draggableId
        ) || ROLES_DROPPABLE_ID;

      if (sourceId === destId) return prevChars; // dropped where it started

      const draggedRole =
        (sourceId !== ROLES_DROPPABLE_ID ? prevChars[sourceId] : null) ||
        roles.find((r) => r.Role === draggableId);

      const next = { ...prevChars };

      // Remove from the source character (if it came from one).
      if (sourceId !== ROLES_DROPPABLE_ID) next[sourceId] = "";

      // Place into the destination character. Dropping on the rail skips this,
      // leaving the role unassigned = back in the deck. Any role already in the
      // destination is overwritten, so it returns to the deck automatically.
      if (destId !== ROLES_DROPPABLE_ID) {
        next[destId] = draggedRole ? { ...draggedRole } : "";
      }

      return next;
    });
  };

  // next button
  const navigateToStory = () => {
    if (Object.values(characterValues).some((v) => !v)) {
      return setModalOpen(true);
    }
    unlockTtsAudio();
    const selectedOptions = Object.entries(characterValues).map(
      ([Character, role]) => ({
        Character,
        VA: role.RoleParameter,
        role: role.Role,
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
        onRequestClose={() => setModalOpen(false)}
        className="modalContent"
      >
        <h2>TaleMate</h2>
        <p>Please assign one role to each character before continuing.</p>
        <button onClick={() => setModalOpen(false)}>Close</button>
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
            <button className="btn btn-primary" onClick={() => navigate("/")}>
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
                <RoleDraggable key={r.Role} role={r} name={userName} />
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
