import { categorizeOffScriptUtterances } from "./InnerThoughtProcess";
import { calculateHybridScore, findSubsequenceMatch } from "./intentMatcher";
import { normalizeText, splitIntoSentences, isMultiSentenceLong } from "./textNormalizer";
import { debugLog } from "./debugMonitor";

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function calculateConfidenceDetail(spokenWords, expectedText) {
  const mergedUtterance = spokenWords.filter(w => w.length > 0).join(' ');
  const result = calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.5,
    phoneticWeight: 0.5,
    matchThreshold: 0.6,
  });
  return { confidence: result.confidence, fuzzyScore: result.fuzzyScore, phoneticScore: result.phoneticScore };
}

function calculateConfidence(spokenWords, expectedText) {
  return calculateConfidenceDetail(spokenWords, expectedText).confidence;
}

function getSentenceSearchVariants(expectedText) {
  const words = expectedText[0].split(/\s+/).filter(w => w.length > 0);
  const totalWords = words.length;
  const percentages = [1.0, 0.75, 0.50, 0.25];
  const variants = [];

  for (const pct of percentages) {
    const keepCount = Math.ceil(totalWords * pct);
    if (keepCount < 3 && pct < 1.0) break;
    if (totalWords <= 8 && pct < 1.0) break;

    const startIdx = totalWords - keepCount;
    const slicedText = expectedText.map(variant => {
      const varWords = variant.split(/\s+/).filter(w => w.length > 0);
      return varWords.slice(startIdx).join(' ');
    });

    variants.push({
      text: slicedText,
      wordCount: keepCount,
      label: `${Math.round(pct * 100)}%`
    });
  }

  return variants;
}

function emitQueueState(utteranceQueuesRef) {
  const q = utteranceQueuesRef.current[0] || [];
  debugLog({ type: 'queue_state', wordCount: q.length, words: q.join(' ') });
}

function clearMatchState({ accumulatedUtterancesRef, utteranceQueuesRef, silenceTimeoutRef, pendingUtteranceRef }, wordsToConsume) {
  accumulatedUtterancesRef.current = [];
  utteranceQueuesRef.current = utteranceQueuesRef.current.map(q => q.slice(wordsToConsume));
  if (silenceTimeoutRef.current) {
    clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = null;
  }
  pendingUtteranceRef.current = "";
  emitQueueState(utteranceQueuesRef);
}

function captureOffScriptWords(offScriptLogRef, lineIndex, leftoverWords) {
  if (!offScriptLogRef || leftoverWords.length === 0) return;
  offScriptLogRef.current.push({ lineIndex, text: leftoverWords.join(' ') });
  debugLog({ type: 'offscript_update', entries: offScriptLogRef.current.map(e => ({ lineIndex: e.lineIndex, text: e.text })) });
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
  debugLog({ type: 'offscript_clear' });
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
      const searchVariants = getSentenceSearchVariants(checkText);
      debugLog({ type: 'forward_search_start', lineIndex: checkIndex, target });

      for (const variant of searchVariants) {
        for (const allSpokenWords of utteranceQueuesRef.current) {
          const allSpokenWordCount = allSpokenWords.length;

          // Exact subsequence match
          const exactMatch = findSubsequenceMatch(variant.text, allSpokenWords);
          if (exactMatch !== null) {
            console.log(`Exact subsequence match on future line ${checkIndex} (${variant.label} of "${target}") at position ${exactMatch.startIdx}!`);
            debugLog({ type: 'forward_exact_match', label: variant.label, lineIndex: checkIndex, startIdx: exactMatch.startIdx });
            captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, exactMatch.startIdx));
            clearMatchState(refs, exactMatch.endIdx);
            jumpToFutureLine(jumpToLine, checkIndex, totalLines);
            return true;
          }

          if (variant.wordCount <= allSpokenWordCount) {
            // Sliding window: try each window position
            const maxStartIndex = allSpokenWordCount - variant.wordCount;
            for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
              const windowWords = allSpokenWords.slice(startIdx, startIdx + variant.wordCount);
              const fwdDetail = calculateConfidenceDetail(windowWords, variant.text);
              if (fwdDetail.confidence >= 0.6) {
                console.log(`Match found at future line ${checkIndex} (${variant.label} of "${target}") with window at ${startIdx}! Jumping ahead.`);
                debugLog({ type: 'forward_hybrid_match', label: variant.label, lineIndex: checkIndex, confidence: (fwdDetail.confidence * 100).toFixed(1), fuzzyScore: ((1 - fwdDetail.fuzzyScore) * 100).toFixed(1), phoneticScore: ((1 - fwdDetail.phoneticScore) * 100).toFixed(1) });
                captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, startIdx));
                clearMatchState(refs, startIdx + variant.wordCount);
                jumpToFutureLine(jumpToLine, checkIndex, totalLines);
                return true;
              }
            }
          } else {
            // Queue shorter than future line — use full queue
            if (calculateConfidence(allSpokenWords, variant.text) >= 0.6) {
              captureOffScriptWords(offScriptLogRef, checkIndex, []);
              clearMatchState(refs, allSpokenWordCount);
              jumpToFutureLine(jumpToLine, checkIndex, totalLines);
              return true;
            }
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
    // Send sandwiched off-script words before moving to new line
    if (offScriptLogRef?.current?.length) {
      sendOffScriptLog(offScriptLogRef, state.page, state);
    }
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

  const primaryQueueSnapshot = utteranceQueuesRef.current[0] || [];
  debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: expectedText[0], lineIndex: currentLineIndex });
  debugLog({ type: 'queue_state', wordCount: primaryQueueSnapshot.length, words: primaryQueueSnapshot.join(' ') });

  // Try matching with progressive sentence trimming: 100% → 75% → 50% → 25%
  const searchVariants = getSentenceSearchVariants(expectedText);

  for (const variant of searchVariants) {
    debugLog({ type: 'variant_attempt', label: variant.label, text: variant.text[0], wordCount: variant.wordCount });
    let bestDetail = { confidence: 0, fuzzyScore: 1, phoneticScore: 1 };

    for (const allSpokenWords of utteranceQueuesRef.current) {
      // Exact subsequence match
      const exactMatch = findSubsequenceMatch(variant.text, allSpokenWords);
      if (exactMatch !== null) {
        console.log(`Exact subsequence match (${variant.label}) at position ${exactMatch.startIdx}!`);
        debugLog({ type: 'exact_match', label: variant.label, startIdx: exactMatch.startIdx });
        captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, exactMatch.startIdx));
        clearMatchState(refs, exactMatch.endIdx);
        if (currentLineIndex === totalLines - 1) {
          currentLine.Reading = false;
        }
        advanceToNextLine(setAudioHasEnded, setIsPlaying);
        return;
      }

      // Sliding window hybrid (fuzzy + phonetic)
      if (allSpokenWords.length >= variant.wordCount) {
        const maxStartIndex = allSpokenWords.length - variant.wordCount;
        for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
          const window = allSpokenWords.slice(startIdx, startIdx + variant.wordCount);
          const detail = calculateConfidenceDetail(window, variant.text);
          if (detail.confidence >= 0.6) {
            console.log(`Sliding window hybrid match (${variant.label}) at position ${startIdx}! Confidence: ${(detail.confidence * 100).toFixed(1)}%`);
            debugLog({ type: 'hybrid_match', label: variant.label, startIdx, confidence: (detail.confidence * 100).toFixed(1), fuzzyScore: ((1 - detail.fuzzyScore) * 100).toFixed(1), phoneticScore: ((1 - detail.phoneticScore) * 100).toFixed(1) });
            captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, startIdx));
            clearMatchState(refs, startIdx + variant.wordCount);
            if (currentLineIndex === totalLines - 1) {
              currentLine.Reading = false;
            }
            advanceToNextLine(setAudioHasEnded, setIsPlaying);
            return;
          }
          if (detail.confidence > bestDetail.confidence) bestDetail = detail;
        }
      }
    }

    // Variant failed — report reason
    const maxQueueLen = Math.max(...utteranceQueuesRef.current.map(q => q.length), 0);
    if (maxQueueLen < variant.wordCount) {
      debugLog({
        type: 'variant_result', label: variant.label,
        reason: 'insufficient_words', have: maxQueueLen, need: variant.wordCount
      });
    } else {
      const queueSnapshot = (utteranceQueuesRef.current[0] || []).join(' ');
      debugLog({
        type: 'variant_result', label: variant.label,
        reason: 'low_confidence',
        fuzzyScore: ((1 - bestDetail.fuzzyScore) * 100).toFixed(1),
        phoneticScore: ((1 - bestDetail.phoneticScore) * 100).toFixed(1),
        confidence: (bestDetail.confidence * 100).toFixed(1),
        queue: queueSnapshot
      });
    }
  }

  // Debug log (use first variant queue for logging)
  const primaryQueue = utteranceQueuesRef.current[0] || [];
  console.log(`--- No match for current line ---`);
  console.log(`Expected: "${expectedText.join(' | ')}" | User Utterance: [${primaryQueue.join(', ')}]`);
  console.log(`Tried ${searchVariants.length} sentence variant(s) (${searchVariants.map(v => v.label).join(', ')}) — no match >= 60%`);
  console.log(`---------------------------------`);
  debugLog({ type: 'no_match', variantsTried: searchVariants.map(v => v.label).join(', ') });

  // Step 3: Check if user skipped ahead (next 3 lines)
  const foundMatch = checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef });

  // Step 4: Slide queue if no match found
  if (!foundMatch) {
    if (primaryQueue.length >= expectedWordCount) {
      const removed = utteranceQueuesRef.current.map(q => q.shift());
      console.log(`No match found. Sliding queue: removed "${removed[0]}"`);
      debugLog({ type: 'queue_slide', removed: removed[0] });
      emitQueueState(utteranceQueuesRef);
    } else {
      console.log(`Waiting for more words: ${primaryQueue.length}/${expectedWordCount} words in queue`);
    }
  }
}
