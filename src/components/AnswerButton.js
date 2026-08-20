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

// pulse5 is the mid-amplitude frame, so a quiet mic rests on a steady waveform
// rather than a flat or fully-open one.
const REST_FRAME = PULSE_FRAMES.indexOf(pulse5);

// Pure indicator: it shows that the mic is live, and no longer submits — the
// paper-plane SendButton beside it does that. It animates only while someone is
// actually talking, and holds a still frame through the quiet.
export default function AnswerButton({ isUserSpeaking }) {
  const [frame, setFrame] = useState(REST_FRAME);

  useEffect(() => {
    if (!isUserSpeaking) {
      setFrame(REST_FRAME);
      return;
    }
    const intervalId = setInterval(
      () => setFrame((f) => (f + 1) % PULSE_FRAMES.length),
      PULSE_INTERVAL_MS
    );
    return () => clearInterval(intervalId);
  }, [isUserSpeaking]);

  return (
    <div className="answer-button" role="status" aria-label="Listening">
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
    </div>
  );
}
