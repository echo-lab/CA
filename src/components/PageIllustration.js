import React from "react";
import { assessClick } from "../utils/clickGeometry";

// Cursor as an inline data URI (hotspot on the fingertip), with `pointer` as the fallback.
const POINT_HAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32">
<path d="M10.5 2C9.1 2 8 3.1 8 4.5V17.2L6.4 15.4C5.4 14.3 3.7 14.3 2.7 15.4C1.8 16.4 1.8 17.9 2.7 18.9L9.5 27C10.6 28.3 12.2 29 13.9 29H21C24.3 29 27 26.3 27 23V15C27 13.6 25.9 12.5 24.5 12.5C23.9 12.5 23.4 12.7 23 13C22.8 11.8 21.8 11 20.5 11C19.7 11 19 11.4 18.5 11.9C18.2 10.8 17.2 10 16 10C15.4 10 14.9 10.2 14.5 10.5V4.5C14.5 3.1 13.4 2 12 2Z" fill="#ffffff" stroke="#000000" stroke-width="2.6" stroke-linejoin="round"/>
</svg>`;
const POINT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(POINT_HAND_SVG)}") 8 2, pointer`;

// The page picture with its tagged regions. While a click question is pending,
// a click on the picture is scored and handed to onAnswerClick.
export default function PageIllustration({ img, imageTags, clickTarget, clickAnswersQuestion, onAnswerClick, onTagClick }) {
  // Correct only if the click (as % of the rendered image) hits the tag's stored box; the model's text isn't consulted.
  const handleImageAnswerClick = (e) => {
    if (!clickAnswersQuestion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // Near enough counts. imageTags is passed so the margin cannot credit a click
    // that actually landed on a different tagged object.
    const { correct, distance, reason, hitLabel } = assessClick({
      box: clickTarget.box_2d,
      tags: imageTags,
      xPct,
      yPct,
    });
    onAnswerClick({ correct, distance, reason, hitLabel, xPct, yPct });
  };

  return (
    <div
      className="page-illustration"
      style={{
        position: 'relative', display: 'inline-block',
        cursor: clickAnswersQuestion ? POINT_CURSOR : 'default',
      }}
      onClick={clickAnswersQuestion ? handleImageAnswerClick : undefined}
    >
      <img src={img} alt="current page" />
        {(imageTags || []).map((tag, i) => {
          if (!Array.isArray(tag?.box_2d) || tag.box_2d.length < 4) return null;
          const [y0, x0, y1, x1] = tag.box_2d;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: `${y0 / 10}%`, left: `${x0 / 10}%`,
                height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%`,
                cursor: POINT_CURSOR,
              }}
              title={tag.label}
              onClick={() => onTagClick(tag.label)}
            />
          );
        })}
    </div>
  );
}
