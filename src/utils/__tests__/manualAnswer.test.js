jest.mock('../InnerThoughtProcessStream', () => ({
  categorizeOffScriptUtterancesStreaming: jest.fn(async () => ({ items: [], generatedQuestion: null })),
  streamAcknowledgement: jest.fn(async () => ({ acknowledgement: '', correct: true })),
}));

import {
  processUserUtterance,
  endManualAnswer,
  cancelManualAnswer,
  isManualAnswerActive,
  setAwaitingQuestionAnswer,
  abortCurrentCategorization,
} from '../utteranceProcessor';
import { createMockRefs, createMockState, SAMPLE_LINES } from '../testFixtures';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

afterEach(() => {
  cancelManualAnswer();
  abortCurrentCategorization();
});

function feed(utterances, extra = {}) {
  const refs = createMockRefs();
  const state = createMockState(SAMPLE_LINES, 0, 1);
  const onAutoLineAdvance = jest.fn();
  for (const userUtterance of utterances) {
    processUserUtterance({
      userUtterance,
      ...refs,
      state,
      speakerLabels: 'Speaker 0',
      setAudioHasEnded: jest.fn(),
      setIsPlaying: jest.fn(),
      onAutoLineAdvance,
      questionGenEnabledRef: { current: true },
      ...extra,
    });
  }
  return { onAutoLineAdvance };
}

// Submitting resolves as soon as the trailing transcript lands, so a tiny drain
// is enough for the tests that expect no tail.
const close = (drainMs = 5) => endManualAnswer({ drainMs });

test('buffers every utterance between the question and the press, and joins them', async () => {
  setAwaitingQuestionAnswer(true);
  expect(isManualAnswerActive()).toBe(true);

  feed(['She is sad', 'because the balloon', 'popped']);

  await expect(close()).resolves.toBe('She is sad because the balloon popped');
  expect(isManualAnswerActive()).toBe(false);
});

// The bug from session 0815202537: Deepgram delivered every answer 0.3-2.4s
// after the press, so 10 of 11 answers were dropped. The tail must still land.
test('a transcript arriving after the press is still captured', async () => {
  setAwaitingQuestionAnswer(true);
  const pending = close(2000);

  // Nothing was buffered before the press — the whole answer arrives late.
  feed(['Zoe is making a huge mess.']);

  await expect(pending).resolves.toBe('Zoe is making a huge mess.');
});

test('a late tail is appended to what was already buffered', async () => {
  setAwaitingQuestionAnswer(true);
  feed(['She is decorating']);
  const pending = close(2000);

  feed(['the room for the party.']);

  await expect(pending).resolves.toBe('She is decorating the room for the party.');
});

test('answering never advances the reading position', async () => {
  setAwaitingQuestionAnswer(true);
  const { onAutoLineAdvance } = feed(['She is decorating the room.']);

  expect(onAutoLineAdvance).not.toHaveBeenCalled();
  await expect(close()).resolves.toBe('She is decorating the room.');
});

// The question opening the window is the only cue needed: speech is captured
// with no press at all, and the press only decides when to send.
test('an armed question captures speech with no start press', async () => {
  setAwaitingQuestionAnswer(true);
  expect(isManualAnswerActive()).toBe(true);

  feed(['She is decorating the room.']);

  await expect(close()).resolves.toBe('She is decorating the room.');
});

// Re-arming for a new question must not carry the previous answer over.
test('opening the window for a new question clears the previous answer', async () => {
  setAwaitingQuestionAnswer(true);
  feed(['an answer to the first question']);

  setAwaitingQuestionAnswer(false);
  setAwaitingQuestionAnswer(true);
  feed(['the second answer']);

  await expect(close()).resolves.toBe('the second answer');
});

// Nothing is captured before a question is asked, so ordinary co-reading chatter
// never becomes an answer.
test('speech with no question pending is not captured as an answer', async () => {
  feed(['just chatting about the picture.']);
  await expect(close()).resolves.toBe('');
});

test('a window closed with nothing said yields an empty verdict string', async () => {
  setAwaitingQuestionAnswer(true);
  feed(['   ']);
  await expect(close()).resolves.toBe('');
});

test('cancel discards the buffer without producing an answer', async () => {
  setAwaitingQuestionAnswer(true);
  feed(['half an answer']);
  cancelManualAnswer();

  expect(isManualAnswerActive()).toBe(false);
  await expect(close()).resolves.toBe('');
});

// A page turn mid-drain must not fire a stale answer at the new page.
test('cancelling during the drain resolves empty', async () => {
  setAwaitingQuestionAnswer(true);
  feed(['an answer to the old page']);
  const pending = close(2000);

  cancelManualAnswer();

  await expect(pending).resolves.toBe('');
});
