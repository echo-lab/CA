import React from "react";

// Sits to the right of the listening pulse and is the only control that submits
// the answer. Blinks yellow once the room has been quiet for a moment, as a nudge
// that the answer looks finished — see `blink` in Story.js.
export default function SendButton({ blink, disabled, onClick }) {
  return (
    <button
      type="button"
      className={`send-button${blink ? " is-blinking" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label="Send my answer"
    >
      <svg
        className="send-button-plane"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        {/* Paper plane: body, then the folded near-wing as a darker crease. */}
        <path
          d="M2.2 11.3 20.6 3.2c.7-.3 1.4.4 1.1 1.1l-8.1 18.4c-.3.7-1.3.6-1.5-.1l-2.1-6.6a1 1 0 0 0-.6-.6l-6.6-2.1c-.7-.2-.8-1.2-.1-1.5Z"
          fill="currentColor"
        />
        <path
          d="M9.4 15.9 21.5 3.8c.4.4.5 1 .2 1.5l-8.1 18.4c-.3.7-1.3.6-1.5-.1l-2.1-6.6a1 1 0 0 0-.6-.6Z"
          fill="rgba(0, 0, 0, 0.18)"
        />
      </svg>
    </button>
  );
}
