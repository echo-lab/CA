// Draws the child's tap onto reduced copies of a page, for the model only. The child
// sees a separate yellow CSS ring; nothing here touches the displayed image.
//
// Tap coordinates use the app's normalized 0-1000 scale.
const { execFile } = require('child_process');

// Magenta because nothing in these pastel illustrations is this colour, so the model
// cannot mistake the mark for part of the art.
const RING_COLOR = '#FF00FF';
// Ring diameter and crop width, as fractions of the page width.
const RING_SPAN = 0.14;
const CROP_SPAN = 0.28;
const MAGICK_TIMEOUT_MS = 5000;

function runMagick(args, encoding = 'buffer') {
    return new Promise((resolve, reject) => {
        // execFile, never a shell: book and page values end up in these paths.
        execFile('magick', args, { encoding, maxBuffer: 32 * 1024 * 1024, timeout: MAGICK_TIMEOUT_MS }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

const sizeCache = new Map(); // path -> Promise<{ width, height }>
function imageSize(imagePath) {
    if (!sizeCache.has(imagePath)) {
        const pending = runMagick(['identify', '-format', '%w %h', `${imagePath}[0]`], 'utf8').then((out) => {
            const [width, height] = out.trim().split(/\s+/).map(Number);
            if (!(width > 0 && height > 0)) throw new Error(`Could not read image size: ${imagePath}`);
            return { width, height };
        });
        // A failed read must not stay cached and break every later tap on this page.
        pending.catch(() => sizeCache.delete(imagePath));
        sizeCache.set(imagePath, pending);
    }
    return sizeCache.get(imagePath);
}

function isValidTap(tap) {
    return Number.isFinite(tap?.x) && Number.isFinite(tap?.y)
        && tap.x >= 0 && tap.x <= 1000 && tap.y >= 0 && tap.y <= 1000;
}

// Scales to fit `edge` on the long side, never enlarging.
function fittedSize({ width, height }, edge) {
    const scale = Math.min(1, edge / Math.max(width, height));
    return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

// The square crop around a tap, in source pixels. Shifted inward at the page edges so
// it keeps its size and still contains the tap.
function cropWindow({ width, height }, tap, span = CROP_SPAN) {
    const size = Math.min(Math.round(width * span), width, height);
    const clamp = (value, max) => Math.max(0, Math.min(Math.round(value), max));
    const x = clamp((tap.x / 1000) * width - size / 2, width - size);
    const y = clamp((tap.y / 1000) * height - size / 2, height - size);
    return { x, y, size };
}

function circleArgs(cx, cy, radius, outputWidth) {
    return [
        '-fill', 'none',
        '-stroke', RING_COLOR,
        '-strokewidth', String(Math.max(2, Math.round(outputWidth / 170))),
        '-draw', `circle ${cx.toFixed(1)},${cy.toFixed(1)} ${(cx + radius).toFixed(1)},${cy.toFixed(1)}`,
    ];
}

function toDataUrl(buffer) {
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// The whole page, reduced, with the tap ringed.
async function renderRingedPage({ imagePath, tap, edge, quality = 75 }) {
    if (!isValidTap(tap)) throw new Error('Invalid tap');
    const source = await imageSize(imagePath);
    const { width, height } = fittedSize(source, edge);
    const buffer = await runMagick([
        imagePath,
        '-resize', `${width}x${height}!`,
        ...circleArgs((tap.x / 1000) * width, (tap.y / 1000) * height, (RING_SPAN * width) / 2, width),
        '-strip', '-quality', String(quality), 'jpeg:-',
    ]);
    return { dataUrl: toDataUrl(buffer), bytes: buffer.length, width, height };
}

// A close-up of the tap, ringed the same way. Pass the full-resolution original: this
// is where small props get the detail the reduced page gives up.
async function renderTapCrop({ imagePath, tap, edge, quality = 75 }) {
    if (!isValidTap(tap)) throw new Error('Invalid tap');
    const source = await imageSize(imagePath);
    const { x, y, size } = cropWindow(source, tap);
    const scale = edge / size;
    const buffer = await runMagick([
        imagePath,
        '-crop', `${size}x${size}+${x}+${y}`, '+repage',
        '-resize', `${edge}x${edge}!`,
        ...circleArgs(
            ((tap.x / 1000) * source.width - x) * scale,
            ((tap.y / 1000) * source.height - y) * scale,
            (RING_SPAN * source.width * scale) / 2,
            edge,
        ),
        '-strip', '-quality', String(quality), 'jpeg:-',
    ]);
    return { dataUrl: toDataUrl(buffer), bytes: buffer.length, width: edge, height: edge };
}

module.exports = { RING_SPAN, CROP_SPAN, isValidTap, fittedSize, cropWindow, renderRingedPage, renderTapCrop };
