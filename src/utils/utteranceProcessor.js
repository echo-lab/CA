import { categorizeOffScriptUtterancesStreaming, streamAcknowledgement } from "./InnerThoughtProcessStream";
import { calculateHybridScore, findSubsequenceMatch } from "./speechMatcher";
import { normalizeText } from "./textNormalizer";
import { debugLog } from "./debugMonitor";
import { isHumanRead } from "./roles";

const VARIANT_SLOT_COUNT = 2;
let currentAbortController = null;
let deferredOffScriptEntries = [];
let deferredContext = null;
let isCategorizationPending = false;
let awaitingQuestionAnswer = false;
let lastSpeculativeSnapshot = '';
let speculativeLineEntries = [];
let currentBookId = null;
let acknowledgementTurns = [];

export function setAcknowledgementTurns(turns) {
  acknowledgementTurns = Array.isArray(turns) ? turns : [];
}

export function clearSpeculativeOffScript() {
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
}

export function setCurrentBookId(v) { currentBookId = v; }

// The current page's image tags, so a click-question book can be given real
// clickable regions to choose an answer from. Module state rather than a
// parameter because sendOffScriptLog is also called from the deferred path,
// which has no access to component state.
let clickTags = [];
export function setClickTags(tags) { clickTags = Array.isArray(tags) ? tags : []; }

// Opening the answer window also starts capturing. There is no "begin answering"
// click: the mic is already live, so everything said between the question ending
// and the submit press is the answer.
export function setAwaitingQuestionAnswer(v) {
  const opening = !!v && !awaitingQuestionAnswer;
  if (opening) {
    // A categorize request started while the question was still an unclicked
    // thought can outlive the click. Left running it delivers a question in the
    // middle of the answer, which resets the bubble to a fresh thought while the
    // answer sits unsent in the buffer. Nothing said from here belongs to that
    // request anyway — it is the answer now. Must run BEFORE the assignment
    // below: abortCurrentCategorization clears awaitingQuestionAnswer itself.
    abortCurrentCategorization();
  }
  awaitingQuestionAnswer = !!v;
  if (opening) {
    manualAnswerBuffer = [];
    manualAnswerDraining = false;
    debugLog({ type: 'answer_window_open' });
  }
}

const ANSWER_DRAIN_MS = 2500;

let manualAnswerBuffer = [];
let manualAnswerDraining = false;
let finishDrain = null;

// Submits what has been captured since the question ended. Resolves once the
// trailing transcript lands, or once the drain times out — whichever comes first.
export function endManualAnswer({ drainMs = ANSWER_DRAIN_MS } = {}) {
  manualAnswerDraining = true;
  awaitingQuestionAnswer = false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      manualAnswerDraining = false;
      finishDrain = null;
      const text = manualAnswerBuffer.join(' ').trim();
      manualAnswerBuffer = [];
      debugLog({ type: 'manual_answer_end', utterance: text, reason });
      resolve(text);
    };
    const timer = setTimeout(() => finish('drain_timeout'), drainMs);
    finishDrain = () => finish('tail_received');
  });
}

export function cancelManualAnswer() {
  if (!awaitingQuestionAnswer && !manualAnswerDraining && manualAnswerBuffer.length === 0) return;
  awaitingQuestionAnswer = false;
  manualAnswerBuffer = [];
  // Buffer is already cleared, so a drain still in flight resolves empty and the
  // caller skips the request — a page turn must not fire a stale answer.
  if (finishDrain) finishDrain('cancelled');
  manualAnswerDraining = false;
  debugLog({ type: 'manual_answer_cancel' });
}

// True while the mic is being treated as the answer to a pending question.
export function isManualAnswerActive() { return awaitingQuestionAnswer; }

function clearLiveOffScriptState(offScriptLogRef) {
  pendingFragment = null;
  if (offScriptLogRef) {
    offScriptLogRef.current = [];
  }
}

export function resetOffScriptStateForPage(offScriptLogRef) {
  pendingFragment = null;
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
  acknowledgementTurns = [];
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

function endsTerminal(text) {
  return /[.?!]\s*$/.test(String(text || '').trim());
}

// Deepgram cuts a final at every pause, so a child listing things ("my books,
// game cards,") produces finals that stop mid-sentence. Those used to be dropped
// outright — the words never reached categorization at all. Hold one instead and
// prepend it to the speaker's next final.
//
// Never across speakers: if someone else talks next, the held fragment goes out as
// its own line rather than being glued to a different person's words.
let pendingFragment = null; // { text, speaker, lineIndex }

function speakerOf(label) {
  return String(label || 'Unknown');
}

// Returns the entries ready to categorize now, in order. Anything still waiting
// for its continuation stays in pendingFragment.
function resolveUtterances({ text, speaker, lineIndex }) {
  const incoming = String(text || '').trim();
  if (!incoming) return [];

  const who = speakerOf(speaker);
  const out = [];
  const held = pendingFragment;
  pendingFragment = null;

  let carried = incoming;
  if (held) {
    if (held.speaker === who && held.lineIndex === lineIndex) {
      carried = `${held.text} ${incoming}`;
      debugLog({ type: 'fragment_merged', held: held.text, incoming, speaker: who });
    } else {
      // A different voice (or a new line) took over, so the fragment is its own
      // utterance — emitted unfinished rather than lost or misattributed.
      out.push({ text: held.text, lineIndex: held.lineIndex });
      debugLog({ type: 'fragment_flushed_speaker_change', held: held.text, heldSpeaker: held.speaker, nextSpeaker: who });
    }
  }

  if (endsTerminal(carried)) {
    out.push({ text: carried, lineIndex });
  } else {
    pendingFragment = { text: carried, speaker: who, lineIndex };
    debugLog({ type: 'fragment_held', text: carried, speaker: who });
  }
  return out;
}

// ponytail: a fragment whose speaker never says anything else is dropped at the
// next page turn or abort. Add an idle-timer flush if sessions show real content
// stranded there — the debugLog above makes it visible either way.

// Cancels an in-flight question request without disturbing the answer window.
// abortCurrentCategorization clears awaitingQuestionAnswer, which would throw away
// an answer already being captured — this is for the case where the reader has
// committed to the question already on screen and the one being generated behind
// it is no longer wanted.
export function abortQuestionGeneration() {
  const wasRunning = !!currentAbortController || isCategorizationPending;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  isCategorizationPending = false;
  // The speculative entries belong to the request just abandoned.
  lastSpeculativeSnapshot = '';
  speculativeLineEntries = [];
  if (wasRunning) debugLog({ type: 'question_generation_aborted' });
  return wasRunning;
}

export function abortCurrentCategorization() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  clearLiveOffScriptState();
  deferredOffScriptEntries = [];
  deferredContext = null;
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
    context.questionHistoryRef?.current || [],
    context.ttsVoiceName || null,
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

}

export async function sendOffScriptLog(offScriptLogRef, oldPage, state, onResult, imageDescriptionRef, userAttention, onStart, questionHistory, ttsVoiceName, onAudioError, onQuestionReady) {
  if (!offScriptLogRef?.current?.length) return;

  const currentPageQuestion = state.pagesValues[oldPage]?.question || '';
  const systemQuestions = (state.pagesValues || [])
    .map((p) => (p?.question || '').trim())
    .filter(Boolean);
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
  for (const { question, user, response } of acknowledgementTurns) {
    if (question) conversationLines.push(`[Line ${refLine}, Turn ${++convTurn}] (JENNIE Generated Question) "${question}"`);
    if (user) conversationLines.push(`[Line ${refLine}, Turn ${++convTurn}] "${user}"`);
    if (response) conversationLines.push(`[Line ${refLine}, Turn ${++convTurn}] (JENNIE Generated Response) "${response}"`);
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
    const r = await categorizeOffScriptUtterancesStreaming(formattedLog, currentPageQuestion, bookText, oldPage + 1, imageDescription, userAttention, questionHistory, ttsVoiceName, onAudioError, onQuestionReady, controller.signal, currentBookId, systemQuestions, clickTags);
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
        ctx.questionHistoryRef?.current || [],
        ctx.ttsVoiceName || null,
        ctx.onAudioError || null,
        ctx.onQuestionReady || null
      );
    }
  }
}

export async function sendAcknowledgementLog({
  reply,
  question,
  currentPageQuestion,
  bookText,
  currentPageNumber,
  imageDescriptionRef,
  userAttention,
  acknowledgementHistory,
  expectedAnswer,
  ttsVoiceName,
  onAcknowledgementReady,
  onAudioChunk,
  onAudioEnd,
  onAudioError,
  signal,
}) {
  if (!reply) return null;
  // This await sits between the click and the request leaving the browser: on a
  // freshly-turned page the page-description promise may still be in flight.
  const tImageWait = performance.now();
  const imageDescription = await (imageDescriptionRef?.current ?? Promise.resolve(null));
  const imageWaitMs = Math.round(performance.now() - tImageWait);
  if (imageWaitMs > 50) debugLog({ type: 'ack_image_description_wait', ms: imageWaitMs });
  return streamAcknowledgement({
    imageWaitMs,
    question,
    reply,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    book: currentBookId,
    imageDescription,
    userAttention,
    acknowledgementHistory,
    expectedAnswer,
    ttsVoiceName,
    onAcknowledgementReady,
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
  questionHistoryRef,
  ttsVoiceName,
  onAudioError,
  onQuestionReady,
  questionGenEnabledRef,
  isAcknowledgementModeRef,
}) {
  const totalLines = state.pagesValues[state.page]?.text?.length || 0;
  const currentLineIndex = state.index > 0 ? state.index - 1 : 0;
  const currentLine = state.pagesValues[state.page]?.text?.[currentLineIndex];

  if (!userUtterance) return;

  // Intercepted ahead of line matching so answering a question can never
  // auto-advance the reading position or leak into off-script categorization.
  if (awaitingQuestionAnswer || manualAnswerDraining) {
    const answerPart = userUtterance.trim();
    if (answerPart) {
      manualAnswerBuffer.push(answerPart);
      debugLog({ type: 'manual_answer_captured', utterance: answerPart, draining: manualAnswerDraining, parts: manualAnswerBuffer.length });
    }
    lastProcessedUtteranceRef.current = userUtterance;
    // The tail the submit press was waiting on — send now rather than sitting out
    // the rest of the drain.
    if (manualAnswerDraining && answerPart && finishDrain) finishDrain();
    return;
  }

  // A pending question now only suppresses off-script categorization — it can no
  // longer trigger an answer, and the flag is deliberately not consumed here: it
  // stays armed until the answer window closes or the question UI is cleared.
  const ackInProgress = isAcknowledgementModeRef?.current === true;

  // A pending generated question no longer blocks categorization. It used to,
  // which meant an unclicked "I have a question!" froze generation until the page
  // turned — and a thought the pair got to late asked about a conversation that
  // had already moved on. Now it keeps being rewritten; startGeneratedQuestion
  // refuses to swap one that is mid-playback, so nothing interrupts itself.
  const canCategorizeLive = !awaitingQuestionAnswer && !ackInProgress && questionGenEnabledRef?.current !== false && Boolean(onCategorizationResult || onCategorizationStart);
  const categorizationContext = canCategorizeLive
    ? { state, onCategorizationResult, onCategorizationStart, imageDescriptionRef, userAttentionRef, questionHistoryRef, ttsVoiceName, onAudioError, onQuestionReady }
    : null;

  if (currentLineTrackingRef.current.page !== state.page) {
    accumulatedUtterancesRef.current = [];
    utteranceQueuesRef.current = emptyQueues();
    lastSpeculativeSnapshot = '';
    speculativeLineEntries = [];
    currentLineTrackingRef.current = { page: state.page, index: currentLineIndex };
  }

  if (totalLines > 0 && state.index >= totalLines && !currentLine?.Reading) {
    lastProcessedUtteranceRef.current = userUtterance;
    debugLog({ type: 'utterance_received', utterance: userUtterance, expectedLine: '(post-last-line)', lineIndex: currentLineIndex });

    captureStableOffScriptWords(offScriptLogRef, totalLines, userUtterance.trim().split(/\s+/).filter(w => w.length > 0), categorizationContext);

    if (categorizationContext) {
      const ready = resolveUtterances({
        text: userUtterance,
        speaker: speakerLabels,
        lineIndex: totalLines,
      });
      let queued = false;
      for (const entry of ready) {
        if (!entry.text || entry.text === lastSpeculativeSnapshot) continue;
        speculativeLineEntries.push({ lineIndex: entry.lineIndex, turn: speculativeLineEntries.length + 1, text: entry.text });
        lastSpeculativeSnapshot = entry.text;
        queued = true;
      }
      if (queued) {
        sendOffScriptLog(
          { current: [...speculativeLineEntries] },
          categorizationContext.state.page,
          categorizationContext.state,
          categorizationContext.onCategorizationResult,
          categorizationContext.imageDescriptionRef,
          categorizationContext.userAttentionRef?.current,
          categorizationContext.onCategorizationStart,
          categorizationContext.questionHistoryRef?.current || [],
          categorizationContext.ttsVoiceName || null,
          categorizationContext.onAudioError || null,
          categorizationContext.onQuestionReady || null
        );
      }
    }
    return;
  }

  if (!currentLine?.Reading) return;

  const currentCharacter = state.CharacterRoles.find(obj => obj.Character === currentLine.Character);
  const isUserReadingRole = isHumanRead(currentCharacter?.role);

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

  // A final that stops mid-sentence is held for this speaker's next one instead of
  // being dropped, so each entry here is already a complete utterance.
  const ready = resolveUtterances({
    text: userUtterance,
    speaker: speakerLabels,
    lineIndex: currentLineIndex,
  });
  if (!ready.length) {
    console.log('Transcript held for continuation:', userUtterance);
    return;
  }
  for (const entry of ready) {
    console.log('Sending offscript utterance:', entry.text);
    sendSpeculativeQueueSnapshot(utteranceQueuesRef, entry.lineIndex, categorizationContext, maxReadableLookbackWords, true, entry.text);
  }
}
