const CHANNEL_NAME = 'utterance-debug';
const GPT_CHANNEL_NAME = 'gpt-debug';

let channel = null;
let gptChannel = null;

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

    function truncate(s, max) {
      if (typeof s !== 'string') s = JSON.stringify(s);
      if (s.length <= max) return esc(s);
      return esc(s.slice(0, max)) + '<span class="field-value truncated"> ... (' + s.length + ' chars)</span>';
    }

    function field(label, value, maxLen) {
      if (value === undefined || value === null) return '';
      if (typeof value === 'boolean') {
        return '<div class="field"><span class="field-label">' + label + ': </span><span class="field-value ' + (value ? 'bool-true' : 'bool-false') + '">' + value + '</span></div>';
      }
      var display = maxLen ? truncate(String(value), maxLen) : esc(String(value));
      return '<div class="field"><span class="field-label">' + label + ': </span><span class="field-value">' + display + '</span></div>';
    }

    function formatRequest(endpoint, payload) {
      var html = '';
      if (endpoint === '/api/categorize-utterances') {
        html += field('Utterances', payload.formattedUtterances, 300);
        html += field('Page Text', payload.bookPageText, 150);
        html += field('Question', payload.currentPageQuestion, 200);
        html += field('Page #', payload.currentPageNumber);
        html += field('Book Text', payload.bookText, 100);
      } else if (endpoint === '/api/check-relevancy') {
        html += field('Utterance', payload.utterance, 300);
        html += field('Current Line', payload.currentLine, 200);
        html += field('Prev Utterances', payload.utterances, 200);
        html += field('Book Content', payload.bookContent, 100);
      } else {
        html += field('Payload', JSON.stringify(payload, null, 2), 500);
      }
      return html;
    }

    function formatResponse(endpoint, data) {
      var html = '';
      if (!data) return field('Result', 'null');
      if (endpoint === '/api/check-relevancy') {
        html += field('Relevant', data.isRelevant);
        html += field('Confidence', data.confidence);
        html += field('Reason', data.reason, 300);
        html += field('Suggested Response', data.suggestedResponse, 300);
      } else if (endpoint === '/api/categorize-utterances') {
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

export function openDebugMonitor() {
  openUtteranceDebugMonitor();
  openGptDebugMonitor();
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
