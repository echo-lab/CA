// Deciding whether a click answers a click question. The question's answer is a
// tagged region, so correctness is pure geometry — nothing the model wrote is
// consulted here.
//
// Boxes are normalized 0-1000 as [y_min, x_min, y_max, x_max]; clicks arrive as a
// percentage of the rendered image, so a click is multiplied by 10 to compare.

// How far outside a box a click may land and still count. Normalized units, so 50
// is 5% of the image dimension — roughly a fingertip on a tablet.
//
// ponytail: one fixed number, deliberately not scaled to box size. A fixed margin
// already helps small targets proportionally more, which is the case that needs
// help. This is the calibration knob: raise it if children keep missing by a hair,
// lower it if near misses are being credited too generously.
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

// The region a click may land in and still count, for drawing. Clamped to the
// image, since a click can never land outside it anyway.
//
// Note this is the box's *bounding* rectangle: because distanceToBox is
// straight-line, the true acceptance region has rounded corners of radius
// `tolerance`. Callers that draw it should round the corners to match.
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

// How far the referent ring is grown past the tag's box, as a fraction of each
// span. An ellipse inscribed in the tight box is SMALLER than the box — its corners
// fall outside — so a balloon that fills its box would have its edges poking out of
// the ring. Growing it puts the whole object inside the circle.
export const REFERENT_INFLATE = 0.18;

// Floor on each span, in normalized units, so a thin tag (a streamer, a table edge)
// still gets a ring a child can see rather than a hairline.
export const REFERENT_MIN_SPAN = 60;

// The ellipse drawn around the thing a pointing question is about, as percentages
// of the rendered image so the caller can hand them straight to CSS.
//
// Aspect follows the box rather than forcing a true circle: a circle sized to
// contain a 4:1 box has a radius of half its diagonal, which swallows whatever sits
// next to it — reintroducing the ambiguity the box was chosen to avoid.
//
// Clamped to the image because the page image has no `overflow: hidden`: an
// unclamped ring near an edge would bleed out of the illustration onto the layout.
export function referentEllipse(box, { inflate = REFERENT_INFLATE, minSpan = REFERENT_MIN_SPAN } = {}) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [y0, x0, y1, x1] = box.map(Number);
  if (![y0, x0, y1, x1].every(Number.isFinite)) return null;
  if (y1 <= y0 || x1 <= x0) return null;

  const grow = (lo, hi) => {
    const mid = (lo + hi) / 2;
    const span = Math.max((hi - lo) * (1 + inflate), minSpan);
    return [Math.max(0, mid - span / 2), Math.min(1000, mid + span / 2)];
  };

  const [top, bottom] = grow(y0, y1);
  const [left, right] = grow(x0, x1);
  return {
    topPct: top / 10,
    leftPct: left / 10,
    heightPct: (bottom - top) / 10,
    widthPct: (right - left) / 10,
  };
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

// Decides whether a click answers the question.
//
// Tolerance is forgiving about aim, not about intent: if the click landed squarely
// inside some OTHER tagged object, the child pointed at that thing on purpose and
// slack must not turn it into a correct answer. Only genuine near misses — clicks
// that hit nothing in particular — get the benefit of the margin.
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
