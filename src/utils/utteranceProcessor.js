import { categorizeOffScriptUtterances } from "./InnerThoughtProcess";
import { calculateHybridScore } from "./intentMatcher";

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function stripPunctuation(text) {
  return text.replace(/[*.,!?;:'"'""()\-—…]/g, "");
}

function calculateConfidence(spokenWords, expectedText) {
  const mergedUtterance = spokenWords.map(w => stripPunctuation(w)).filter(w => w.length > 0).join(' ');
  return calculateHybridScore(mergedUtterance, stripPunctuation(expectedText), {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.5,
    phoneticWeight: 0.5,
    matchThreshold: 0.6,
  }).confidence;
}

// Returns {startIdx, endIdx} if expectedWords appear in order (with gaps allowed) in spokenWords, else null.
// startIdx: index of first matched word (words before it are off-script)
// endIdx: index after last matched word (words 0..endIdx-1 are consumed from queue)
function findSubsequenceMatch(expectedWords, spokenWords) {
  if (expectedWords.length === 0) return null;
  let queueIdx = 0;
  let firstMatchIdx = -1;
  let lastMatchIdx = -1;

  for (const word of expectedWords) {
    while (queueIdx < spokenWords.length && spokenWords[queueIdx] !== word) {
      queueIdx++;
    }
    if (queueIdx >= spokenWords.length) return null;
    if (firstMatchIdx === -1) firstMatchIdx = queueIdx;
    lastMatchIdx = queueIdx;
    queueIdx++;
  }

  return { startIdx: firstMatchIdx, endIdx: lastMatchIdx + 1 };
}

function clearMatchState({ accumulatedUtterancesRef, utteranceQueueRef, silenceTimeoutRef, pendingUtteranceRef }, wordsToConsume) {
  accumulatedUtterancesRef.current = [];
  utteranceQueueRef.current = utteranceQueueRef.current.slice(wordsToConsume);
  if (silenceTimeoutRef.current) {
    clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = null;
  }
  pendingUtteranceRef.current = "";
}

function captureOffScriptWords(offScriptLogRef, lineIndex, leftoverWords) {
  if (!offScriptLogRef || leftoverWords.length === 0) return;
  offScriptLogRef.current.push({ lineIndex, text: leftoverWords.join(' ') });
}

export function sendOffScriptLog(offScriptLogRef, oldPage, state) {
  if (!offScriptLogRef?.current?.length) return;

  const currentPageText = state.pagesValues[oldPage]?.text
    ?.map(l => stripSSMLTags(l.Dialogue)).join(' ') || '';

  const currentPageQuestion = state.pagesValues[oldPage]?.question || '';

  const bookText = state.pagesValues
    .map((page, i) =>
      `Page ${i + 1}:\n` +
      (page.text || []).map(l => `${l.Character}: ${stripSSMLTags(l.Dialogue)}`).join('\n')
    ).join('\n\n');

  // Merge all entries by line index, then format as "line2: text"
  const lineMap = new Map();
  for (const e of offScriptLogRef.current) {
    lineMap.set(e.lineIndex, lineMap.has(e.lineIndex)
      ? lineMap.get(e.lineIndex) + ' ' + e.text
      : e.text);
  }

  const formattedLog = [...lineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, text]) => `line${idx + 1}: ${text}`)
    .join('\n');

  console.log(`Sending off-script log for page ${oldPage + 1}:\n${formattedLog}`);

  categorizeOffScriptUtterances(formattedLog, currentPageText, currentPageQuestion, bookText, oldPage + 1)
    .then(r => console.log('Off-script categorization:', r))
    .catch(err => console.error('Categorization error:', err));

  offScriptLogRef.current = [];
}

function advanceToNextLine(setAudioHasEnded, setIsPlaying) {
  setTimeout(() => {
    setAudioHasEnded(true);
    setIsPlaying(true);
  }, 100);
}

function jumpToFutureLine(jumpToLine, checkIndex, totalLines) {
  if (!jumpToLine) return;
  setTimeout(() => jumpToLine(Math.min(checkIndex + 2, totalLines)), 100);
}

function checkFutureLines({ allSpokenWords, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef }) {
  const allSpokenWordCount = allSpokenWords.length;

  for (let offset = 1; offset <= 3; offset++) {
    const checkIndex = currentLineIndex + offset;
    if (checkIndex >= totalLines) break;

    const checkLine = state.pagesValues[state.page]?.text?.[checkIndex];
    if (!checkLine?.Dialogue) continue;

    const checkText = stripPunctuation(stripSSMLTags(checkLine.Dialogue).toLowerCase().trim());
    const checkExpectedWords = checkText.split(/\s+/).filter(w => w.length > 0);
    const checkWordCount = checkExpectedWords.length;

    // Exact subsequence match first
    const exactMatch = findSubsequenceMatch(checkExpectedWords, allSpokenWords);
    if (exactMatch !== null) {
      console.log(`Exact subsequence match on future line ${checkIndex} at position ${exactMatch.startIdx}!`);
      captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, exactMatch.startIdx));
      clearMatchState(refs, exactMatch.endIdx);
      jumpToFutureLine(jumpToLine, checkIndex, totalLines);
      return true;
    }

    if (checkWordCount <= allSpokenWordCount) {
      // Sliding window: try each window position
      const maxStartIndex = allSpokenWordCount - checkWordCount;
      for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
        const windowWords = allSpokenWords.slice(startIdx, startIdx + checkWordCount);
        if (calculateConfidence(windowWords, checkText) >= 0.6) {
          console.log(`Match found at line ${checkIndex} with window starting at ${startIdx}! Jumping ahead.`);
          captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, startIdx));
          clearMatchState(refs, startIdx + checkWordCount);
          jumpToFutureLine(jumpToLine, checkIndex, totalLines);
          return true;
        }
      }
    } else {
      // Queue shorter than future line — use full queue
      if (calculateConfidence(allSpokenWords, checkText) >= 0.6) {
        captureOffScriptWords(offScriptLogRef, checkIndex, []);
        clearMatchState(refs, allSpokenWordCount);
        jumpToFutureLine(jumpToLine, checkIndex, totalLines);
        return true;
      }
    }
  }

  return false;
}

export async function processUserUtterance({
  userUtterance,
  lastProcessedUtteranceRef,
  accumulatedUtterancesRef,
  utteranceQueueRef,
  currentLineTrackingRef,
  silenceTimeoutRef,
  pendingUtteranceRef,
  offScriptLogRef,
  state,
  speakerLabels,
  sendContentMessage,
  jumpToLine,
  setAudioHasEnded,
  setIsPlaying
}) {
  if (!userUtterance || userUtterance === lastProcessedUtteranceRef.current) return;

  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];

  // After all lines on the page are read, collect into offScriptLogRef for post-page categorization
  if (totalLines > 0 && state.index >= totalLines) {
    lastProcessedUtteranceRef.current = userUtterance;
    captureOffScriptWords(offScriptLogRef, totalLines, userUtterance.trim().split(/\s+/).filter(w => w.length > 0));
    console.log(`Post-last-line utterance collected: "${userUtterance}"`);
    return;
  }

  if (!currentLine?.Reading) return;

  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = currentCharacter?.role === "Parent" || currentCharacter?.role === "Child" || currentCharacter?.role === "Dummy";

  if (!isUserReadingRole) return;

  // Reset state on page/line change
  if (currentLineTrackingRef.current.page !== state.page) {
    // Send off-script log before clearing
    sendOffScriptLog(offScriptLogRef, currentLineTrackingRef.current.page, state);
    accumulatedUtterancesRef.current = [];
    utteranceQueueRef.current = [];
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  } else if (currentLineTrackingRef.current.index !== currentLineIndex) {
    currentLineTrackingRef.current.index = currentLineIndex;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    pendingUtteranceRef.current = "";
  }

  // Accumulate utterance and words
  accumulatedUtterancesRef.current.push({ speaker: speakerLabels || 'Unknown', utterance: userUtterance.toLowerCase().trim() });
  lastProcessedUtteranceRef.current = userUtterance;
  const newWords = stripPunctuation(userUtterance.toLowerCase().trim()).split(/\s+/).filter(w => w.length > 0);
  utteranceQueueRef.current.push(...newWords);

  // Prepare expected text
  const expectedText = stripPunctuation(stripSSMLTags(currentLine.Dialogue).toLowerCase().trim());
  const expectedWords = expectedText.split(/\s+/).filter(w => w.length > 0);
  const expectedWordCount = expectedWords.length;
  const allSpokenWords = utteranceQueueRef.current;
  const refs = { accumulatedUtterancesRef, utteranceQueueRef, silenceTimeoutRef, pendingUtteranceRef };

  // Step 1: Exact subsequence match on whole queue
  const exactMatch = findSubsequenceMatch(expectedWords, allSpokenWords);
  if (exactMatch !== null) {
    console.log(`Exact subsequence match at position ${exactMatch.startIdx}! Matched: [${expectedWords.join(', ')}]`);
    captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, exactMatch.startIdx));
    clearMatchState(refs, exactMatch.endIdx);
    advanceToNextLine(setAudioHasEnded, setIsPlaying);
    return;
  }

  // Step 2: Sliding window hybrid (fuzzy + phonetic) — scan all N-word windows left to right
  let hybridStartIdx = -1;
  let hybridResult = null;

  if (allSpokenWords.length >= expectedWordCount) {
    const maxStartIndex = allSpokenWords.length - expectedWordCount;
    for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
      const window = allSpokenWords.slice(startIdx, startIdx + expectedWordCount);
      const result = calculateHybridScore(window.join(' '), expectedText, {
        exactWordWeight: 0.0,
        fuzzyWeight: 0.5,
        phoneticWeight: 0.5,
        matchThreshold: 0.6,
      });
      if (result.confidence >= 0.6) {
        hybridResult = result;
        hybridStartIdx = startIdx;
        break;
      }
    }
  }

  if (hybridStartIdx !== -1) {
    console.log(`Sliding window hybrid match at position ${hybridStartIdx}! Confidence: ${(hybridResult.confidence * 100).toFixed(1)}%`);
    captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, hybridStartIdx));
    clearMatchState(refs, hybridStartIdx + expectedWordCount);
    advanceToNextLine(setAudioHasEnded, setIsPlaying);
    return;
  }

  // Debug log
  console.log(`--- No match for current line ---`);
  console.log(`Expected: "${expectedText}" | All: [${allSpokenWords.join(', ')}]`);
  console.log(`Scanned ${Math.max(0, allSpokenWords.length - expectedWordCount + 1)} window(s) of size ${expectedWordCount} — no hybrid match >= 60%`);
  console.log(`---------------------------------`);

  // Step 3: Check if user skipped ahead (next 3 lines)
  const foundMatch = checkFutureLines({ allSpokenWords, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef });

  // Step 4: Slide queue if no match found
  if (!foundMatch) {
    if (utteranceQueueRef.current.length >= expectedWordCount) {
      console.log(`No match found. Sliding queue: removed "${utteranceQueueRef.current.shift()}"`);
    } else {
      console.log(`Waiting for more words: ${utteranceQueueRef.current.length}/${expectedWordCount} words in queue`);
    }
  }
}
