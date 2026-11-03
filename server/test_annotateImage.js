// The geometry is checked as plain arithmetic; the render tests need ImageMagick and
// confirm the ring lands on the tapped pixels of a real page.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidTap, fittedSize, cropWindow, renderRingedPage, renderTapCrop } = require('./lib/annotateImage');

let pass = 0, fail = 0;
const t = async (name, fn) => {
    try { await fn(); pass++; }
    catch (err) { fail++; console.error(`FAIL: ${name}\n  ${err.message}`); }
};

const PAGE = { width: 3300, height: 2550 };
const LLM_IMAGE = path.join(__dirname, '..', 'src', 'Pictures', 'book1', 'llm', 'Page_1.jpg');
const FULL_IMAGE = path.join(__dirname, '..', 'src', 'Pictures', 'book1', 'Page_1.jpg');

// Fraction of magenta pixels in a data URL's image, optionally limited to a region.
function magentaFraction(dataUrl, geometry) {
    const input = Buffer.from(dataUrl.split(',')[1], 'base64');
    const args = ['jpeg:-'];
    if (geometry) args.push('-crop', geometry, '+repage');
    args.push('-fuzz', '30%', '-fill', 'white', '-opaque', '#FF00FF', '-fill', 'black', '+opaque', 'white', '-format', '%[fx:mean]', 'info:');
    return Number(execFileSync('magick', args, { input, encoding: 'utf8' }));
}

(async () => {
    await t('out-of-range and non-numeric taps are rejected', () => {
        assert.ok(isValidTap({ x: 0, y: 1000 }));
        for (const bad of [null, {}, { x: -1, y: 5 }, { x: 5, y: 1001 }, { x: '5', y: 5 }, { x: NaN, y: 5 }]) {
            assert.ok(!isValidTap(bad), JSON.stringify(bad));
        }
    });

    await t('fitting keeps the aspect ratio and never enlarges', () => {
        const { width, height } = fittedSize(PAGE, 768);
        assert.strictEqual(width, 768);
        assert.strictEqual(height, 593);
        assert.strictEqual(fittedSize({ width: 300, height: 200 }, 768).width, 300);
    });

    await t('the crop stays centred on the tap away from the edges', () => {
        const { x, y, size } = cropWindow(PAGE, { x: 500, y: 500 });
        assert.strictEqual(size, 924);
        assert.strictEqual(x, 1650 - 462);
        assert.strictEqual(y, 1275 - 462);
    });

    await t('a crop at a corner shifts inward, keeps its size, and contains the tap', () => {
        for (const tap of [{ x: 0, y: 0 }, { x: 1000, y: 1000 }]) {
            const { x, y, size } = cropWindow(PAGE, tap);
            assert.strictEqual(size, 924);
            assert.ok(x >= 0 && x + size <= PAGE.width);
            assert.ok(y >= 0 && y + size <= PAGE.height);
            const tapX = (tap.x / 1000) * PAGE.width;
            const tapY = (tap.y / 1000) * PAGE.height;
            assert.ok(tapX >= x && tapX <= x + size && tapY >= y && tapY <= y + size);
        }
    });

    await t('the page render has the requested size and the ring around the tap', async () => {
        const out = await renderRingedPage({ imagePath: LLM_IMAGE, tap: { x: 500, y: 500 }, edge: 512 });
        assert.strictEqual(out.width, 512);
        assert.ok(out.bytes > 0);
        // Ring diameter is 72px at this size, centred at (256, 198). Its rim is magenta,
        // and a same-sized patch in a far corner should have no ring in it.
        const rim = magentaFraction(out.dataUrl, '20x20+282+188');
        const corner = magentaFraction(out.dataUrl, '20x20+10+10');
        assert.ok(rim > 0.05, `rim ${rim}`);
        assert.ok(rim > corner, `rim ${rim} corner ${corner}`);
    });

    await t('the crop render is square and the ring is on the tap', async () => {
        const out = await renderTapCrop({ imagePath: FULL_IMAGE, tap: { x: 500, y: 500 }, edge: 384 });
        assert.strictEqual(out.width, 384);
        // Ring diameter is half the crop, so its rim crosses x=288 at mid-height.
        const rim = magentaFraction(out.dataUrl, '20x20+278+182');
        const corner = magentaFraction(out.dataUrl, '20x20+5+5');
        assert.ok(rim > 0.05, `rim ${rim}`);
        assert.ok(rim > corner, `rim ${rim} corner ${corner}`);
    });

    await t('a shell metacharacter in a path is not executed', async () => {
        await assert.rejects(renderRingedPage({ imagePath: 'nope.jpg & echo hacked', tap: { x: 1, y: 1 }, edge: 100 }));
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
