import nlp from "compromise";
import { categorizeOffScriptUtterancesStreaming, streamReinforcement } from "./InnerThoughtProcessStream";
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
let pendingPOSBuffer = [];
let currentAbortController = null;
let deferredOffScriptEntries = [];
let deferredContext = null;
let isCategorizationPending = false;
let awaitingQuestionAnswer = false;
let lastCategorizationContext = null;
let lastSpeculativeSnapshot = '';
let speculativeLineEntries = [];
let lastReinforcementSnapshot = '';
let currentBookId = null;
let reinforcementTurns = [];

export function setReinforcementTurns(turns) {
  reinforcementTurns = Array.isArray(turns) ? turns : [];
}

// Minimum number of words the child must speak before a generated-question
const MIN_ANSWER_WORDS = 3;

export function resetReinforcementSnapshot() {
  lastReinforcementSnapshot = '';
}

export function setCurrentBookId(v) { currentBookId = v; }

export function setAwaitingQuestionAnswer(v) { awaitingQuestionAnswer = !!v; }

function clearLiveOffScriptState(offScriptLogRef) {
  pendingPOSBuffer = [];
  if (offScriptLogRef) {
    offScriptLogRef.current = [];
  }
}

export function resetOffScriptStateForPage(offScriptLogRef) {
  pendingPOSBuffer = [];
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
  reinforcementTurns = [];
  if (offScriptLogRef) {
    offScriptLogRef.current = [];
  }
  debugLog({ type: 'offscript_reset_page' });
}

function emptyQueues() {
  return Array.from({ length: VARIANT_SLOT_COUNT }, () => []);
}

function stripSSMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

export function buildBookContext(pagesValues, centerPage) {
  if (!Array.isArray(pagesValues) || !pagesValues.length) return '';
  const start = Math.max(0, centerPage - 1);
  const end = Math.min(pagesValues.length - 1, centerPage);
  const sections = [];
  for (let p = start; p <= end; p++) {
    const lines = pagesValues[p]?.text || [];
    sections.push(
      `Page ${p + 1}:\n` +
      lines.map(l => `${l.Character}: ${stripSSMLTags(l.Dialogue)}`).join('\n')
    );
  }
  return sections.join('\n\n');
}

function calculateConfidenceDetail(spokenWords, expectedText, options = {}) {
  const mergedUtterance = spokenWords.filter(w => w.length > 0).join(' ');
  const result = calculateHybridScore(mergedUtterance, expectedText, {
    exactWordWeight: 0.0,
    fuzzyWeight: 0.4,
    phoneticWeight: 0.6,
    matchThreshold: 0.7,
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
    if (totalWords <= 6 && pct < 1.0) break;

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
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
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
  lastCategorizationContext = null;
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
  isCategorizationPending = false;
  awaitingQuestionAnswer = false;
}

export function getIsCategorizationPending() {
  return isCategorizationPending;
}

function computeSpeculativeDelta(previous, current) {
  if (!previous) return current;
  const prevWords = previous.split(/\s+/).filter(Boolean);
  const currWords = current.split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, currWords.length);
  for (let i = maxOverlap; i > 0; i--) {
    const prevTail = prevWords.slice(prevWords.length - i).join(' ');
    const currHead = currWords.slice(0, i).join(' ');
    if (prevTail === currHead) {
      return currWords.slice(i).join(' ');
    }
  }
  return current;
}

function sendSpeculativeQueueSnapshot(utteranceQueuesRef, lineIndex, context, maxLookback, transcriptEndedTerminal, sourceText) { // only send if we have a terminal punctuation (end of sentence)
  if (!context) return;
  const sourceSnapshot = sourceText
    ? normalizeText(sourceText)[0].split(/\s+/).filter(w => w.length > 0)
    : [];
  const usingSourceCopy = sourceSnapshot.length > 0;
  const snapshot = usingSourceCopy ? sourceSnapshot : (utteranceQueuesRef?.current?.[0] || []);
  if (snapshot.length === 0) return;
  if (!usingSourceCopy && typeof maxLookback === 'number' && snapshot.length > maxLookback) {
    return;
  }
  if (!transcriptEndedTerminal) {
    return;
  }
  const text = snapshot.join(' ');
  if (text === lastSpeculativeSnapshot) return;
  if (!isUtteranceComplete(text)) {
    return;
  }
  const previous = lastSpeculativeSnapshot;
  const delta = computeSpeculativeDelta(previous, text);
  lastSpeculativeSnapshot = text;
  const trimmedDelta = delta.trim();
  if (trimmedDelta) {
    speculativeLineEntries.push({ lineIndex, turn: speculativeLineEntries.length + 1, text: trimmedDelta });
  }

  sendOffScriptLog(
    { current: [...speculativeLineEntries] },
    context.state.page,
    context.state,
    context.onCategorizationResult,
    context.imageDescriptionRef,
    context.userAttentionRef?.current,
    context.onCategorizationStart,
    context.pendingGeneratedQuestionRef?.current || null,
    context.ttsVoiceName || null,
    context.onAudioChunk || null,
    context.onAudioEnd || null,
    context.onAudioError || null,
    context.onQuestionReady || null
  );
}

// Capture stable off-script words that have been consumed from the matching queue.
function captureStableOffScriptWords(offScriptLogRef, lineIndex, stableWords, context) {
  if (!offScriptLogRef || !Array.isArray(stableWords) || stableWords.length === 0) return;

  const words = stableWords.map(w => String(w || '').trim()).filter(Boolean);
  if (words.length === 0) return;

  offScriptLogRef.current.push({ lineIndex, text: words.join(' ') });

  if (!context) return;

  lastCategorizationContext = context;

  pendingPOSBuffer.push(...words);
  debugLog({ type: 'pos_buffer', words: pendingPOSBuffer.join(' '), count: pendingPOSBuffer.length });
}

export async function sendOffScriptLog(offScriptLogRef, oldPage, state, onResult, imageDescriptionRef, userAttention, onStart, pendingGeneratedQuestion, ttsVoiceName, onAudioChunk, onAudioEnd, onAudioError, onQuestionReady) {
  if (!offScriptLogRef?.current?.length) return;

  const currentPageQuestion = state.pagesValues[oldPage]?.question || '';
  const bookText = buildBookContext(state.pagesValues, oldPage);
  const turnLines = [];
  const lineMap = new Map();
  for (const { lineIndex, text, turn } of offScriptLogRef.current) {
    if (turn != null) {
      turnLines.push(`[Line ${lineIndex + 1}, Turn ${turn}] "${text}"`);
    } else {
      const prev = lineMap.get(lineIndex);
      lineMap.set(lineIndex, prev ? prev + ' ' + text : text);
    }
  }

  const mergedLines = [...lineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, text]) => `[Line ${idx + 1}] "${text}"`);

  const refLine = (offScriptLogRef.current[0]?.lineIndex ?? oldPage) + 1;
  const conversationLines = [];
  let convTurn = 0;
  for (const { user, response } of reinforcementTurns) {
    if (user) conversationLines.push(`[Line ${refLine}, Turn ${++convTurn}] "${user}"`);
    if (response) conversationLines.push(`[Line ${refLine}, Turn ${++convTurn}] (System) "${response}"`);
  }

  const formattedLog = [...conversationLines, ...mergedLines, ...turnLines].join('\n');

  offScriptLogRef.current = [];
  debugLog({ type: 'offscript_clear' });

  const controller = new AbortController();
  currentAbortController = controller;

  isCategorizationPending = true;
  onStart?.();
  try {
    const imageDescription = await (imageDescriptionRef?.current ?? Promise.resolve(null));
    const r = await categorizeOffScriptUtterancesStreaming(formattedLog, currentPageQuestion, bookText, oldPage + 1, imageDescription, userAttention, pendingGeneratedQuestion, ttsVoiceName, onAudioChunk, onAudioEnd, onAudioError, onQuestionReady, controller.signal, currentBookId);
    if (controller.signal.aborted) return;
    onResult?.({ ...r, sourcePage: oldPage });
  } catch (err) {
    if (err.name === 'AbortError') return;
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
        ctx.onCategorizationStart,
        ctx.pendingGeneratedQuestionRef?.current || null,
        ctx.ttsVoiceName || null,
        ctx.onAudioChunk || null,
        ctx.onAudioEnd || null,
        ctx.onAudioError || null,
        ctx.onQuestionReady || null
      );
    }
  }
}

export async function sendReinforcementLog({
  reply,
  question,
  currentPageQuestion,
  bookText,
  currentPageNumber,
  imageDescriptionRef,
  userAttention,
  reinforcementHistory,
  expectedAnswer,
  ttsVoiceName,
  onReinforcementReady,
  onAudioChunk,
  onAudioEnd,
  onAudioError,
  signal,
}) {
  if (!reply) return null;
  const imageDescription = await (imageDescriptionRef?.current ?? Promise.resolve(null));
  return streamReinforcement({
    question,
    reply,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    book: currentBookId,
    imageDescription,
    userAttention,
    reinforcementHistory,
    expectedAnswer,
    ttsVoiceName,
    onReinforcementReady,
    onAudioChunk,
    onAudioEnd,
    onAudioError,
    signal,
  });
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

  for (let offset = 0; offset <= 1; offset++) {
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


  for (let offset = 1; offset <= 2; offset++) {
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
  speakerLabels,
  jumpToLine,
  setAudioHasEnded,
  setIsPlaying,
  onAutoLineAdvance,
  onCategorizationResult,
  onCategorizationStart,
  imageDescriptionRef,
  userAttentionRef,
  pendingGeneratedQuestionRef,
  ttsVoiceName,
  onAudioChunk,
  onAudioEnd,
  onAudioError,
  onQuestionReady,
  questionGenEnabledRef,
  isReinforcementModeRef,
  generatedQuestionPendingRef,
  onQuestionAnswered,
  onReinforcementUtterance
}) {
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];

  if (!userUtterance) return;

  const wasAwaiting = awaitingQuestionAnswer;
  const ackInProgress = isReinforcementModeRef?.current === true;
  awaitingQuestionAnswer = false;

  const fireReinforcement = () => {
    const text = (userUtterance || '').trim();
    if (!text) return;

    const answerWordCount = text.split(/\s+/).filter(Boolean).length;

    if (answerWordCount < MIN_ANSWER_WORDS) {
      if (wasAwaiting) awaitingQuestionAnswer = true;
      debugLog({ type: 'reinforcement_gate_skip', reason: 'too_few_words', utterance: text, wordCount: answerWordCount });
      return;
    }
    if (!/[.?!]\s*$/.test(text)) {
      if (wasAwaiting) awaitingQuestionAnswer = true;
      debugLog({ type: 'reinforcement_gate_skip', reason: 'no_terminal_punct', utterance: text });
      return;
    }
    if (text === lastReinforcementSnapshot) {
      if (wasAwaiting) awaitingQuestionAnswer = true;
      debugLog({ type: 'reinforcement_gate_skip', reason: 'duplicate', utterance: text });
      return;
    }
    if (!isUtteranceComplete(text)) {
      if (wasAwaiting) awaitingQuestionAnswer = true;
      debugLog({ type: 'reinforcement_gate_skip', reason: 'pos_incomplete', utterance: text });
      return;
    }
    lastReinforcementSnapshot = text;
    debugLog({ type: wasAwaiting ? 'question_reply_captured' : 'reinforcement_reply_captured', utterance: text });
    (wasAwaiting ? onQuestionAnswered : onReinforcementUtterance)?.(text);
  };

  const generatedQuestionPending = generatedQuestionPendingRef?.current === true;
  const canCategorizeLive = !wasAwaiting && !ackInProgress && !generatedQuestionPending && questionGenEnabledRef?.current !== false && Boolean(onCategorizationResult || onCategorizationStart);
  const categorizationContext = canCategorizeLive
    ? { state, onCategorizationResult, onCategorizationStart, imageDescriptionRef, userAttentionRef, pendingGeneratedQuestionRef, ttsVoiceName, onAudioChunk, onAudioEnd, onAudioError, onQuestionReady }
    : null;

  if (currentLineTrackingRef.current.page !== state.page) {
    accumulatedUtterancesRef.current = [];
    utteranceQueuesRef.current = emptyQueues();
    lastSpeculativeSnapshot = '';
    speculativeLineEntries = [];
    lastReinforcementSnapshot = '';
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  }

  if (totalLines > 0 && state.index >= totalLines && !currentLine?.Reading) {
    lastProcessedUtteranceRef.current = userUtterance;
    debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: '(post-last-line)', lineIndex: currentLineIndex });

    if (wasAwaiting) {
      fireReinforcement();
      return;
    }

    captureStableOffScriptWords(offScriptLogRef, totalLines, userUtterance.trim().split(/\s+/).filter(w => w.length > 0), categorizationContext);

    if (categorizationContext) {
      const text = userUtterance.trim();
      const transcriptEndedTerminal = /[.?!]\s*$/.test(text);
      if (transcriptEndedTerminal && text && text !== lastSpeculativeSnapshot && isUtteranceComplete(text)) {
        speculativeLineEntries.push({ lineIndex: totalLines, turn: speculativeLineEntries.length + 1, text });
        lastSpeculativeSnapshot = text;
        sendOffScriptLog(
          { current: [...speculativeLineEntries] },
          categorizationContext.state.page,
          categorizationContext.state,
          categorizationContext.onCategorizationResult,
          categorizationContext.imageDescriptionRef,
          categorizationContext.userAttentionRef?.current,
          categorizationContext.onCategorizationStart,
          categorizationContext.pendingGeneratedQuestionRef?.current || null,
          categorizationContext.ttsVoiceName || null,
          categorizationContext.onAudioChunk || null,
          categorizationContext.onAudioEnd || null,
          categorizationContext.onAudioError || null,
          categorizationContext.onQuestionReady || null
        );
      }
    }
    return;
  }

  if (!currentLine?.Reading) {
    if (wasAwaiting) {
      lastProcessedUtteranceRef.current = userUtterance;
      fireReinforcement();
    }
    return;
  }

  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = currentCharacter?.role === "Parent" || currentCharacter?.role === "Child" || currentCharacter?.role === "Dummy";

  if (!isUserReadingRole) {
    lastProcessedUtteranceRef.current = userUtterance;
    if (wasAwaiting) {
      fireReinforcement();
    }
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

  const rawDialogue = stripSSMLTags(currentLine.Dialogue)?.trim();
  if (!rawDialogue) {
    if (wasAwaiting) {
      fireReinforcement();
    }
    return; // nothing to match against (pure SSML or empty line)
  }
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

      // Sliding window hybrid (fuzzy + phonetic) match.
      const maxStartIndex = allSpokenWords.length - divSentence.wordCount;
      for (let startIdx = 0; startIdx <= maxStartIndex; startIdx++) {
        const window = allSpokenWords.slice(startIdx, startIdx + divSentence.wordCount);
        const detail = calculateConfidenceDetail(window, divSentence.text);
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

  // Step 3: Check if user skipped ahead (next 3 lines).
  const foundMatch = checkFutureLines({ utteranceQueuesRef, currentLineIndex, totalLines, state, refs, jumpToLine, offScriptLogRef, categorizationContext, onAutoLineAdvance });

  if (foundMatch) {
    return;
  }

  const queue = utteranceQueuesRef.current[0] || [];
  const wordsToRelease = Math.max(0, queue.length - maxReadableLookbackWords);
  const removedWords = utteranceQueuesRef.current[0].splice(0, wordsToRelease);
  utteranceQueuesRef.current[1].splice(0, wordsToRelease);
  debugLog({ type: 'queue_slide', removed: removedWords.join(' '), count: removedWords.length, retained: utteranceQueuesRef.current[0].length });

  if (wasAwaiting) {
    fireReinforcement();
    return;
  }

  const transcriptEndedTerminal = /[.?!]\s*$/.test(userUtterance);
  if (transcriptEndedTerminal) {
    console.log('Transcript ended with terminal punctuation sending offscripts:', userUtterance);
  }
  else {  
    console.log('Transcript not ended with terminal punctuation:', userUtterance);
  }
  sendSpeculativeQueueSnapshot(utteranceQueuesRef, currentLineIndex, categorizationContext, maxReadableLookbackWords, transcriptEndedTerminal, userUtterance);
}
