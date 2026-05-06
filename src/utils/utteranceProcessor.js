import nlp from "compromise";
import { categorizeOffScriptUtterancesStreaming } from "./InnerThoughtProcessStream";
import { calculateHybridScore, findSubsequenceMatch } from "./speechMatcher";
import { normalizeText } from "./textNormalizer";
import { debugLog } from "./debugMonitor";

const VARIANT_SLOT_COUNT = 2;
const MID_SENTENCE_TAGS = new Set([
  'Determiner',      // "the", "a", "this"
  'Preposition',     // "to", "of", "in"
  'Conjunction',     // "and", "but", "because"
  'Auxiliary',        // "is", "was", "have"
]);
const MIN_OFFSCRIPT_FLUSH_WORDS = 4;
const MAX_OFFSCRIPT_BUFFER = 20;
let pendingPOSBuffer = [];
let currentAbortController = null;
let deferredOffScriptEntries = [];
let deferredContext = null;
let isCategorizationPending = false;
let awaitingQuestionAnswer = false;

export function setAwaitingQuestionAnswer(v) { awaitingQuestionAnswer = !!v; }

function clearLiveOffScriptState(offScriptLogRef) {
  pendingPOSBuffer = [];
  if (offScriptLogRef) {
    offScriptLogRef.current = [];
  }
}

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
  clearLiveOffScriptState();
  deferredOffScriptEntries = [];
  deferredContext = null;
  isCategorizationPending = false;
  awaitingQuestionAnswer = false;
}

export function getIsCategorizationPending() {
  return isCategorizationPending;
}

function flushStableOffScriptPhrase(lineIndex, context, force = false) {
  if (!context || pendingPOSBuffer.length === 0) return false;

  const bufferText = pendingPOSBuffer.join(' ');
  const isLargeEnough = pendingPOSBuffer.length >= MIN_OFFSCRIPT_FLUSH_WORDS;
  const isFull = pendingPOSBuffer.length >= MAX_OFFSCRIPT_BUFFER;

  if (!force && !isLargeEnough && !isFull) {
    debugLog({ type: 'offscript_hold', reason: 'min_words', text: bufferText, wordCount: pendingPOSBuffer.length });
    return false;
  }

  if (!force && !isUtteranceComplete(bufferText) && !isFull) {
    debugLog({ type: 'offscript_hold', reason: 'mid_sentence', text: bufferText, wordCount: pendingPOSBuffer.length });
    return false;
  }

  debugLog({ type: 'pos_flush', reason: isFull ? 'buffer_full' : force ? 'forced' : 'sentence_complete', text: bufferText });

  if (!isCategorizationPending) {
    const snapshot = [
      ...deferredOffScriptEntries,
      { lineIndex: lineIndex, text: bufferText },
    ];
    deferredOffScriptEntries = [];
    deferredContext = null;
    clearLiveOffScriptState();
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
    clearLiveOffScriptState();
    debugLog({ type: 'offscript_deferred', lineIndex, text: bufferText, bufferSize: deferredOffScriptEntries.length });
  }
  return true;
}

// Capture stable off-script words that have been consumed from the matching queue.
function captureStableOffScriptWords(offScriptLogRef, lineIndex, stableWords, context) {
  if (!offScriptLogRef || !Array.isArray(stableWords) || stableWords.length === 0) return;

  const words = stableWords.map(w => String(w || '').trim()).filter(Boolean);
  if (words.length === 0) return;

  offScriptLogRef.current.push({ lineIndex, text: words.join(' ') });
  debugLog({ type: 'offscript_update', entries: offScriptLogRef.current.map(e => ({ lineIndex: e.lineIndex, text: e.text })) });

  if (!context) return;

  pendingPOSBuffer.push(...words);
  debugLog({ type: 'pos_buffer', words: pendingPOSBuffer.join(' '), count: pendingPOSBuffer.length });

  if (flushStableOffScriptPhrase(lineIndex, context)) {
    clearLiveOffScriptState(offScriptLogRef);
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
    const r = await categorizeOffScriptUtterancesStreaming(formattedLog, currentPageQuestion, bookText, oldPage + 1, imageDescription, userAttention, controller.signal);
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

function advanceToNextLine(setAudioHasEnded, setIsPlaying, onAutoLineAdvance) {
  onAutoLineAdvance?.();
  setAudioHasEnded(true);
  setIsPlaying(true);
}

function jumpToFutureLine(jumpToLine, checkIndex, totalLines, onAutoLineAdvance) {
  if (!jumpToLine) return;
  setTimeout(() => {
    onAutoLineAdvance?.();
    jumpToLine(Math.min(checkIndex + 2, totalLines));
  }, 100);
}

function getMaxReadableLookbackWords(state, currentLineIndex, totalLines) {
  let maxWords = 1;

  for (let offset = 0; offset <= 3; offset++) {
    const lineIndex = currentLineIndex + offset;
    if (lineIndex >= totalLines) break;

    const line = state.pagesValues[state.page]?.text?.[lineIndex];
    if (!line?.Dialogue) continue;

    const normalized = normalizeText(stripSSMLTags(line.Dialogue));
    const wordCount = normalized[0].split(/\s+/).filter(w => w.length > 0).length;
    maxWords = Math.max(maxWords, wordCount);
  }

  return maxWords;
}

// Forward search uses slot 0 (expanded form) only — best-effort lookahead, simpler is fine.
function checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef, categorizationContext, onAutoLineAdvance }) {
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
        captureStableOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, exactMatch.startIdx), categorizationContext);
        clearMatchState(refs, exactMatch.endIdx);
        jumpToFutureLine(jumpToLine, checkIndex, totalLines, onAutoLineAdvance);
        return true;
      }

      if (variant.wordCount <= allSpokenWordCount) {
        const maxStartIndex = allSpokenWordCount - variant.wordCount;
        for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
          const windowWords = allSpokenWords.slice(startIdx, startIdx + variant.wordCount);
          const fwdDetail = calculateConfidenceDetail(windowWords, variant.text);
          if (fwdDetail.confidence >= 0.6) {
            debugLog({ type: 'forward_hybrid_match', label: variant.label, lineIndex: checkIndex, confidence: (fwdDetail.confidence * 100).toFixed(1), fuzzyScore: ((1 - fwdDetail.fuzzyScore) * 100).toFixed(1), phoneticScore: ((1 - fwdDetail.phoneticScore) * 100).toFixed(1) });
            captureStableOffScriptWords(offScriptLogRef, checkIndex, allSpokenWords.slice(0, startIdx), categorizationContext);
            clearMatchState(refs, startIdx + variant.wordCount);
            jumpToFutureLine(jumpToLine, checkIndex, totalLines, onAutoLineAdvance);
            return true;
          }
        }
      } else {
        if (calculateConfidence(allSpokenWords, variant.text) >= 0.6) {
          captureStableOffScriptWords(offScriptLogRef, checkIndex, [], categorizationContext);
          clearMatchState(refs, allSpokenWordCount);
          jumpToFutureLine(jumpToLine, checkIndex, totalLines, onAutoLineAdvance);
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
  onAutoLineAdvance,
  onCategorizationResult,
  onCategorizationStart,
  imageDescriptionRef,
  userAttentionRef,
  questionGenEnabledRef,
  onQuestionAnswered
}) {
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];
  const canCategorizeLive = questionGenEnabledRef?.current !== false && Boolean(onCategorizationResult || onCategorizationStart);
  const categorizationContext = canCategorizeLive
    ? { state, onCategorizationResult, onCategorizationStart, imageDescriptionRef, userAttentionRef }
    : null;

  if (currentLineTrackingRef.current.page !== state.page) {
    accumulatedUtterancesRef.current = [];
    utteranceQueuesRef.current = emptyQueues();
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  }

  if (!userUtterance) return;

  const wasAwaiting = awaitingQuestionAnswer;
  awaitingQuestionAnswer = false;

  // If we just asked a generated follow-up question, treat this utterance purely as the
  // reply — route it to reinforcement and skip categorization so it doesn't seed another
  // question.
  if (wasAwaiting) {
    lastProcessedUtteranceRef.current = userUtterance;
    debugLog({ type: 'question_reply_captured', utterance: userUtterance });
    onQuestionAnswered?.(userUtterance);
    return;
  }

  // After all lines on the page are read, collect into offScriptLogRef for post-page categorization
  // But only if the last line is no longer highlighted (i.e., already matched)
  if (totalLines > 0 && state.index >= totalLines && !currentLine?.Reading) {
    lastProcessedUtteranceRef.current = userUtterance;
    debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: '(post-last-line)', lineIndex: currentLineIndex });
    captureStableOffScriptWords(offScriptLogRef, totalLines, userUtterance.trim().split(/\s+/).filter(w => w.length > 0), categorizationContext);
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
  const maxReadableLookbackWords = getMaxReadableLookbackWords(state, currentLineIndex, totalLines);

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
        captureStableOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, exactMatch.startIdx), categorizationContext);
        clearMatchState(refs, exactMatch.endIdx);
        if (currentLineIndex === totalLines - 1) currentLine.Reading = false;
        advanceToNextLine(setAudioHasEnded, setIsPlaying, onAutoLineAdvance);
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
            captureStableOffScriptWords(offScriptLogRef, currentLineIndex, allSpokenWords.slice(0, startIdx), categorizationContext);
            clearMatchState(refs, startIdx + divSentence.wordCount);
            if (currentLineIndex === totalLines - 1) currentLine.Reading = false;
            advanceToNextLine(setAudioHasEnded, setIsPlaying, onAutoLineAdvance);
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
    foundMatch = checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef, categorizationContext, onAutoLineAdvance });
  }

  // Step 4: Release only words that are no longer needed for current/future line matching.
  if (!foundMatch) {
    const queue = utteranceQueuesRef.current[0] || [];
    const wordsToRelease = Math.max(1, queue.length - maxReadableLookbackWords);
    const removedWords = utteranceQueuesRef.current[0].splice(0, wordsToRelease);
    utteranceQueuesRef.current[1].splice(0, wordsToRelease);
    captureStableOffScriptWords(offScriptLogRef, currentLineIndex, removedWords, categorizationContext);
    debugLog({ type: 'queue_slide', removed: removedWords.join(' '), count: removedWords.length, retained: utteranceQueuesRef.current[0].length });
  }
}
