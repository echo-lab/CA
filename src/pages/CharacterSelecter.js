import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "react-modal";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import "../styles/CharacterSelecter.css";
import "../styles/RoleTile.css";
import "../styles/CharacterCard.css";

import { roles } from "../Book/Roles.js";
import { getRoleKind, isVoiceRole } from "../utils/roles";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";

import { say, stopTts, unlockTtsAudio } from "../utils/ttsClient";
import { prefetchImageAnalysis } from "../utils/imageAnalysis";

const ROLE_PRIORITY = { Parent: 0, Child: 1 };
const RAIL_ID = "roles";

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

// Click/keyboard props for a div that acts as a button. A real <button> can't be
// used: role tiles contain the play <button>, and buttons can't nest. The
// target check keeps Enter on that inner button from also firing this one.
function pressable(onPress) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPress(e);
      }
    },
  };
}

// — Role tile. Tapping it in the rail selects it; inside a card the tap goes to
// the card's box instead (see CharacterCard). —
function RoleTile({ role, name, needsAssignment, selected, onSelect }) {
  const [playDisabled, setPlayDisabled] = useState(false);

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
      className={`RoleTile${needsAssignment ? " needs-assignment" : ""}${selected ? " is-selected" : ""}`}
      style={{ touchAction: "manipulation", cursor: "pointer" }}
      aria-pressed={onSelect ? selected : undefined}
      {...(onSelect &&
        pressable((e) => {
          e.stopPropagation(); // don't let the rail treat this as "unassign"
          onSelect(role.Role);
        }))}
    >
      <img src={role.img} alt={role.Role} />
      <span>{role.Role}</span>
      {isVoiceRole(role.Role) && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // previewing a voice must not select or assign
            playSound();
          }}
          disabled={playDisabled}
        >
          <PlayArrowIcon />
        </button>
      )}
    </div>
  );
}

// Tapping the rail's empty space with an assigned role selected unassigns it.
function RolesRail({ children, isTarget, onPress }) {
  return (
    <aside
      className={`left-rail${isTarget ? " is-target" : ""}`}
      onClick={onPress}
    >
      <div className="role-grid">{children}</div>
    </aside>
  );
}

// — Character card. Its box is the tap target: with a role selected, a tap
// assigns it here; with nothing selected, a tap picks up the role already here. —
function CharacterCard({ character, role, userName, difficulty, isTarget, isSelected, onPress }) {
  const defaultMsg = "Tap a role, then tap here to assign the voice.";
  const hasBadge = Boolean(difficulty);
  const badgeClass = hasBadge
    ? `difficulty-badge difficulty-${difficulty.toLowerCase()}`
    : "";

  return (
    <div className="character-card">
      <div className="character-card-inner tw-relative tw-flex tw-flex-col tw-min-w-0 tw-text-[#212529] tw-break-words tw-bg-white tw-bg-clip-border tw-border tw-border-solid tw-border-[rgba(0,0,0,0.175)]">
        <div className="card-content">
          <div className="left-column">
            <h5 className="character-card-title tw-mb-2">
              {character.Name}
              {hasBadge && <span className={badgeClass}>{difficulty}</span>}
            </h5>
            <div className="card-img-container">
              <img
                src={character.img}
                className="character-card-img tw-w-full tw-rounded-t-[0.3125rem]"
                alt={character.Name}
              />
            </div>
          </div>

          <div
            className={`role-slot${isTarget ? " is-target" : ""}`}
            aria-label={`${character.Name}: ${role ? role.Role : "no role"}`}
            {...pressable(() => onPress(character.Name))}
          >
            {role ? (
              <RoleTile key={role.Role} role={role} name={userName} selected={isSelected} />
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

  // The role-preview clips play through ttsClient's module-level <audio>, which
  // nothing in the React tree owns, so leaving mid-clip would otherwise keep it
  // talking over the next page. One page-level stop covers every role tile.
  useEffect(() => () => { stopTts(); }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [needsParent, setNeedsParent] = useState(false);

  const [characterValues, setCharacterValues] = useState({});
  // Name of the role picked by the first tap; the second tap says where it goes.
  const [selectedRole, setSelectedRole] = useState(null);

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
      .filter((r) => !r.questionMate && !assignedRoleNames.has(r.Role))
      .sort((a, b) => {
        const pa = ROLE_PRIORITY[a.Role] ?? 2;
        const pb = ROLE_PRIORITY[b.Role] ?? 2;
        if (pa !== pb) return pa - pb;
        return (
          (initialOrder.get(a.Role) ?? 999) - (initialOrder.get(b.Role) ?? 999)
        );
      });
  }, [assignedRoleNames, initialOrder]);

  // Moves a role to destId ("roles" or a character name). Whatever role the
  // destination held is dropped from it and so reappears in the rail.
  const assignRole = (roleName, destId) => {

    setCharacterValues((prevChars) => {
      const sourceId =
        Object.keys(prevChars).find(
          (c) => prevChars[c] && prevChars[c].Role === roleName
        ) || RAIL_ID;

      if (sourceId === destId) return prevChars; // dropped where it started

      const movedRole =
        (sourceId !== RAIL_ID ? prevChars[sourceId] : null) ||
        roles.find((r) => r.Role === roleName);

      const next = { ...prevChars };

      if (sourceId !== RAIL_ID) next[sourceId] = "";

      if (destId !== RAIL_ID) {
        next[destId] = movedRole ? { ...movedRole } : "";
      }

      return next;
    });
  };

  const toggleSelected = (roleName) =>
    setSelectedRole((cur) => (cur === roleName ? null : roleName));

  const pressCharacter = (charName) => {
    if (selectedRole) {
      assignRole(selectedRole, charName);
      setSelectedRole(null);
    } else if (characterValues[charName]?.Role) {
      setSelectedRole(characterValues[charName].Role);
    }
  };

  const pressRail = () => {
    if (!selectedRole) return;
    assignRole(selectedRole, RAIL_ID);
    setSelectedRole(null);
  };

  // Closing the missing-Parent error
  const dismissModal = () => {
    setModalOpen(false);
    if (!needsParent) return;
    requestAnimationFrame(() => {
      document
        .querySelector(".RoleTile.needs-assignment")
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
      setModalMessage("One character must be read by the Parent. Tap the Parent role, then tap a character, before continuing.");
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

        <div className="tw-flex tw-flex-col page-shell">
          <div className="tw-grid tw-grid-cols-[auto_1fr_auto] tw-p-4 tw-bg-[#f8f9fa]">
            <button className="btn btn-primary tw-self-center tw-h-[calc((100%_+_2rem)*0.6)] tw-flex tw-items-center tw-justify-center" onClick={() => navigate("/Home")}>
              <KeyboardDoubleArrowLeftIcon fontSize="large" />
            </button>
            <div className="tw-text-center">
              <h1>Select a Role</h1>
              <p>Tap a role, then tap a character to assign it.</p>
            </div>
            <button
              className="btn btn-primary tw-self-center tw-h-[calc((100%_+_2rem)*0.6)] tw-flex tw-items-center tw-justify-center"
              onClick={() => {
                navigateToStory();
              }}
            >
              <KeyboardDoubleArrowRightIcon fontSize="large" />
            </button>
          </div>

          <div className="flex-body">
            <RolesRail
              isTarget={Boolean(selectedRole) && assignedRoleNames.has(selectedRole)}
              onPress={pressRail}
            >
              {deckRoles.map((r) => (
                <RoleTile
                  key={r.Role}
                  role={r}
                  name={userName}
                  needsAssignment={needsParent && r.Role === "Parent"}
                  selected={selectedRole === r.Role}
                  onSelect={toggleSelected}
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
                    isTarget={Boolean(selectedRole)}
                    isSelected={selectedRole != null && characterValues[char.Name]?.Role === selectedRole}
                    onPress={pressCharacter}
                  />
                ))}
              </div>
            </main>
          </div>
        </div>
    </div>
  );
}
