import nlp from "compromise";
import { categorizeOffScriptUtterances } from "./InnerThoughtProcess";
import { categorizeOffScriptUtterancesStreaming } from "./InnerThoughtProcessStream";
import { calculateHybridScore, findSubsequenceMatch } from "./speechMatcher";
import { normalizeText } from "./textNormalizer";
import { debugLog } from "./debugMonitor";

const USE_STREAMING = true;
const categorize = USE_STREAMING ? categorizeOffScriptUtterancesStreaming : categorizeOffScriptUtterances;
const VARIANT_SLOT_COUNT = 2;
const MID_SENTENCE_TAGS = new Set([
  'Determiner',      // "the", "a", "this"
  'Preposition',     // "to", "of", "in"
  'Conjunction',     // "and", "but", "because"
  'Auxiliary',        // "is", "was", "have"
]);
const MAX_OFFSCRIPT_BUFFER = 20;
let pendingOffScriptWords = [];
let pendingPOSBuffer = [];
let currentAbortController = null;
let deferredOffScriptEntries = [];
let deferredContext = null;
let isCategorizationPending = false;

function emptyQueues() {
  return Array.from({ length: VARIANT_SLOT_COUNT }, () => []);
}

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function calculateConfidenceDetail(spokenWords, expectedText, options = {}) {
  const mergedUtterance = spokenWords.filter(w => w.length > 0).join(' ');
  const result = calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.4,
    phoneticWeight: 0.6,
    matchThreshold: 0.6,
    ...options,
  });
  return { confidence: result.confidence, fuzzyScore: result.fuzzyScore, phoneticScore: result.phoneticScore };
}

function calculateConfidence(spokenWords, expectedText) {
  return calculateConfidenceDetail(spokenWords, expectedText).confidence;
}

function divideExpectedText(expectedText) {
  const words = expectedText[0].split(/\s+/).filter(w => w.length > 0);
  const totalWords = words.length;
  const percentages = [1.0, 0.75, 0.50, 0.25];
  const variants = [];

  for (const pct of percentages) {
    const keepCount = Math.ceil(totalWords * pct);
    if (keepCount < 3 && pct < 1.0) break;
    if (totalWords <= 4 && pct < 1.0) break;

    const startInd = totalWords - keepCount;
    const slicedText = expectedText.map(variant => {
      const varWords = variant.split(/\s+/).filter(w => w.length > 0);
      return varWords.slice(startInd).join(' ');
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

function clearMatchState({ accumulatedUtterancesRef, utteranceQueuesRef }, wordsToConsume) {
  accumulatedUtterancesRef.current = [];
  utteranceQueuesRef.current = utteranceQueuesRef.current.map(q => q.slice(wordsToConsume));
  emitQueueState(utteranceQueuesRef);
}

function isUtteranceComplete(text) {
  const doc = nlp(text);
  const terms = doc.termList();
  if (terms.length === 0) return true;

  const lastTerm = terms[terms.length - 1];
  const tags = Object.keys(lastTerm.tags || {});

  const isMidSentence = tags.some(t => MID_SENTENCE_TAGS.has(t));
  debugLog({ type: 'pos_check', word: lastTerm.text, tags, isMidSentence });
  return !isMidSentence;
}

export function abortCurrentCategorization() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  pendingOffScriptWords = [];
  pendingPOSBuffer = [];
  deferredOffScriptEntries = [];
  deferredContext = null;
  isCategorizationPending = false;
}

export function getIsCategorizationPending() {
  return isCategorizationPending;
}

// Capture off-script words into pending buffer, flush when POS says sentence is complete
function captureOffScriptWords(offScriptLogRef, lineIndex, leftoverWords, context) {
  if (!offScriptLogRef || leftoverWords.length === 0) return;

  // Always append to offScriptLogRef for page-change flushes from Story.js
  offScriptLogRef.current.push({ lineIndex, text: leftoverWords.join(' ') });
  debugLog({ type: 'offscript_update', entries: offScriptLogRef.current.map(e => ({ lineIndex: e.lineIndex, text: e.text })) });

  if (!context) return;

  // Remove words already sent in a previous flush
  const alreadySent = new Set(pendingOffScriptWords);
  const newWords = leftoverWords.filter(w => !alreadySent.has(w));
  if (newWords.length === 0) return;

  // Accumulate into POS buffer
  pendingPOSBuffer.push(...newWords);
  debugLog({ type: 'pos_buffer', words: pendingPOSBuffer.join(' '), count: pendingPOSBuffer.length });

  // Only flush when the sentence seems complete or the buffer is too large
  const bufferText = pendingPOSBuffer.join(' ');
  if (!isUtteranceComplete(bufferText) && pendingPOSBuffer.length < MAX_OFFSCRIPT_BUFFER) {
    debugLog({ type: 'offscript_hold', reason: 'mid_sentence', text: bufferText, wordCount: pendingPOSBuffer.length });
    return;
  }

  // Sentence complete or buffer full — flush
  debugLog({ type: 'pos_flush', reason: pendingPOSBuffer.length >= MAX_OFFSCRIPT_BUFFER ? 'buffer_full' : 'sentence_complete', text: bufferText });

  // Clear offScriptLogRef so these words aren't re-sent on page change
  offScriptLogRef.current = [];
  if (!isCategorizationPending) {
    // Prepend any entries that were deferred during a previous in-flight round
    const snapshot = [
      ...deferredOffScriptEntries,
      { lineIndex: lineIndex, text: bufferText },
    ];
    deferredOffScriptEntries = [];
    deferredContext = null;
    pendingOffScriptWords = [];
    pendingPOSBuffer = [];
    sendOffScriptLog(
      { current: snapshot },
      context.state.page,
      context.state,
      context.onCategorizationResult,
      context.imageDescriptionRef,
      context.userAttentionRef?.current,
      context.onCategorizationStart
    );
  } else {
    deferredOffScriptEntries.push({ lineIndex, text: bufferText });
    deferredContext = context;
    pendingPOSBuffer = [];
    debugLog({ type: 'offscript_deferred', lineIndex, text: bufferText, bufferSize: deferredOffScriptEntries.length });
  }
}

export async function sendOffScriptLog(offScriptLogRef, oldPage, state, onResult, imageDescriptionRef, userAttention, onStart) {
  if (!offScriptLogRef?.current?.length) return;

  const lines = state.pagesValues[oldPage]?.text || [];
  const currentPageQuestion = state.pagesValues[oldPage]?.question || '';
  const bookText = `Page ${oldPage + 1}:\n` +
    lines.map(l => `${l.Character}: ${stripSSMLTags(l.Dialogue)}`).join('\n');

  const lineMap = new Map();
  for (const { lineIndex, text } of offScriptLogRef.current) {
    const prev = lineMap.get(lineIndex);
    lineMap.set(lineIndex, prev ? prev + ' ' + text : text);
  }

  const formattedLog = [...lineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, text]) => `[Line ${idx + 1}] "${text}"`)
    .join('\n');

  offScriptLogRef.current = [];
  debugLog({ type: 'offscript_clear' });

  const controller = new AbortController();
  currentAbortController = controller;

  isCategorizationPending = true;
  onStart?.();
  try {
    const imageDescription = await (imageDescriptionRef?.current ?? Promise.resolve(null));
    const r = await categorize(formattedLog, currentPageQuestion, bookText, oldPage + 1, imageDescription, userAttention, controller.signal);
    if (controller.signal.aborted) return;
    onResult?.({ ...r, sourcePage: oldPage });
  } catch (err) {
    if (err.name === 'AbortError') return;  // clean exit, no error log
    console.error('Categorization error:', err);
    if (!controller.signal.aborted) {
      onResult?.({ sourcePage: oldPage });
    }
  } finally {
    if (currentAbortController === controller) {
      currentAbortController = null;
    }
    if (controller.signal.aborted) return;

    isCategorizationPending = false;
    if (deferredOffScriptEntries.length > 0 && deferredContext) {
      const entries = deferredOffScriptEntries;
      const ctx = deferredContext;
      deferredOffScriptEntries = [];
      deferredContext = null;
      debugLog({ type: 'offscript_deferred_flush', count: entries.length });
      sendOffScriptLog(
        { current: entries },
        ctx.state.page,
        ctx.state,
        ctx.onCategorizationResult,
        ctx.imageDescriptionRef,
        ctx.userAttentionRef?.current,
        ctx.onCategorizationStart
      );
    }
  }
}

function advanceToNextLine(setAudioHasEnded, setIsPlaying) {
  setAudioHasEnded(true);
  setIsPlaying(true);
}

function jumpToFutureLine(jumpToLine, checkIndex, totalLines) {
  if (!jumpToLine) return;
  setTimeout(() => jumpToLine(Math.min(checkIndex + 2, totalLines)), 100);
}

// Forward search uses slot 0 (expanded form) only — best-effort lookahead, simpler is fine.
function checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef, categorizationContext }) {
  const allSpokenWords = utteranceQueuesRef.current[0] || [];
  const allSpokenWordCount = allSpokenWords.length;


  for (let offset = 1; offset <= 3; offset++) {
    const checkIndex = currentLineIndex + offset;
    if (checkIndex >= totalLines) break;

    const checkLine = state.pagesValues[state.page]?.text?.[checkIndex];
    if (!checkLine?.Dialogue) continue;

    const checkText = normalizeText(stripSSMLTags(checkLine.Dialogue));
    const searchVariants = divideExpectedText(checkText);
    debugLog({ type: 'forward_search_start', lineIndex: checkIndex });

    for (const variant of searchVariants) {
      // Exact subsequence match
      const exactMatch = findSubsequenceMatch(variant.text, allSpokenWords);
      if (exactMatch !== null) {
        debugLog({ type: 'forward_exact_match', label: variant.label, lineIndex: checkIndex, startIdx: exactMatch.startIdx });
        captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, exactMatch.startIdx), categorizationContext); // 
        clearMatchState(refs, exactMatch.endIdx);
        jumpToFutureLine(jumpToLine, checkIndex, totalLines);
        return true;
      }

      if (variant.wordCount <= allSpokenWordCount) {
        const maxStartIndex = allSpokenWordCount - variant.wordCount;
        for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
          const windowWords = allSpokenWords.slice(startIdx, startIdx + variant.wordCount);
          const fwdDetail = calculateConfidenceDetail(windowWords, variant.text);
          if (fwdDetail.confidence >= 0.6) {
            debugLog({ type: 'forward_hybrid_match', label: variant.label, lineIndex: checkIndex, confidence: (fwdDetail.confidence * 100).toFixed(1), fuzzyScore: ((1 - fwdDetail.fuzzyScore) * 100).toFixed(1), phoneticScore: ((1 - fwdDetail.phoneticScore) * 100).toFixed(1) });
            captureOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, startIdx), categorizationContext);
            clearMatchState(refs, startIdx + variant.wordCount);
            jumpToFutureLine(jumpToLine, checkIndex, totalLines);
            return true;
          }
        }
      } else {
        if (calculateConfidence(allSpokenWords, variant.text) >= 0.6) {
          captureOffScriptWords(offScriptLogRef, checkIndex, [], categorizationContext); // 
          clearMatchState(refs, allSpokenWordCount);
          jumpToFutureLine(jumpToLine, checkIndex, totalLines);
          return true;
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
  offScriptLogRef,
  state,
  condition,
  speakerLabels,
  jumpToLine,
  setAudioHasEnded,
  setIsPlaying,
  onCategorizationResult,
  onCategorizationStart,
  imageDescriptionRef,
  userAttentionRef,
  questionGenEnabledRef
}) {
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];
  const categorizationContext = { state, onCategorizationResult, onCategorizationStart, imageDescriptionRef, userAttentionRef };

  if (currentLineTrackingRef.current.page !== state.page) {
    accumulatedUtterancesRef.current = [];
    utteranceQueuesRef.current = emptyQueues();
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  }

  if (!userUtterance) return;
  // After all lines on the page are read, collect into offScriptLogRef for post-page categorization
  // But only if the last line is no longer highlighted (i.e., already matched)
  if (totalLines > 0 && state.index >= totalLines && !currentLine?.Reading) {
    lastProcessedUtteranceRef.current = userUtterance;
    debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: '(post-last-line)', lineIndex: currentLineIndex });
    captureOffScriptWords(offScriptLogRef, totalLines, userUtterance.trim().split(/\s+/).filter(w => w.length > 0), categorizationContext);
    return;
  }

  if (!currentLine?.Reading) return;

  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = currentCharacter?.role === "Parent" || currentCharacter?.role === "Child" || currentCharacter?.role === "Dummy";

  if (!isUserReadingRole) {
    lastProcessedUtteranceRef.current = userUtterance;
    return;
  }

  accumulatedUtterancesRef.current.push({ speaker: speakerLabels || 'Unknown', utterance: userUtterance.toLowerCase().trim() });
  lastProcessedUtteranceRef.current = userUtterance;
  const uttVariants = normalizeText(userUtterance);
  const uttSlot0 = uttVariants[0].split(/\s+/).filter(w => w.length > 0);
  const uttSlot1 = (uttVariants[1] ?? uttVariants[0]).split(/\s+/).filter(w => w.length > 0);
  if (utteranceQueuesRef.current.length === 0) {
    utteranceQueuesRef.current = emptyQueues();
  }
  utteranceQueuesRef.current[0].push(...uttSlot0);
  utteranceQueuesRef.current[1].push(...uttSlot1);

  // Prepare expected text — same 2-slot structure: slot 0 expanded, slot 1 original.
  const rawDialogue = stripSSMLTags(currentLine.Dialogue)?.trim();
  if (!rawDialogue) return; // nothing to match against (pure SSML or empty line)
  const expVariants = normalizeText(rawDialogue);
  const expectedTexts = [expVariants[0], expVariants[1] ?? expVariants[0]];
  const expectedWordCount = expectedTexts[0].split(/\s+/).filter(w => w.length > 0).length;

  const refs = { accumulatedUtterancesRef, utteranceQueuesRef };

  debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: expectedTexts[0], lineIndex: currentLineIndex });
  emitQueueState(utteranceQueuesRef);

  const variantOrder = [1, 0];
  const allTriedLabels = [];

  for (const slot of variantOrder) {
    const allSpokenWords = utteranceQueuesRef.current[slot];
    const dividedSentences = divideExpectedText([expectedTexts[slot]]);

    for (const divSentence of dividedSentences) {
      const labelTag = `slot${slot}-${divSentence.label}`;
      allTriedLabels.push(labelTag);
      let bestDetail = { confidence: 0, fuzzyScore: 1, phoneticScore: 1 };

      // Exact subsequence match
      const exactMatch = findSubsequenceMatch(divSentence.text, allSpokenWords);
      if (exactMatch !== null) {
        debugLog({ type: 'exact_match', label: labelTag, startIdx: exactMatch.startIdx });
        captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, exactMatch.startIdx));
        clearMatchState(refs, exactMatch.endIdx);
        if (currentLineIndex === totalLines - 1) currentLine.Reading = false;
        advanceToNextLine(setAudioHasEnded, setIsPlaying);
        return;
      }

      // Sliding window hybrid (fuzzy + phonetic)
      if (condition === "C1" || condition === "C2") {
        const maxStartIndex = allSpokenWords.length - divSentence.wordCount;
        for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
          const window = allSpokenWords.slice(startIdx, startIdx + divSentence.wordCount);
          const detail = condition === "C2"
            ? calculateConfidenceDetail(window, divSentence.text, { fuzzyWeight: 0, phoneticWeight: 1 })
            : calculateConfidenceDetail(window, divSentence.text);
          if (detail.confidence >= 0.6) {
            debugLog({ type: 'hybrid_match', label: labelTag, startIdx, confidence: (detail.confidence * 100).toFixed(1), fuzzyScore: ((1 - detail.fuzzyScore) * 100).toFixed(1), phoneticScore: ((1 - detail.phoneticScore) * 100).toFixed(1) });
            captureOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, startIdx), categorizationContext);
            clearMatchState(refs, startIdx + divSentence.wordCount);
            if (currentLineIndex === totalLines - 1) currentLine.Reading = false;
            advanceToNextLine(setAudioHasEnded, setIsPlaying);
            return;
          }
          if (detail.confidence > bestDetail.confidence) bestDetail = detail;
        }
      }

      debugLog({
        type: 'variant_result', label: labelTag, reason: 'low_confidence',
        fuzzyScore: ((1 - bestDetail.fuzzyScore) * 100).toFixed(1),
        phoneticScore: ((1 - bestDetail.phoneticScore) * 100).toFixed(1),
        confidence: (bestDetail.confidence * 100).toFixed(1),
        queue: allSpokenWords.join(' ')
      });
    }
  }

  debugLog({ type: 'no_match', variantsTried: allTriedLabels.join(', ') });

  // Step 3: Check if user skipped ahead (next 3 lines)
  let foundMatch;
  if (condition === "C1") {
    foundMatch = checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef, categorizationContext });
  }

  // Step 4: Slide queue if no match found — remove 1 word from front, add to pending buffer
  if (!foundMatch) {
    captureOffScriptWords(offScriptLogRef, currentLineIndex, utteranceQueuesRef.current[0], categorizationContext);
    pendingOffScriptWords = [...utteranceQueuesRef.current[0]];
    const removed = utteranceQueuesRef.current[0].shift();
    utteranceQueuesRef.current[1].shift();
    debugLog({ type: 'queue_slide', removed });
  }
}
