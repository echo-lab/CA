#!/usr/bin/env node
/*
 * Latency benchmark for question generation + TTS.
 *
 * Usage:
 *   node scripts/bench.js                  # run all benchmarks once
 *   node scripts/bench.js --runs 5         # repeat 5x and show min/median/max
 *   node scripts/bench.js --tts-only       # skip categorize/question generation
 *   node scripts/bench.js --qg-only        # skip TTS
 *   BASE=http://localhost:5005 node scripts/bench.js
 *
 * Make sure the server is running first (npm run dev or npm run server).
 */

const BASE = process.env.BASE || process.env.REACT_APP_API_BASE || 'http://localhost:5001';

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 1;
const ttsOnly = args.includes('--tts-only');
const qgOnly = args.includes('--qg-only');

const SAMPLE_QUESTION = "What pattern do you see on the curtains in this picture?";

async function timeFetch(label, url, init) {
  const t0 = performance.now();
  let tFirstByte = null;
  let bytes = 0;
  try {
    const res = await fetch(url, init);
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
      tFirstByte = performance.now() - t0;
    } else {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (tFirstByte === null) tFirstByte = performance.now() - t0;
        bytes += value.byteLength;
      }
    }
    const tTotal = performance.now() - t0;
    return { label, ok: res.ok, status: res.status, tFirstByte, tTotal, bytes };
  } catch (err) {
    return { label, ok: false, error: err.message, tTotal: performance.now() - t0 };
  }
}

function fmt(ms) {
  if (ms == null) return '   —  ';
  return `${ms.toFixed(0).padStart(5)}ms`;
}

function summarize(label, results) {
  const ok = results.filter(r => r.ok);
  if (!ok.length) {
    console.log(`  ${label.padEnd(28)} ALL FAILED  ${results[0]?.error || results[0]?.status || ''}`);
    return;
  }
  const ttfbs = ok.map(r => r.tFirstByte).sort((a, b) => a - b);
  const totals = ok.map(r => r.tTotal).sort((a, b) => a - b);
  const med = arr => arr[Math.floor(arr.length / 2)];
  const bytes = ok[ok.length - 1]?.bytes || 0;
  console.log(
    `  ${label.padEnd(28)} ` +
    `TTFB ${fmt(ttfbs[0])}/${fmt(med(ttfbs))}/${fmt(ttfbs[ttfbs.length - 1])}  ` +
    `total ${fmt(totals[0])}/${fmt(med(totals))}/${fmt(totals[totals.length - 1])}  ` +
    `${(bytes / 1024).toFixed(1).padStart(7)} KB`
  );
}

async function benchSynthesize() {
  return timeFetch('cloud-tts /synthesize (MP3)', `${BASE}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: SAMPLE_QUESTION,
      voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
    }),
  });
}

async function benchLiveSay() {
  return timeFetch('gemini /live/say (WAV)', `${BASE}/live/say`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bypass-cache': '1' },
    body: JSON.stringify({
      text: SAMPLE_QUESTION + ' ' + Math.random().toString(36).slice(2, 8),
      voiceName: 'kore',
      emotion: 'neutral',
    }),
  });
}

async function benchCategorize() {
  const body = {
    formattedUtterances: 'Parent: Look at the curtains.\nChild: They have stripes!',
    currentPageQuestion: 'What is the pattern on the curtains?',
    bookText: 'Clara walks into the room. The curtains have red and blue stripes.',
    currentPageNumber: 5,
    imageDescription: 'A child looking at striped curtains in a bedroom.',
    userAttention: 'on-book',
  };
  return timeFetch('categorize-utterances-stream', `${BASE}/api/categorize-utterances-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  console.log(`\nBenchmarking against ${BASE}  (runs=${runs})\n`);
  console.log('  ' + 'endpoint'.padEnd(28) + ' ' + 'TTFB min/med/max'.padEnd(28) + '  ' + 'total min/med/max'.padEnd(28) + '  payload');
  console.log('  ' + '-'.repeat(28) + ' ' + '-'.repeat(28) + '  ' + '-'.repeat(28) + '  ' + '-'.repeat(8));

  const tasks = [];
  if (!qgOnly) {
    tasks.push(['cloud-tts /synthesize (MP3)', benchSynthesize]);
    tasks.push(['gemini /live/say (WAV)', benchLiveSay]);
  }
  if (!ttsOnly) {
    tasks.push(['categorize-utterances-stream', benchCategorize]);
  }

  for (const [label, fn] of tasks) {
    const results = [];
    for (let i = 0; i < runs; i++) {
      results.push(await fn());
    }
    summarize(label, results);
  }
  console.log('');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
