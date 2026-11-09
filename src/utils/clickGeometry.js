// Click-answer geometry: boxes are 0-1000 [y_min, x_min, y_max, x_max]; clicks arrive as percentages (x10 to compare).

// ponytail: fixed tolerance (50 = 5% of the image) for near-miss clicks; calibration knob, raise if children miss by a hair, lower if too generous.
export const CLICK_TOLERANCE = 50;

export function isClickInsideBox(box, xPct, yPct) {
  if (!Array.isArray(box) || box.length < 4) return false;
  const [y0, x0, y1, x1] = box.map(Number);
  const x = Number(xPct) * 10;
  const y = Number(yPct) * 10;
  if (![y0, x0, y1, x1, x, y].every(Number.isFinite)) return false;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// Shortest distance from the click to the box, 0 when inside. Straight-line, so a
// diagonal near-miss at a corner is not treated as closer than it really is.
export function distanceToBox(box, xPct, yPct) {
  if (!Array.isArray(box) || box.length < 4) return Infinity;
  const [y0, x0, y1, x1] = box.map(Number);
  const x = Number(xPct) * 10;
  const y = Number(yPct) * 10;
  if (![y0, x0, y1, x1, x, y].every(Number.isFinite)) return Infinity;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

// Bounding rectangle of the accepted click region, clamped to the image (the true region has rounded corners of radius `tolerance`).
export function expandBox(box, tolerance = CLICK_TOLERANCE) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [y0, x0, y1, x1] = box.map(Number);
  if (![y0, x0, y1, x1].every(Number.isFinite)) return null;
  return [
    Math.max(0, y0 - tolerance),
    Math.max(0, x0 - tolerance),
    Math.min(1000, y1 + tolerance),
    Math.min(1000, x1 + tolerance),
  ];
}

function usable(tags) {
  return (Array.isArray(tags) ? tags : []).filter((t) => {
    const b = t?.box_2d;
    if (!Array.isArray(b) || b.length < 4) return false;
    const [y0, x0, y1, x1] = b.map(Number);
    return [y0, x0, y1, x1].every(Number.isFinite) && y1 > y0 && x1 > x0;
  });
}

function sameBox(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return [0, 1, 2, 3].every((i) => Number(a[i]) === Number(b[i]));
}

// A click inside some other tagged object is a deliberate wrong answer; only clicks that hit nothing get the tolerance.
export function assessClick({ box, tags = [], xPct, yPct, tolerance = CLICK_TOLERANCE }) {
  const distance = distanceToBox(box, xPct, yPct);
  if (!Number.isFinite(distance)) {
    return { correct: false, distance: null, reason: 'no_box', hitLabel: null };
  }
  if (distance === 0) {
    return { correct: true, distance, reason: 'inside', hitLabel: null };
  }

  // Smallest box wins when several overlap — the innermost is what was aimed at.
  const area = (t) => (t.box_2d[2] - t.box_2d[0]) * (t.box_2d[3] - t.box_2d[1]);
  const other = usable(tags)
    .filter((t) => !sameBox(t.box_2d, box))
    .filter((t) => isClickInsideBox(t.box_2d, xPct, yPct))
    .sort((a, b) => area(a) - area(b))[0];
  if (other) {
    return { correct: false, distance, reason: 'other_object', hitLabel: String(other.label || '').trim() };
  }

  return distance <= tolerance
    ? { correct: true, distance, reason: 'near', hitLabel: null }
    : { correct: false, distance, reason: 'far', hitLabel: null };
}
