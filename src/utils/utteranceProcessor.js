import { categorizeOffScriptUtterances } from "./InnerThoughtProcess";
import { calculateHybridScore, findSubsequenceMatch } from "./intentMatcher";
import { normalizeText, splitIntoSentences, isMultiSentenceLong } from "./textNormalizer";

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function calculateConfidence(spokenWords, expectedText) {
  const mergedUtterance = spokenWords.filter(w => w.length > 0).join(' ');
  return calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.5,
    phoneticWeight: 0.5,
    matchThreshold: 0.6,
  }).confidence;
}

function clearMatchState({ accumulatedUtterancesRef, utteranceQueuesRef, silenceTimeoutRef, pendingUtteranceRef }, wordsToConsume) {
  accumulatedUtterancesRef.current = [];
  utteranceQueuesRef.current = utteranceQueuesRef.current.map(q => q.slice(wordsToConsume));
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

function checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef }) {
  for (let offset = 1; offset <= 3; offset++) {
    const checkIndex = currentLineIndex + offset;
    if (checkIndex >= totalLines) break;

    const checkLine = state.pagesValues[state.page]?.text?.[checkIndex];
    if (!checkLine?.Dialogue) continue;

    const strippedDialogue = stripSSMLTags(checkLine.Dialogue);

    // For long multi-sentence lines, match against individual sentences
    const isSplit = isMultiSentenceLong(strippedDialogue);
    const matchTargets = isSplit
      ? splitIntoSentences(strippedDialogue)
      : [strippedDialogue];
    console.log(`Forward search line ${checkIndex}: ${isSplit ? `split into ${matchTargets.length} sentences: [${matchTargets.join(' | ')}]` : `single target: "${strippedDialogue}"`}`);

    for (const target of matchTargets) {
      const checkText = normalizeText(target);
      const checkWordCount = checkText[0].split(/\s+/).filter(w => w.length > 0).length;

      for (const allSpokenWords of utteranceQueuesRef.current) {
        const allSpokenWordCount = allSpokenWords.length;

        // Exact subsequence match first
        const exactMatch = findSubsequenceMatch(checkText, allSpokenWords);
        if (exactMatch !== null) {
          console.log(`Exact subsequence match on future line ${checkIndex} (sentence: "${target}") at position ${exactMatch.startIdx}!`);
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
              console.log(`Match found at line ${checkIndex} (sentence: "${target}") with window starting at ${startIdx}! Jumping ahead.`);
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
    }
  }

  return false;
}

// Main function to process user utterance, match against current line, and handle state updates
export async function processUserUtterance({
  userUtterance,
  lastProcessedUtteranceRef,
  accumulatedUtterancesRef,
  utteranceQueuesRef,
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
  // But only if the last line is no longer highlighted (i.e., already matched)
  if (totalLines > 0 && state.index >= totalLines && !currentLine?.Reading) {
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
    utteranceQueuesRef.current = [];
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  } else if (currentLineTrackingRef.current.index !== currentLineIndex) {
    currentLineTrackingRef.current.index = currentLineIndex;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    pendingUtteranceRef.current = "";
  }

  // Accumulate utterance and words — build parallel queues for each normalized variant
  accumulatedUtterancesRef.current.push({ speaker: speakerLabels || 'Unknown', utterance: userUtterance.toLowerCase().trim() });
  lastProcessedUtteranceRef.current = userUtterance;
  const variants = normalizeText(userUtterance);
  if (utteranceQueuesRef.current.length === 0) {
    utteranceQueuesRef.current = variants.map(() => []);
  }
  variants.forEach((variant, i) => {
    const words = variant.split(/\s+/).filter(w => w.length > 0);
    utteranceQueuesRef.current[i].push(...words);
  });

  // Prepare expected text (array of variants)
  const expectedText = normalizeText(stripSSMLTags(currentLine.Dialogue));
  const expectedWordCount = expectedText[0].split(/\s+/).filter(w => w.length > 0).length;
  const refs = { accumulatedUtterancesRef, utteranceQueuesRef, silenceTimeoutRef, pendingUtteranceRef };

  // Try matching across all spoken variant queues
  for (const allSpokenWords of utteranceQueuesRef.current) {
    // Step 1: Exact subsequence match on whole queue
    const exactMatch = findSubsequenceMatch(expectedText, allSpokenWords);
    if (exactMatch !== null) {
      console.log(`Exact subsequence match at position ${exactMatch.startIdx}!`);
      captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, exactMatch.startIdx));
      clearMatchState(refs, exactMatch.endIdx);
      // Clear highlight on the last line once the user has read it
      if (currentLineIndex === totalLines - 1) {
        currentLine.Reading = false;
      }
      advanceToNextLine(setAudioHasEnded, setIsPlaying);
      return;
    }

    // Step 2: Sliding window hybrid (fuzzy + phonetic)
    let hybridStartIdx = -1;
    let hybridResult = null;

    if (allSpokenWords.length >= expectedWordCount) {
      const maxStartIndex = allSpokenWords.length - expectedWordCount;
      for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
        const window = allSpokenWords.slice(startIdx, startIdx + expectedWordCount);
        const confidence = calculateConfidence(window, expectedText);
        if (confidence >= 0.6) {
          hybridResult = { confidence };
          hybridStartIdx = startIdx;
          break;
        }
      }
    }

    if (hybridStartIdx !== -1) {
      console.log(`Sliding window hybrid match at position ${hybridStartIdx}! Confidence: ${(hybridResult.confidence * 100).toFixed(1)}%`);
      captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, hybridStartIdx));
      clearMatchState(refs, hybridStartIdx + expectedWordCount);
      // Clear highlight on the last line once the user has read it
      if (currentLineIndex === totalLines - 1) {
        currentLine.Reading = false;
      }
      advanceToNextLine(setAudioHasEnded, setIsPlaying);
      return;
    }
  }

  // Debug log (use first variant queue for logging)
  const primaryQueue = utteranceQueuesRef.current[0] || [];
  console.log(`--- No match for current line ---`);
  console.log(`Expected: "${expectedText.join(' | ')}" | User Utterance: [${primaryQueue.join(', ')}]`);
  console.log(`Scanned ${Math.max(0, primaryQueue.length - expectedWordCount + 1)} window(s) of size ${expectedWordCount} — no hybrid match >= 60%`);
  console.log(`---------------------------------`);

  // Step 3: Check if user skipped ahead (next 3 lines)
  const foundMatch = checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef });

  // Step 4: Slide queue if no match found
  if (!foundMatch) {
    if (primaryQueue.length >= expectedWordCount) {
      const removed = utteranceQueuesRef.current.map(q => q.shift());
      console.log(`No match found. Sliding queue: removed "${removed[0]}"`);
    } else {
      console.log(`Waiting for more words: ${primaryQueue.length}/${expectedWordCount} words in queue`);
    }
  }
}
