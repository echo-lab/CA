const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Disk cache for /analyze-image and /tag-image responses.
// Keyed by a sha256 of (kind, book, page, model, pageText, question, version),
// so any change to dialogue text or the prompt version busts the entry.
const CFG = {
  dir: path.join(__dirname, '..', '..', 'cache', 'image'),
  ttlSec: 30 * 24 * 60 * 60, // 30 days
  bypassHeader: 'x-bypass-cache',
  // Bump this whenever the server-side prompt or post-processing changes,
  // so older entries are treated as misses.
  version: '1',
};

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDirSync(CFG.dir);

function normalizeText(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function buildKey(fields) {
  const enriched = { v: CFG.version, ...fields };
  for (const k of ['pageText', 'question']) {
    if (enriched[k] != null) enriched[k] = normalizeText(enriched[k]);
  }
  const serialized = JSON.stringify(enriched, Object.keys(enriched).sort());
  const hex = crypto.createHash('sha256').update(serialized).digest('hex');
  const shard = path.join(hex.slice(0, 2), hex.slice(2, 4));
  const base = path.join(CFG.dir, shard, hex);
  return { key: hex, base };
}

function fileFor(base) {
  return base + '.json';
}

async function readIfFresh(base) {
  try {
    const raw = JSON.parse(await fsp.readFile(fileFor(base), 'utf8'));
    const ageSec = (Date.now() - (raw.createdAt || 0)) / 1000;
    if (ageSec > CFG.ttlSec) return { state: 'STALE' };
    return { state: 'HIT', data: raw.data };
  } catch {
    return { state: 'MISS' };
  }
}

async function write(base, data) {
  const file = fileFor(base);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify({ createdAt: Date.now(), data }, null, 2);
  try {
    await fsp.writeFile(tmp, payload);
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

module.exports = { CFG, buildKey, readIfFresh, write };
