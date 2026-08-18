import React, { useEffect, useState } from "react";
import pulse1 from "../Pictures/buttons/pulse1-glyph.svg";
import pulse2 from "../Pictures/buttons/pulse2-glyph.svg";
import pulse3 from "../Pictures/buttons/pulse3-glyph.svg";
import pulse4 from "../Pictures/buttons/pulse4-glyph.svg";
import pulse5 from "../Pictures/buttons/pulse5-glyph.svg";
import pulse6 from "../Pictures/buttons/pulse6-glyph.svg";
import pulse7 from "../Pictures/buttons/pulse7-glyph.svg";
import pulse8 from "../Pictures/buttons/pulse8-glyph.svg";

const PULSE_FRAMES = [pulse1, pulse2, pulse3, pulse4, pulse5, pulse6, pulse7, pulse8];

const PULSE_INTERVAL_MS = 100;

// The button only appears while a question is waiting to be answered, and the mic
// is live that whole time — so it always pulses. There is no idle state to show.
export default function AnswerButton({ disabled, onClick }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(
      () => setFrame((f) => (f + 1) % PULSE_FRAMES.length),
      PULSE_INTERVAL_MS
    );
    return () => clearInterval(intervalId);
  }, []);

  return (
    <button
      type="button"
      className="answer-button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Send my answer"
    >
      <span className="answer-button-frames">
        {PULSE_FRAMES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className={i === frame ? "is-visible" : ""}
          />
        ))}
      </span>
    </button>
  );
}
