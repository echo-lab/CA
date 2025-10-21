const fsp = require('fs').promises;
const path = require('path');
const { CFG } = require('./ttsCache');

async function folderWalk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (p.endsWith('.wav') || p.endsWith('.json')) out.push(p);
    }
  }
  return out;
}

async function prune() {
  try {
    const files = await folderWalk(CFG.dir);
    const stats = await Promise.all(files.map(async p => {
      const s = await fsp.stat(p);
      return { p, size: s.size, mtimeMs: s.mtimeMs };
    }));

    const wavs = stats.filter(s => s.p.endsWith('.wav'));
    const total = wavs.reduce((a, s) => a + s.size, 0);
    if (total <= CFG.maxBytes) return;

    wavs.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let toFree = total - CFG.maxBytes;

    for (const w of wavs) {
      if (toFree <= 0) break;
      const meta = w.p.replace(/\.wav$/, '.json');
      await fsp.unlink(w.p).catch(()=>{});
      await fsp.unlink(meta).catch(()=>{});
      toFree -= w.size;
    }
  } catch (e) {
    console.warn('[tts cache] prune failed', e);
  }
}

function startPruner() {
  const intervalMs = 5 * 60 * 1000; // 5 minutes
  setInterval(prune, intervalMs).unref();
}

module.exports = { startPruner, prune };