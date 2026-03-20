const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// DEFAULTS
const CFG = {
  dir: path.join(process.cwd(), 'cache', 'tts'),
  ttlSec: 30 * 24 * 60 * 60,        // 30 days
  maxBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
  bypassHeader: 'x-bypass-cache',
  sampleRate: 24000,
  version: '1',
};

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDirSync(CFG.dir);

function normalizeText(t) {
  return String(t)
    .replace(/(\*)+/g, '')
    .replace(/'/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normEmotion(e) {
  return (e && String(e).trim().toLowerCase()) || 'neutral';
}

function buildKey({ text, model, voiceName, emotion, format, sampleRate, speechRate, pitch, role }) {
  const fields = {
    v: CFG.version,
    textNorm: normalizeText(text),
    model: String(model || ''),
    voice: String(voiceName || '(default)'),
    emotion: normEmotion(emotion),
    fmt: String(format || 'wav'),
    sr: String(sampleRate || CFG.sampleRate),
    rate: speechRate == null ? '' : String(speechRate),
    pitch: pitch == null ? '' : String(pitch),
    role: String(role || ''),
  };
  const serialized = JSON.stringify(fields);
  const hex = crypto.createHash('sha256').update(serialized).digest('hex');
  const shard = path.join(hex.slice(0,2), hex.slice(2,4));
  const base = path.join(CFG.dir, shard, hex);
  return { key: hex, base, fields };
}

function pathsFor(base) {
  return {
    audio: base + '.wav',
    meta:  base + '.json',
    tmp:   base + `.tmp-${process.pid}-${Date.now()}`,
  };
}

async function readIfFresh(base) {
  const { audio, meta } = pathsFor(base);
  try {
    const m = JSON.parse(await fsp.readFile(meta, 'utf8'));
    const ageSec = (Date.now() - (m.createdAt || 0)) / 1000;
    if (ageSec > CFG.ttlSec) return { state: 'STALE' };
    const buf = await fsp.readFile(audio);
    return { state: 'HIT', buf, meta: m };
  } catch {
    return { state: 'MISS' };
  }
}

async function writeAtomically(base, buf, metaObj) {
  const { audio, meta } = pathsFor(base);
  const dir = path.dirname(audio);
  
  // Create unique temp file names
  const audioTmp = `${audio}.tmp-${process.pid}-${Date.now()}`;
  const metaTmp = `${meta}.tmp-${process.pid}-${Date.now()}`;
  
  try {
    // Ensure directory exists - use sync to avoid race condition
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write audio
    await fsp.writeFile(audioTmp, buf);
    await fsp.rename(audioTmp, audio);
    
    // Write metadata
    await fsp.writeFile(metaTmp, JSON.stringify(metaObj, null, 2));
    await fsp.rename(metaTmp, meta);
    
  } catch (err) {
    // Clean up temp files
    await fsp.unlink(audioTmp).catch(() => {});
    await fsp.unlink(metaTmp).catch(() => {});
    throw err;
  }
}

module.exports = {
  CFG,
  normalizeText,
  normEmotion,
  buildKey,
  readIfFresh,
  writeAtomically,
  ensureDirSync,
  pathsFor,
};
