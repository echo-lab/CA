import { classifyUtterance, calculateRelevancy } from "./InnerThoughtProcess";
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

function matchesExactly(expectedWords, spokenWords) {
  return expectedWords.every(word => spokenWords.includes(word));
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

function checkFutureLines({ allSpokenWords, currentLineIndex, totalLines, state, refs, jumpToLine }) {
  const allSpokenWordCount = allSpokenWords.length;

  for (let offset = 1; offset <= 3; offset++) {
    const checkIndex = currentLineIndex + offset;
    if (checkIndex >= totalLines) break;

    const checkLine = state.pagesValues[state.page]?.text?.[checkIndex];
    if (!checkLine?.Dialogue) continue;

    const checkText = stripSSMLTags(checkLine.Dialogue).toLowerCase().trim();
    const checkExpectedWords = checkText.split(/\s+/);
    const checkWordCount = checkExpectedWords.length;

    // Exact word match first
    if (matchesExactly(checkExpectedWords, allSpokenWords)) {
      console.log(`Exact word match on future line ${checkIndex}!`);
      clearMatchState(refs, checkWordCount);
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
          clearMatchState(refs, checkWordCount);
          jumpToFutureLine(jumpToLine, checkIndex, totalLines);
          return true;
        }
      }
    } else {
      // Queue shorter than future line — use full queue
      if (calculateConfidence(allSpokenWords, checkText) >= 0.6) {
        clearMatchState(refs, checkWordCount);
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
  state,
  speakerLabels,
  sendContentMessage,
  jumpToLine,
  setAudioHasEnded,
  setIsPlaying
}) {
  if (!userUtterance || userUtterance === lastProcessedUtteranceRef.current) return;

  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];

  if (!currentLine?.Reading) return;

  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = currentCharacter?.role === "Parent" || currentCharacter?.role === "Child" || currentCharacter?.role === "Dummy";

  if (!isUserReadingRole) return;

  // Reset state on page/line change
  if (currentLineTrackingRef.current.page !== state.page) {
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
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const expectedText = stripPunctuation(stripSSMLTags(currentLine.Dialogue).toLowerCase().trim());
  const expectedWords = expectedText.split(/\s+/).filter(w => w.length > 0);
  const expectedWordCount = expectedWords.length;
  const allSpokenWords = utteranceQueueRef.current;
  const refs = { accumulatedUtterancesRef, utteranceQueueRef, silenceTimeoutRef, pendingUtteranceRef };

  // Step 1: Exact word match on whole queue
  if (matchesExactly(expectedWords, allSpokenWords)) {
    console.log(`Exact word match! Matched: [${expectedWords.join(', ')}]`);
    clearMatchState(refs, expectedWordCount);
    advanceToNextLine(setAudioHasEnded, setIsPlaying);
    return;
  }

  // Step 2: Hybrid (fuzzy + phonetic) on last N words
  const mergedUtterance = allSpokenWords.slice(-expectedWordCount).join(' ');
  const hybridResult = calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.5,
    phoneticWeight: 0.5,
    matchThreshold: 0.6,
  });

  if (hybridResult.confidence >= 0.6) {
    clearMatchState(refs, expectedWordCount);
    advanceToNextLine(setAudioHasEnded, setIsPlaying);
    return;
  }

  // Debug log
  console.log(`--- No match for current line ---`);
  console.log(`Expected: "${expectedText}" | Cleaned: "${hybridResult.cleanedTarget || expectedText}"`);
  console.log(`Last ${expectedWordCount} words: "${mergedUtterance}" | All: [${allSpokenWords.join(', ')}]`);
  console.log(`Fuzzy: ${((1 - hybridResult.fuzzyScore) * 100).toFixed(1)}% | Phonetic: ${((1 - hybridResult.phoneticScore) * 100).toFixed(1)}% | Confidence: ${(hybridResult.confidence * 100).toFixed(1)}%`);
  console.log(`---------------------------------`);

  // Step 3: Check if user skipped ahead (next 3 lines)
  const foundMatch = checkFutureLines({ allSpokenWords, currentLineIndex, totalLines, state, refs, jumpToLine });

  // Step 4: Slide queue if no match found
  if (!foundMatch) {
    if (utteranceQueueRef.current.length >= expectedWordCount) {
      console.log(`No match found. Sliding queue: removed "${utteranceQueueRef.current.shift()}"`);
    } else {
      console.log(`Waiting for more words: ${utteranceQueueRef.current.length}/${expectedWordCount} words in queue`);
    }
  }
}
