const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const CFG = {
  dir: path.join(__dirname, '..', '..', 'cache', 'image'),
  ttlSec: 30 * 24 * 60 * 60,
  bypassHeader: 'x-bypass-cache',
  version: '3.2',  // bumped to force a re-tag with the descriptive label prompt
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

// Cache files are hash-named, so meta records which book and page the file
// describes. Reference only — readIfFresh ignores it, and it is not part of the key.
async function write(base, data, meta) {
  const file = fileFor(base);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify({ createdAt: Date.now(), ...meta, data }, null, 2);
  try {
    await fsp.writeFile(tmp, payload);
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

module.exports = { CFG, buildKey, readIfFresh, write };
