/**
 * Shared test fixtures for TaleMate NLP tests
 */

// --- Factory helpers ---

export function createMockRefs(overrides = {}) {
  return {
    lastProcessedUtteranceRef: { current: '' },
    accumulatedUtterancesRef: { current: [] },
    utteranceQueuesRef: { current: [] },
    currentLineTrackingRef: { current: { page: 0, index: 0 } },
    silenceTimeoutRef: { current: null },
    pendingUtteranceRef: { current: '' },
    offScriptLogRef: { current: [] },
    ...overrides,
  };
}

export function createMockState(lines, page = 0, index = 0) {
  return {
    page,
    index,
    pagesValues: [{
      text: lines.map((dialogue, i) => ({
        Character: 'Narrator',
        Dialogue: dialogue,
        Reading: i === index,
      })),
      question: 'What happened in the story?',
    }],
    CharacterRoles: [{ Character: 'Narrator', role: 'Parent' }],
  };
}

// --- Sample book lines ---

export const SAMPLE_LINES = [
  'Once upon a time there was a little bear.',
  '"Hello!" said the rabbit.',
  'The 3 little pigs built their houses.',
  "I don't think we should go there.",
];

// --- SSML samples ---

export const SSML_SAMPLES = [
  ['<prosody rate="slow">Hello there</prosody>', 'Hello there'],
  ['<emphasis>Watch out!</emphasis>', 'Watch out!'],
  ['<speak>The bear <break time="500ms"/> ran away.</speak>', 'The bear  ran away.'],
];

// --- ASR error patterns [spoken, expected] ---

export const ASR_ERROR_PATTERNS = [
  ['da bear', 'the bear'],
  ['gonna', 'going to'],
  ['wanna', 'want to'],
  ['lil', 'little'],
];
