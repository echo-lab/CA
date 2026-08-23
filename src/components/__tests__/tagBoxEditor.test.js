import { applyDrag } from '../TagBoxEditor';

const BOX = [100, 410, 300, 600];  // [y0, x0, y1, x1]

describe('applyDrag', () => {
  it('move keeps the size and shifts both edges of each axis', () => {
    expect(applyDrag(BOX, 'move', 50, -10)).toEqual([150, 400, 350, 590]);
  });

  it('move clamps at the frame instead of pushing the box out', () => {
    expect(applyDrag(BOX, 'move', 900, 0)).toEqual([800, 410, 1000, 600]);
    expect(applyDrag(BOX, 'move', -500, -500)).toEqual([0, 0, 200, 190]);
  });

  it('resize drags the bottom-right corner only', () => {
    expect(applyDrag(BOX, 'resize', -50, -100)).toEqual([100, 410, 250, 500]);
  });

  it('resize never inverts the box', () => {
    const [y0, x0, y1, x1] = applyDrag(BOX, 'resize', -999, -999);
    expect(y1).toBeGreaterThan(y0);
    expect(x1).toBeGreaterThan(x0);
  });

  it('rounds to integers, as the cache schema expects', () => {
    expect(applyDrag(BOX, 'move', 0.4, 0.6).every(Number.isInteger)).toBe(true);
  });
});
