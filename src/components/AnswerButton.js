import React, { useEffect, useState } from "react";
import micIcon from "../Pictures/buttons/mic-glyph.svg";
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

export default function AnswerButton({ isAnswering, disabled, onClick }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isAnswering) {
      setFrame(0);
      return;
    }
    const intervalId = setInterval(
      () => setFrame((f) => (f + 1) % PULSE_FRAMES.length),
      PULSE_INTERVAL_MS
    );
    return () => clearInterval(intervalId);
  }, [isAnswering]);

  return (
    <button
      type="button"
      className="answer-button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isAnswering ? "Done answering" : "Start answering"}
      aria-pressed={isAnswering}
    >
      <span className="answer-button-frames">
        <img src={micIcon} alt="" className={isAnswering ? "" : "is-visible"} />
        {PULSE_FRAMES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className={isAnswering && i === frame ? "is-visible" : ""}
          />
        ))}
      </span>
    </button>
  );
}
