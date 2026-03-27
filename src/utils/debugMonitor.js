const CHANNEL_NAME = 'utterance-debug';
const GPT_CHANNEL_NAME = 'gpt-debug';
const IMAGE_CHANNEL_NAME = 'image-debug';

let channel = null;
let gptChannel = null;
let imageChannel = null;

function getChannel() {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

function getGptChannel() {
  if (!gptChannel) {
    gptChannel = new BroadcastChannel(GPT_CHANNEL_NAME);
  }
  return gptChannel;
}

export function debugLog(event) {
  try {
    getChannel().postMessage({ ...event, timestamp: Date.now() });
  } catch (e) {
    // silently ignore if BroadcastChannel is unavailable
  }
}

export function gptDebugLog(event) {
  try {
    getGptChannel().postMessage({ ...event, timestamp: Date.now() });
  } catch (e) {
    // silently ignore if BroadcastChannel is unavailable
  }
}

function openGptDebugMonitor() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GPT-4o Debug Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4; }
    #header {
      position: sticky; top: 0; background: #252526; padding: 10px 14px;
      border-bottom: 1px solid #3c3c3c; z-index: 10;
    }
    #header h3 { color: #c586c0; margin-bottom: 6px; font-size: 13px; }
    #log {
      padding: 8px 14px; display: flex; flex-direction: column; gap: 6px;
    }
    .entry {
      padding: 8px 10px; border-radius: 3px; line-height: 1.6;
      border-left: 3px solid transparent;
    }
    .entry .time { color: #888; margin-right: 8px; }
    .request { border-left-color: #569cd6; background: rgba(86, 156, 214, 0.08); }
    .request .endpoint { color: #569cd6; font-weight: bold; }
    .response { border-left-color: #4caf50; background: rgba(76, 175, 80, 0.08); }
    .response .endpoint { color: #4caf50; font-weight: bold; }
    .error { border-left-color: #f44747; background: rgba(244, 71, 71, 0.08); color: #f44747; }
    .field { margin-top: 3px; padding-left: 12px; }
    .field-label { color: #808080; }
    .field-value { color: #ce9178; }
    .field-value.bool-true { color: #4caf50; }
    .field-value.bool-false { color: #f44747; }
    .field-value.truncated { color: #888; font-style: italic; }
    .fold-toggle { cursor: pointer; user-select: none; }
    .fold-toggle:hover { color: #569cd6; }
    .fold-toggle span { font-size: 10px; margin-left: 2px; }
    .fold-content {
      margin: 4px 0 2px 12px; padding: 8px; background: #2d2d2d; border: 1px solid #3c3c3c;
      border-radius: 3px; white-space: pre-wrap; word-break: break-word; color: #ce9178;
      max-height: 300px; overflow-y: auto; font-size: 11px;
    }
    .separator { border-top: 1px solid #333; margin: 6px 0; }
    #clear-btn {
      position: fixed; bottom: 12px; right: 12px; background: #3c3c3c; color: #d4d4d4;
      border: 1px solid #555; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 11px;
    }
    #clear-btn:hover { background: #505050; }
  </style>
</head>
<body>
  <div id="header">
    <h3>GPT-4o Debug Monitor</h3>
  </div>
  <div id="log"></div>
  <button id="clear-btn" onclick="document.getElementById('log').innerHTML=''">Clear</button>
  <script>
    const ch = new BroadcastChannel('${GPT_CHANNEL_NAME}');
    const log = document.getElementById('log');

    function fmt(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    var foldId = 0;

    function field(label, value, maxLen) {
      if (value === undefined || value === null) return '';
      if (typeof value === 'boolean') {
        return '<div class="field"><span class="field-label">' + label + ': </span><span class="field-value ' + (value ? 'bool-true' : 'bool-false') + '">' + value + '</span></div>';
      }
      var s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      if (!maxLen || s.length <= maxLen) {
        return '<div class="field"><span class="field-label">' + label + ': </span><span class="field-value">' + esc(s) + '</span></div>';
      }
      var id = 'fold-' + (foldId++);
      return '<div class="field"><span class="field-label fold-toggle" onclick="var el=document.getElementById(\\'' + id + '\\');var btn=this.querySelector(\\'span\\');if(el.style.display===\\'none\\'){el.style.display=\\'block\\';btn.textContent=\\'\\u25BC\\';}else{el.style.display=\\'none\\';btn.textContent=\\'\\u25B6\\';}">' + label + ' <span>\\u25B6</span> </span><span class="field-value truncated">' + esc(s.slice(0, maxLen)) + ' ...(' + s.length + ' chars)</span>' +
        '<pre id="' + id + '" class="fold-content" style="display:none">' + esc(s) + '</pre></div>';
    }

    function formatRequest(endpoint, payload) {
      var html = '';
      if (endpoint === '/api/categorize-utterances') {
        html += field('Utterances', payload.formattedUtterances, 300);
        html += field('Page Text', payload.bookPageText, 150);
        html += field('Question', payload.currentPageQuestion, 200);
        html += field('Page #', payload.currentPageNumber);
        html += field('Book Text', payload.bookText, 100);
        html += field('Image Analysis', payload.imageDescription, 120);
      } else {
        html += field('Payload', JSON.stringify(payload, null, 2), 500);
      }
      return html;
    }

    function formatResponse(endpoint, data) {
      var html = '';
      if (!data) return field('Result', 'null');
      if (endpoint === '/api/categorize-utterances') {
        // Show all top-level keys nicely
        for (var key in data) {
          var val = data[key];
          if (typeof val === 'object' && val !== null) {
            html += field(key, JSON.stringify(val, null, 2), 400);
          } else {
            html += field(key, val, 300);
          }
        }
      } else {
        html += field('Result', JSON.stringify(data, null, 2), 500);
      }
      return html;
    }

    function add(html, cls) {
      const div = document.createElement('div');
      div.className = 'entry ' + cls;
      div.innerHTML = html;
      log.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth' });
    }

    ch.onmessage = (e) => {
      const ev = e.data;
      const time = '<span class="time">' + fmt(ev.timestamp) + '</span>';

      if (ev.type === 'gpt_request') {
        add(time + '<span class="endpoint">REQUEST \\u2192 ' + esc(ev.endpoint) + '</span>' +
          formatRequest(ev.endpoint, ev.payload), 'request');
      }
      else if (ev.type === 'gpt_response') {
        add(time + '<span class="endpoint">RESPONSE \\u2190 ' + esc(ev.endpoint) + '</span>' +
          formatResponse(ev.endpoint, ev.data), 'response');
      }
      else if (ev.type === 'gpt_error') {
        add(time + '<span class="endpoint">ERROR ' + esc(ev.endpoint) + '</span>' +
          field('Error', ev.error, 500), 'error');
      }
    };
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, 'gpt-debug', 'width=700,height=600,scrollbars=yes');
}

// Module-level cache so the monitor can replay state when opened late
const imageState = { totalPages: 0, pages: {} };

function getImageChannel() {
  if (!imageChannel) {
    imageChannel = new BroadcastChannel(IMAGE_CHANNEL_NAME);
  }
  return imageChannel;
}

export function imageDebugLog(event) {
  // Update cached state
  if (event.type === 'book_info') {
    imageState.totalPages = event.totalPages;
    imageState.pages = {};
  } else if (event.type === 'analysis_response') {
    if (!imageState.pages[event.page]) imageState.pages[event.page] = {};
    imageState.pages[event.page].analysis = event.description;
  } else if (event.type === 'tagging_response') {
    if (!imageState.pages[event.page]) imageState.pages[event.page] = {};
    imageState.pages[event.page].tags = event.tags;
  } else if (event.type === 'analysis_error') {
    if (!imageState.pages[event.page]) imageState.pages[event.page] = {};
    imageState.pages[event.page].analysisError = event.error;
  } else if (event.type === 'tagging_error') {
    if (!imageState.pages[event.page]) imageState.pages[event.page] = {};
    imageState.pages[event.page].taggingError = event.error;
  }

  try {
    getImageChannel().postMessage({ ...event, timestamp: Date.now() });
  } catch (e) {}
}

export function openDebugMonitor() {
  openUtteranceDebugMonitor();
  openGptDebugMonitor();
  openImageDebugMonitor();
}

function openImageDebugMonitor() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Image Analysis Debug Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4; }
    #header {
      position: sticky; top: 0; background: #252526; padding: 10px 14px;
      border-bottom: 1px solid #3c3c3c; z-index: 10;
    }
    #header h3 { color: #dcdcaa; font-size: 13px; }
    #pages { padding: 8px 14px; display: flex; flex-direction: column; gap: 4px; }
    .page-row {
      border: 1px solid #3c3c3c; border-radius: 4px; overflow: hidden;
    }
    .page-header {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; cursor: pointer; user-select: none;
      background: #252526;
    }
    .page-header:hover { background: #2d2d2d; }
    .page-arrow { font-size: 10px; color: #808080; width: 10px; }
    .page-title { flex: 1; font-weight: bold; }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%; background: #444;
      flex-shrink: 0;
    }
    .status-dot.both { background: #4caf50; }
    .status-dot.one  { background: #dcdcaa; }
    .page-row.both > .page-header { border-left: 3px solid #4caf50; }
    .page-row.one  > .page-header { border-left: 3px solid #dcdcaa; }
    .page-row.none > .page-header { border-left: 3px solid #444; }
    .page-body { display: none; padding: 8px 12px; background: #1e1e1e; border-top: 1px solid #3c3c3c; }
    .page-body.open { display: block; }
    .field { margin: 4px 0; }
    .field-label { color: #808080; }
    .field-value { color: #ce9178; word-break: break-word; }
    .field-value.pending { color: #555; font-style: italic; }
    .tags-wrap { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; padding-left: 12px; }
    .tag-chip {
      background: #2d2d2d; border: 1px solid #3c3c3c; border-radius: 3px;
      padding: 2px 6px; font-size: 11px; color: #9cdcfe;
    }
    .error-text { color: #f44747; }
  </style>
</head>
<body>
  <div id="header"><h3>Image Analysis Debug Monitor</h3></div>
  <div id="pages"></div>
  <script>
    const ch = new BroadcastChannel('${IMAGE_CHANNEL_NAME}');
    const container = document.getElementById('pages');

    // state[page] = { analysis, tags, analysisError, taggingError }
    var state = {};
    var totalPages = 0;

    function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

    function buildPages(n) {
      container.innerHTML = '';
      state = {};
      totalPages = n;
      for (var i = 1; i <= n; i++) {
        state[i] = { analysis: null, tags: null, analysisError: null, taggingError: null };
        var row = document.createElement('div');
        row.className = 'page-row none';
        row.id = 'page-row-' + i;
        row.innerHTML =
          '<div class="page-header" onclick="togglePage(' + i + ')">' +
            '<span class="page-arrow" id="arrow-' + i + '">▶</span>' +
            '<span class="page-title">Page ' + i + '</span>' +
            '<span class="status-dot" id="dot-' + i + '"></span>' +
          '</div>' +
          '<div class="page-body" id="body-' + i + '">' +
            '<div class="field"><span class="field-label">Analysis: </span><span class="field-value pending" id="analysis-' + i + '">pending...</span></div>' +
            '<div class="field"><span class="field-label">Tags: </span><span class="field-value pending" id="tags-' + i + '">pending...</span></div>' +
          '</div>';
        container.appendChild(row);
      }
    }

    function togglePage(i) {
      var body = document.getElementById('body-' + i);
      var arrow = document.getElementById('arrow-' + i);
      var open = body.classList.toggle('open');
      arrow.textContent = open ? '▼' : '▶';
    }

    function updatePage(page) {
      var s = state[page];
      if (!s) return;

      // Analysis field
      var analysisEl = document.getElementById('analysis-' + page);
      if (analysisEl) {
        if (s.analysisError) {
          analysisEl.className = 'field-value error-text';
          analysisEl.textContent = 'Error: ' + s.analysisError;
        } else if (s.analysis !== null) {
          analysisEl.className = 'field-value';
          analysisEl.textContent = s.analysis;
        }
      }

      // Tags field
      var tagsEl = document.getElementById('tags-' + page);
      if (tagsEl) {
        if (s.taggingError) {
          tagsEl.className = 'field-value error-text';
          tagsEl.textContent = 'Error: ' + s.taggingError;
        } else if (s.tags !== null) {
          if (s.tags.length === 0) {
            tagsEl.className = 'field-value';
            tagsEl.textContent = 'none';
          } else {
            tagsEl.className = '';
            tagsEl.innerHTML = '<div class="tags-wrap">' +
              s.tags.map(function(t) { return '<span class="tag-chip">' + esc(t.label) + '</span>'; }).join('') +
              '</div>';
          }
        }
      }

      // Status color
      var hasAnalysis = s.analysis !== null || s.analysisError !== null;
      var hasTags = s.tags !== null || s.taggingError !== null;
      var row = document.getElementById('page-row-' + page);
      var dot = document.getElementById('dot-' + page);
      if (row && dot) {
        if (hasAnalysis && hasTags) {
          row.className = 'page-row both';
          dot.className = 'status-dot both';
        } else if (hasAnalysis || hasTags) {
          row.className = 'page-row one';
          dot.className = 'status-dot one';
        } else {
          row.className = 'page-row none';
          dot.className = 'status-dot';
        }
      }
    }

    ch.onmessage = function(e) {
      var ev = e.data;

      if (ev.type === 'book_info') {
        buildPages(ev.totalPages);
        return;
      }

      if (!state[ev.page]) return;

      if (ev.type === 'analysis_response') {
        state[ev.page].analysis = ev.description || '(empty)';
        updatePage(ev.page);
      }
      else if (ev.type === 'tagging_response') {
        state[ev.page].tags = ev.tags || [];
        updatePage(ev.page);
      }
      else if (ev.type === 'analysis_error') {
        state[ev.page].analysisError = ev.error;
        updatePage(ev.page);
      }
      else if (ev.type === 'tagging_error') {
        state[ev.page].taggingError = ev.error;
        updatePage(ev.page);
      }
    };
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, 'image-debug', 'width=700,height=600,scrollbars=yes');

  // Replay cached state after the window has time to set up its BroadcastChannel listener
  if (imageState.totalPages > 0) {
    setTimeout(() => {
      const ch = getImageChannel();
      const ts = Date.now();
      ch.postMessage({ type: 'book_info', totalPages: imageState.totalPages, timestamp: ts });
      Object.entries(imageState.pages).forEach(([page, data]) => {
        const p = Number(page);
        if (data.analysis !== undefined)
          ch.postMessage({ type: 'analysis_response', page: p, description: data.analysis, timestamp: ts });
        if (data.tags !== undefined)
          ch.postMessage({ type: 'tagging_response', page: p, tags: data.tags, timestamp: ts });
        if (data.analysisError !== undefined)
          ch.postMessage({ type: 'analysis_error', page: p, error: data.analysisError, timestamp: ts });
        if (data.taggingError !== undefined)
          ch.postMessage({ type: 'tagging_error', page: p, error: data.taggingError, timestamp: ts });
      });
    }, 300);
  }
}

function openUtteranceDebugMonitor() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Utterance Debug Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4; }
    #header {
      position: sticky; top: 0; background: #252526; padding: 10px 14px;
      border-bottom: 1px solid #3c3c3c; z-index: 10;
    }
    #header h3 { color: #569cd6; margin-bottom: 6px; font-size: 13px; }
    .header-row { display: flex; gap: 20px; flex-wrap: wrap; }
    .header-label { color: #808080; }
    .header-value { color: #ce9178; }
    #queue-state { color: #9cdcfe; margin-top: 4px; }
    #log {
      padding: 8px 14px; display: flex; flex-direction: column; gap: 2px;
    }
    .entry {
      padding: 4px 8px; border-radius: 3px; line-height: 1.5;
      border-left: 3px solid transparent;
    }
    .entry .time { color: #888; margin-right: 8px; }
    .success { border-left-color: #4caf50; color: #4caf50; background: rgba(76, 175, 80, 0.08); }
    .fail { border-left-color: #f44747; color: #f44747; background: rgba(244, 71, 71, 0.08); }
    .fail .score-label { color: #d4a0a0; }
    .fail .score-val { color: #f77; }
    .neutral { border-left-color: #555; color: #d4d4d4; }
    #clear-btn {
      position: fixed; bottom: 12px; right: 12px; background: #3c3c3c; color: #d4d4d4;
      border: 1px solid #555; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 11px;
    }
    #clear-btn:hover { background: #505050; }
  </style>
</head>
<body>
  <div id="header">
    <h3>Utterance Debug Monitor</h3>
    <div class="header-row">
      <div><span class="header-label">Expected: </span><span id="expected-line" class="header-value">—</span></div>
      <div><span class="header-label">Line: </span><span id="line-index" class="header-value">—</span></div>
    </div>
    <div id="queue-state">Queue: —</div>
    <div id="offscript-state" style="color: #d7ba7d; margin-top: 6px; border-top: 1px solid #3c3c3c; padding-top: 6px;">
      <span class="header-label">Off-script (for LLM): </span><span id="offscript-words" style="color: #ce9178;">—</span>
    </div>
  </div>
  <div id="log"></div>
  <button id="clear-btn" onclick="document.getElementById('log').innerHTML=''">Clear</button>
  <script>
    const ch = new BroadcastChannel('${CHANNEL_NAME}');
    const log = document.getElementById('log');
    const expectedEl = document.getElementById('expected-line');
    const lineIndexEl = document.getElementById('line-index');
    const queueStateEl = document.getElementById('queue-state');
    const offscriptEl = document.getElementById('offscript-words');
    let offscriptEntries = [];

    function fmt(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    ch.onmessage = (e) => {
      const ev = e.data;
      const time = '<span class="time">' + fmt(ev.timestamp) + '</span>';

      if (ev.type === 'utterance_received') {
        expectedEl.textContent = ev.expectedLine || '—';
        lineIndexEl.textContent = ev.lineIndex != null ? ev.lineIndex : '—';
        add(time + 'Utterance: "' + esc(ev.utterance) + '"', 'neutral');
      }
      else if (ev.type === 'queue_state') {
        queueStateEl.textContent = 'Queue [' + ev.wordCount + ' words]: ' + ev.words;
      }
      else if (ev.type === 'variant_attempt') {
        add(time + 'Trying ' + esc(ev.label) + ' -> "' + esc(ev.text) + '" (' + ev.wordCount + ' words)', 'neutral');
      }
      else if (ev.type === 'exact_match') {
        add(time + 'MATCH Exact (' + esc(ev.label) + ') at pos ' + ev.startIdx, 'success');
      }
      else if (ev.type === 'hybrid_match') {
        add(time + 'MATCH Hybrid (' + esc(ev.label) + ') at pos ' + ev.startIdx + ' — confidence: ' + ev.confidence + '%  fuzzy: ' + ev.fuzzyScore + '%  phonetic: ' + ev.phoneticScore + '%', 'success');
      }
      else if (ev.type === 'forward_exact_match') {
        add(time + 'MATCH Forward exact (' + esc(ev.label) + ') line ' + ev.lineIndex + ' at pos ' + ev.startIdx, 'success');
      }
      else if (ev.type === 'forward_hybrid_match') {
        add(time + 'MATCH Forward hybrid (' + esc(ev.label) + ') line ' + ev.lineIndex + ' — confidence: ' + ev.confidence + '%  fuzzy: ' + ev.fuzzyScore + '%  phonetic: ' + ev.phoneticScore + '%', 'success');
      }
      else if (ev.type === 'merged_check') {
        add(time + 'Merged check (' + esc(ev.label) + ') — "' + esc(ev.spokenWord) + '" vs "' + esc(ev.target) + '" — <span class="score-label">confidence:</span> <span class="score-val">' + ev.confidence + '%</span>  <span class="score-label">fuzzy:</span> <span class="score-val">' + ev.fuzzyScore + '%</span>  <span class="score-label">phonetic:</span> <span class="score-val">' + ev.phoneticScore + '%</span>', 'neutral');
      }
      else if (ev.type === 'merged_match') {
        add(time + 'MATCH Merged (' + esc(ev.label) + ') — "' + esc(ev.spokenWord) + '" confidence: ' + ev.confidence + '%', 'success');
      }
      else if (ev.type === 'variant_result') {
        if (ev.reason === 'insufficient_words') {
          add(time + esc(ev.label) + ' FAIL — not enough words in queue (' + ev.have + '/' + ev.need + ')', 'fail');
        } else {
          add(time + esc(ev.label) + ' FAIL — <span class="score-label">fuzzy:</span> <span class="score-val">' + ev.fuzzyScore + '%</span>  <span class="score-label">phonetic:</span> <span class="score-val">' + ev.phoneticScore + '%</span>  <span class="score-label">confidence:</span> <span class="score-val">' + ev.confidence + '%</span><br><span class="score-label">Queue:</span> <span class="score-val">"' + esc(ev.queue) + '"</span>', 'fail');
        }
      }
      else if (ev.type === 'no_match') {
        add(time + 'No match — tried ' + esc(ev.variantsTried), 'fail');
      }
      else if (ev.type === 'queue_slide') {
        add(time + 'Queue slide: removed "' + esc(ev.removed) + '"', 'neutral');
      }
      else if (ev.type === 'forward_search_start') {
        add(time + 'Forward search line ' + ev.lineIndex + ': "' + esc(ev.target) + '"', 'neutral');
      }
      else if (ev.type === 'offscript_update') {
        offscriptEntries = ev.entries;
        offscriptEl.textContent = offscriptEntries.length > 0
          ? offscriptEntries.map(function(e) { return 'L' + e.lineIndex + ': "' + e.text + '"'; }).join(' | ')
          : '—';
      }
      else if (ev.type === 'offscript_clear') {
        offscriptEntries = [];
        offscriptEl.textContent = '—';
      }
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function add(html, cls) {
      const div = document.createElement('div');
      div.className = 'entry ' + cls;
      div.innerHTML = html;
      log.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth' });
    }
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, 'utterance-debug', 'width=700,height=600,scrollbars=yes');
}
