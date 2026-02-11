import { classifyUtterance, calculateRelevancy } from "./InnerThoughtProcess";
import { calculateHybridScore } from "./intentMatcher";

/**
 * Strips SSML tags from text
 */
function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

/**
 * Strips punctuation from text
 */
function stripPunctuation(text) {
  return text.replace(/[*.,!?;:'"’“”()\-—…]/g, "");
}

/**
 * Calculate confidence score for matching spoken words against expected text
 * Uses hybrid matching: exact word match + fuzzy (Fuse.js) + phonetic
 *
 * @param {string[]} spokenWords - Array of spoken words
 * @param {string} expectedText - Expected text to match against
 * @returns {number} Confidence score (0 = no match, 1 = perfect match)
 */
function calculateConfidence(spokenWords, expectedText) {
  // Strip punctuation from expected text
  const cleanExpectedText = stripPunctuation(expectedText);

  // Strip punctuation from spoken words and join
  const cleanSpokenWords = spokenWords.map(w => stripPunctuation(w)).filter(w => w.length > 0);
  const mergedUtterance = cleanSpokenWords.join(' ');

  // Use hybrid matching (exact word + fuzzy + phonetic)
  const hybridResult = calculateHybridScore(mergedUtterance, cleanExpectedText, {
    exactWordWeight: 0.4,  // Weight for exact word matching
    fuzzyWeight: 0.3,      // Weight for character-based fuzzy matching
    phoneticWeight: 0.3,   // Weight for phonetic (sound-based) matching
    matchThreshold: 0.6,   // Confidence threshold for match
  });

  return hybridResult.confidence;
}

export async function processUserUtterance({
  userUtterance,
  lastProcessedUtteranceRef,
  userUtterancesRef,
  accumulatedUtterancesRef,
  utteranceQueueRef,  // New: ref to persist word queue across calls
  currentLineTrackingRef,
  silenceTimeoutRef,
  pendingUtteranceRef,
  state,
  speakerLabels,
  sendContentMessage,
  gotoNextPage,
  jumpToLine,  // New: callback to jump to a specific line index
  setAudioHasEnded,
  setIsPlaying
}) {
  const userUtterances = userUtterancesRef.current;

  // Only process if we have a new utterance and we're currently on a line
  if (!userUtterance || userUtterance === lastProcessedUtteranceRef.current) {
    return;
  }

  // Get the current line being read (index - 1 since index is already incremented)
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];

  if (!currentLine || !currentLine.Reading) {
    return;
  }

  // Check if this line should be read by the user (Parent, Child, or Dummy role)
  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = currentCharacter?.role === "Parent" || currentCharacter?.role === "Child" || currentCharacter?.role === "Dummy";

  if (!isUserReadingRole) {
    return;
  }

  // Reset accumulated utterances and queue only if we've moved to a new PAGE
  // Don't reset on line change - queue should persist across lines for continuous reading
  if (currentLineTrackingRef.current.page !== state.page) {
    accumulatedUtterancesRef.current = [];
    utteranceQueueRef.current = [];  // Reset word queue for new page
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  } else if (currentLineTrackingRef.current.index !== currentLineIndex) {
    // Just update the line index, keep the queue
    currentLineTrackingRef.current.index = currentLineIndex;

    // Clear any pending silence timeout when moving to a new line
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    pendingUtteranceRef.current = "";
  }

  // Add the new utterance to accumulated list with speaker label
  // accumulatedUtterancesRef.current.push({
  //   speaker: speakerLabels || 'Unknown',
  //   utterance: userUtterance.toLowerCase().trim()
  // });
  // lastProcessedUtteranceRef.current = userUtterance;

  // Strip SSML tags, punctuation, and normalize expected text
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const rawExpectedText = stripSSMLTags(currentLine.Dialogue).toLowerCase().trim();
  const expectedText = stripPunctuation(rawExpectedText);
  const expectedWords = expectedText.split(/\s+/).filter(w => w.length > 0);
  const expectedWordCount = expectedWords.length;

  // Get new words from user utterance (strip punctuation)
  const newWords = stripPunctuation(userUtterance.toLowerCase().trim()).split(/\s+/).filter(word => word.length > 0);
  lastProcessedUtteranceRef.current = userUtterance;

  // Add all new words to queue (no limit)
  utteranceQueueRef.current.push(...newWords);

  // Get all words from queue for exact word matching
  const allSpokenWords = utteranceQueueRef.current;
  const allSpokenWordCount = allSpokenWords.length;

  // Get last N words for hybrid matching comparison (N = expected word count)
  const lastNWords = allSpokenWords.slice(-expectedWordCount);

  // Format utterances with speaker labels for sending to OpenAI
  const formattedUtterances = accumulatedUtterancesRef.current
    .map(item => `${item.speaker}: "${item.utterance}"`)
    .join('\n');

  // Merge last N words for fuzzy/phonetic matching comparison
  const mergedUtterance = lastNWords.join(' ');

  console.log(`Queue: [${allSpokenWords.join(', ')}] (${allSpokenWordCount} words, last ${lastNWords.length} for fuzzy/phonetic)`);

  // FIRST: Check exact word match using the WHOLE queue
  // This checks if all expected words exist anywhere in the queue
  const exactMatchedWords = expectedWords.filter(word => allSpokenWords.includes(word));
  const exactMatchPercentage = expectedWords.length > 0 ? exactMatchedWords.length / expectedWords.length : 0;

  // If all expected words found in queue, it's a match!
  if (exactMatchPercentage === 1) {
    console.log(`Exact word match on whole queue! Matched: [${exactMatchedWords.join(', ')}]`);

    // Clear accumulated utterances and queue for this line
    accumulatedUtterancesRef.current = [];
    utteranceQueueRef.current = utteranceQueueRef.current.slice(expectedWordCount);

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    pendingUtteranceRef.current = "";

    // Trigger next line
    setTimeout(() => {
      setAudioHasEnded(true);
      setIsPlaying(true);
    }, 100);
    return;
  }

  // SECOND: If exact match fails, try hybrid matching (fuzzy + phonetic) on last N words
  const hybridResult = calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,  // Already checked exact match above with whole queue
    fuzzyWeight: 0.5,      // Weight for character-based fuzzy matching
    phoneticWeight: 0.5,   // Weight for phonetic (sound-based) matching
    matchThreshold: 0.6,
  });

  // Get confidence from hybrid matching (fuzzy + phonetic only)
  const confidence = hybridResult.confidence;

  // If at least 60% confidence from fuzzy/phonetic, consider it read
  if (confidence >= 0.6) {
    // Clear accumulated utterances and queue for this line (5a: match found)
    accumulatedUtterancesRef.current = [];
    utteranceQueueRef.current = utteranceQueueRef.current.slice(expectedWordCount);  // Remove matched words, keep extras

    // Clear any pending silence timeout since user successfully read the line
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    pendingUtteranceRef.current = "";

    // Trigger next line
    setTimeout(() => {
      setAudioHasEnded(true);
      setIsPlaying(true);
    }, 100);
  } else {
    // Debug: Log comparison details when utterance doesn't match expected text
    console.log(`--- No match for current line ---`);
    console.log(`Expected text: "${expectedText}"`);
    console.log(`Cleaned expected: "${hybridResult.cleanedTarget || expectedText}"`);
    console.log(`Whole queue exact match: ${(exactMatchPercentage * 100).toFixed(1)}% (${exactMatchedWords.length}/${expectedWords.length}) - matched: [${exactMatchedWords.join(', ')}]`);
    console.log(`Last ${lastNWords.length} words (fuzzy/phonetic): "${mergedUtterance}"`);
    console.log(`Cleaned utterance: "${hybridResult.cleanedUtterance || mergedUtterance}"`);
    if (hybridResult.removedFillers) {
      const utteranceFillers = hybridResult.removedFillers.fromUtterance || [];
      const targetFillers = hybridResult.removedFillers.fromTarget || [];
      if (utteranceFillers.length > 0 || targetFillers.length > 0) {
        console.log(`Removed fillers: utterance=[${utteranceFillers.join(', ')}], target=[${targetFillers.join(', ')}]`);
      }
    }
    console.log(`All spoken words: [${allSpokenWords.join(', ')}]`);
    console.log(`Fuzzy score:      ${((1 - hybridResult.fuzzyScore) * 100).toFixed(1)}% (higher=better)`);
    console.log(`Phonetic score:   ${((1 - hybridResult.phoneticScore) * 100).toFixed(1)}% (higher=better)`);
    console.log(`Fuzzy/Phonetic confidence: ${(confidence * 100).toFixed(1)}% (threshold: 60%)`);
    console.log(`---------------------------------`);

    // No match for current line - check if utterance matches next 3 sentences using sliding window
    let foundMatch = false;

    for (let offset = 1; offset <= 3; offset++) {
      if (foundMatch) break;

      const checkIndex = currentLineIndex + offset;
      if (checkIndex >= totalLines) break;  // Don't go beyond page

      const checkLine = state.pagesValues[state.page]?.text?.[checkIndex];
      if (!checkLine || !checkLine.Dialogue) continue;

      const checkText = stripSSMLTags(checkLine.Dialogue).toLowerCase().trim();
      const checkExpectedWords = checkText.split(/\s+/);
      const checkWordCount = checkExpectedWords.length;

      // Sliding window search within the queue
      if (checkWordCount <= allSpokenWordCount) {
        // Next line is shorter or equal - slide through queue
        const maxStartIndex = allSpokenWordCount - checkWordCount;
        for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
          const windowWords = allSpokenWords.slice(startIdx, startIdx + checkWordCount);
          const windowConfidence = calculateConfidence(windowWords, checkText);

          if (windowConfidence >= 0.6) {
            console.log(`Match found at line ${checkIndex} with window starting at ${startIdx}! Jumping ahead.`);
            foundMatch = true;

            // Clear queue: remove first N words
            accumulatedUtterancesRef.current = [];
            utteranceQueueRef.current = utteranceQueueRef.current.slice(checkWordCount);

            // Jump to the line AFTER the matched line, or last line if matched is last
            if (jumpToLine) {
              const jumpTarget = Math.min(checkIndex + 2, totalLines);  // +2 for next line, capped at last
              jumpToLine(jumpTarget);
            }
            break;
          }
        }
      } else {
        // Next line is longer than queue - use whole queue
        const checkConfidence = calculateConfidence(allSpokenWords, checkText);

        //console.log(`Checking line ${checkIndex} (full queue): "${allSpokenWords.join(' ')}" confidence: ${checkConfidence.toFixed(2)}`);

        if (checkConfidence >= 0.6) {
          foundMatch = true;

          // Clear first N words from queue
          accumulatedUtterancesRef.current = [];
          utteranceQueueRef.current = utteranceQueueRef.current.slice(checkWordCount);

          // Jump to the line AFTER the matched line, or last line if matched is last
          if (jumpToLine) {
            const jumpTarget = Math.min(checkIndex + 2, totalLines);  // +2 for next line, capped at last
            jumpToLine(jumpTarget);
          }
        }
      }
    }

    if (!foundMatch) {
      // Only slide the queue if we have at least as many words as the expected line
      // Otherwise, wait for more words to accumulate
      if (utteranceQueueRef.current.length >= expectedWordCount) {
        const removedWord = utteranceQueueRef.current.shift();
        console.log(`No match found. Sliding queue: removed "${removedWord}"`);
      } else {
        console.log(`Waiting for more words: ${utteranceQueueRef.current.length}/${expectedWordCount} words in queue`);
      }
    }
  }
}
