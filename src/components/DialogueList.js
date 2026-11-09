import React, { useRef } from "react";
import TouchAppIcon from '@mui/icons-material/TouchApp';
import ReactScrollableFeed from 'react-scrollable-feed';

function parseText(text) {
  const htmlText = text
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');

  return <div dangerouslySetInnerHTML={{__html: htmlText}}></div>;
}

// The current page's dialogue rows: role + character portraits, the active-line
// highlight, tap-to-hear on the child's line, and speak-on-select.
export default function DialogueList({
  lines,
  selectedOptions,
  characters,
  childHasPlayed,
  onChildPlayed,
  speak,
  dialogueRefs,
  tableContainerRef,
}) {
  // A ref, so the repeat guard survives the re-renders between two selections.
  const lastSpokenRef = useRef({ text: "", time: 0 });

  const handleTextSelection = () => {
    setTimeout(() => {
      let text = window.getSelection().toString().trim();
      text = text.replace(/(?<=\s|^)[.,!?;:"'""''\-—]?(?=\s|$)/g, '').trim();

      const now = Date.now();
      const last = lastSpokenRef.current;
      if (
        text.length > 0 &&
        (text !== last.text || now - last.time > 1000)
      ) {
        speak(text);
        lastSpokenRef.current = { text, time: now };
      }
    }, 100);
  };

  return (
    <ReactScrollableFeed>
    <div className="table-column" ref={tableContainerRef}>
      {lines?.map((val, key) => {
        let isActiveRowParent = false;
        let isActiveRowChild = false;
        const isActiveRow = val.Reading;
        const currentRole = selectedOptions.find(
          (option) => option.Character === val.Character
        );

        if(currentRole.role === "Parent"){
          isActiveRowParent = true;
        }

        if(currentRole.role === "Child"){
          isActiveRowChild = true;
        }

        const roleImage = currentRole ? currentRole.img : "";
        const roleName = currentRole ? currentRole.Role : "Role image"; // default alt text
        const character = characters.find(c => c.Name === val.Character);
        const characterImage = character ? character.img : "";
        const isChild = currentRole?.role === "Child";

        return (
          <div
            ref={(el) => dialogueRefs.current[key] = el}
            className={`dialogue-row${isActiveRowParent && isActiveRow ? " active active-parent" : ""}${isActiveRowChild && isActiveRow ? " active active-child" : ""}`}
            key={key}
            onClick={() => {
              const selectedText = window.getSelection().toString().trim();
              if (isChild && val.Reading && selectedText === "") {
                const currentRole = selectedOptions.find(
                  (option) => option.Character === val.Character
                );
                const voiceName = currentRole?.VA || "kore";
                const role = currentRole?.role || null;
                speak(val.Dialogue, voiceName, "neutral", role)
                  .then((started) => {
                    if (started) onChildPlayed();
                  });
              }
            }}
          >
            {/* Animated hand pointer for child lines */}
            {isChild && isActiveRow && !childHasPlayed && (
              <TouchAppIcon
                className="child-tap-icon"
                sx={{ fontSize: 48 }}
              />
            )}

            <div className="tw-flex-none tw-w-1/4">
            <div className="role-image-container-text tw-flex tw-justify-around">
            {currentRole && roleImage && <img src={roleImage} alt={roleName} style={{width: "25%"}}  className="overlay-image"/>}

              {characterImage && <img src={characterImage} alt={val.Character} style={{width: "55%"}} className={`${isActiveRow ? "active-roleImage" : ""}`} />}
            </div>
            </div>
            <div className="tw-flex-none tw-w-2/3">
              <div className={`tw-p-4 borderless text-size  ${isActiveRow ? "active-dialogue" : ""} `} onMouseUp={handleTextSelection}>
                {val.Dialogue.split('\n').map((str, index, array) =>  index === array.length - 1 ?  parseText(str) :
                <>
                  {parseText(str)}
                   <br />
                </>
            )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
    </ReactScrollableFeed>
  );
}
