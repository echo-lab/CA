/**
 * A click answers a click question by landing on the tagged region. Tolerance
 * forgives aim, not intent — the interesting cases are all about that line.
 */
import {
  assessClick,
  distanceToBox,
  expandBox,
  isClickInsideBox,
  referentEllipse,
  CLICK_TOLERANCE,
  REFERENT_MIN_SPAN,
} from '../clickGeometry';

// TARGET spans y 10-30%, x 20-40%. NEIGHBOUR sits just to its right at x 41-60%,
// close enough that a generous margin around TARGET would otherwise reach it.
const TARGET = [100, 200, 300, 400];
const NEIGHBOUR = { label: 'Zoe', box_2d: [100, 410, 300, 600] };
const TAGS = [{ label: 'Clara', box_2d: TARGET }, NEIGHBOUR];

describe('isClickInsideBox', () => {
  test('inside, edges, and outside', () => {
    expect(isClickInsideBox(TARGET, 30, 20)).toBe(true);
    expect(isClickInsideBox(TARGET, 20, 10)).toBe(true); // top-left corner
    expect(isClickInsideBox(TARGET, 40, 30)).toBe(true); // bottom-right corner
    expect(isClickInsideBox(TARGET, 19.9, 20)).toBe(false);
    expect(isClickInsideBox(TARGET, 30, 30.1)).toBe(false);
  });

  test('malformed input is a miss, not a match-everywhere', () => {
    expect(isClickInsideBox(null, 30, 20)).toBe(false);
    expect(isClickInsideBox([1, 2], 30, 20)).toBe(false);
    expect(isClickInsideBox(TARGET, NaN, 20)).toBe(false);
  });
});

describe('distanceToBox', () => {
  test('zero inside, grows outside', () => {
    expect(distanceToBox(TARGET, 30, 20)).toBe(0);
    expect(distanceToBox(TARGET, 41, 20)).toBe(10);
    expect(Math.round(distanceToBox(TARGET, 41, 31))).toBe(14); // diagonal past a corner
  });

  test('no box is infinitely far', () => {
    expect(distanceToBox(null, 30, 20)).toBe(Infinity);
  });
});

describe('expandBox', () => {
  test('grows by the tolerance on every side', () => {
    expect(expandBox(TARGET)).toEqual([
      100 - CLICK_TOLERANCE, 200 - CLICK_TOLERANCE,
      300 + CLICK_TOLERANCE, 400 + CLICK_TOLERANCE,
    ]);
  });

  test('clamps to the image rather than running off it', () => {
    expect(expandBox([10, 10, 990, 990])).toEqual([0, 0, 1000, 1000]);
  });

  test('the drawn edge matches where assessClick actually flips', () => {
    const [, , , gx1] = expandBox(TARGET);
    // gx1 is the right edge of the drawn region, in normalized units.
    expect(assessClick({ box: TARGET, xPct: gx1 / 10, yPct: 20 }).correct).toBe(true);
    expect(assessClick({ box: TARGET, xPct: gx1 / 10 + 0.1, yPct: 20 }).correct).toBe(false);
  });

  test('a malformed box has no region to draw', () => {
    expect(expandBox(null)).toBeNull();
    expect(expandBox([1, 2])).toBeNull();
  });
});

describe('assessClick tolerance', () => {
  test('a click inside is correct', () => {
    expect(assessClick({ box: TARGET, tags: TAGS, xPct: 30, yPct: 20 }))
      .toMatchObject({ correct: true, reason: 'inside' });
  });

  test('a click just outside still counts', () => {
    expect(assessClick({ box: TARGET, tags: TAGS, xPct: 40.5, yPct: 20 }))
      .toMatchObject({ correct: true, reason: 'near' });
  });

  test('a click far away does not', () => {
    expect(assessClick({ box: TARGET, tags: TAGS, xPct: 80, yPct: 80 }))
      .toMatchObject({ correct: false, reason: 'far' });
  });

  test('the margin applies at its exact edge, not past it', () => {
    const edge = 40 + CLICK_TOLERANCE / 10; // normalized units -> percent
    expect(assessClick({ box: TARGET, xPct: edge, yPct: 20 }).correct).toBe(true);
    expect(assessClick({ box: TARGET, xPct: edge + 0.1, yPct: 20 }).correct).toBe(false);
  });

  test('slack never credits a click that landed inside another object', () => {
    // 42% is within tolerance of TARGET, but squarely inside Zoe.
    expect(distanceToBox(TARGET, 42, 20)).toBeLessThanOrEqual(CLICK_TOLERANCE);
    expect(assessClick({ box: TARGET, tags: TAGS, xPct: 42, yPct: 20 }))
      .toMatchObject({ correct: false, reason: 'other_object', hitLabel: 'Zoe' });
  });

  test('the target is not mistaken for a competing object', () => {
    const withDuplicate = [...TAGS, { label: 'Clara again', box_2d: [...TARGET] }];
    expect(assessClick({ box: TARGET, tags: withDuplicate, xPct: 30, yPct: 20 }).correct).toBe(true);
  });

  test('a missing box is a miss, not a crash', () => {
    expect(assessClick({ box: null, tags: TAGS, xPct: 30, yPct: 20 }))
      .toMatchObject({ correct: false, reason: 'no_box' });
  });
});

describe('referentEllipse', () => {
  test('grows past the box so the object is not clipped by the ring', () => {
    const ring = referentEllipse(TARGET);
    // TARGET spans y 10-30%, x 20-40%. An ellipse inscribed in exactly that box
    // would cut the object's corners, so the ring must be strictly larger.
    expect(ring.heightPct).toBeGreaterThan(20);
    expect(ring.widthPct).toBeGreaterThan(20);
    // ...and stay centred on the thing it is circling.
    expect(ring.topPct + ring.heightPct / 2).toBeCloseTo(20, 5);
    expect(ring.leftPct + ring.widthPct / 2).toBeCloseTo(30, 5);
  });

  test('follows the box aspect rather than forcing a circle', () => {
    // A wide, short tag: a true circle containing it would swallow its neighbours.
    const ring = referentEllipse([400, 100, 460, 900]);
    expect(ring.widthPct).toBeGreaterThan(ring.heightPct * 3);
  });

  test('a hairline tag still gets a ring a child can see', () => {
    const ring = referentEllipse([500, 100, 504, 900]);
    expect(ring.heightPct).toBeGreaterThanOrEqual(REFERENT_MIN_SPAN / 10);
  });

  test('stays inside the image, since the page image does not clip overflow', () => {
    for (const box of [[0, 0, 80, 80], [920, 920, 1000, 1000], [0, 400, 1000, 600]]) {
      const ring = referentEllipse(box);
      expect(ring.topPct).toBeGreaterThanOrEqual(0);
      expect(ring.leftPct).toBeGreaterThanOrEqual(0);
      expect(ring.topPct + ring.heightPct).toBeLessThanOrEqual(100);
      expect(ring.leftPct + ring.widthPct).toBeLessThanOrEqual(100);
    }
  });

  test('a degenerate or missing box draws nothing rather than a broken ring', () => {
    // The tag list reaching the renderer is not filtered the way the server filters
    // answers, so these have to be survivable here.
    expect(referentEllipse(null)).toBeNull();
    expect(referentEllipse([1, 2])).toBeNull();
    expect(referentEllipse([400, 400, 100, 100])).toBeNull(); // corners swapped
    expect(referentEllipse([10, 10, 10, 400])).toBeNull();    // zero height
    expect(referentEllipse(['a', 'b', 'c', 'd'])).toBeNull();
  });
});
