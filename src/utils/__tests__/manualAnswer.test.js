jest.mock('../InnerThoughtProcessStream', () => ({
  categorizeOffScriptUtterancesStreaming: jest.fn(async () => ({ items: [], generatedQuestion: null })),
  streamAcknowledgement: jest.fn(async () => ({ acknowledgement: '', correct: true })),
}));

import {
  processUserUtterance,
  startManualAnswer,
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

// Closing the window resolves as soon as the trailing transcript lands, so a
// tiny drain is enough for the tests that expect no tail.
const close = (drainMs = 5) => endManualAnswer({ drainMs });

test('buffers every utterance between the two clicks and joins them', async () => {
  startManualAnswer();
  expect(isManualAnswerActive()).toBe(true);

  feed(['She is sad', 'because the balloon', 'popped']);

  await expect(close()).resolves.toBe('She is sad because the balloon popped');
  expect(isManualAnswerActive()).toBe(false);
});

// The bug from session 0815202537: Deepgram delivered every answer 0.3-2.4s
// after the click, so 10 of 11 answers were dropped. The tail must still land.
test('a transcript arriving after the click is still captured', async () => {
  startManualAnswer();
  const pending = close(2000);

  // Nothing was buffered before the click — the whole answer arrives late.
  feed(['Zoe is making a huge mess.']);

  await expect(pending).resolves.toBe('Zoe is making a huge mess.');
});

test('a late tail is appended to what was already buffered', async () => {
  startManualAnswer();
  feed(['She is decorating']);
  const pending = close(2000);

  feed(['the room for the party.']);

  await expect(pending).resolves.toBe('She is decorating the room for the party.');
});

test('answering never advances the reading position', async () => {
  startManualAnswer();
  const { onAutoLineAdvance } = feed(['She is decorating the room.']);

  expect(onAutoLineAdvance).not.toHaveBeenCalled();
  await expect(close()).resolves.toBe('She is decorating the room.');
});

// The button is the sole cue: with a question armed but no window open, a
// textbook answer (3+ words, terminal punctuation, POS-complete) that the old
// auto-detection would have submitted must now produce nothing at all.
test('an armed question alone never submits an answer', async () => {
  setAwaitingQuestionAnswer(true);
  expect(isManualAnswerActive()).toBe(false);

  feed(['She is decorating the room.']);

  startManualAnswer();
  await expect(close()).resolves.toBe('');
});

test('a window closed with nothing said yields an empty verdict string', async () => {
  startManualAnswer();
  feed(['   ']);
  await expect(close()).resolves.toBe('');
});

test('cancel discards the buffer without producing an answer', async () => {
  startManualAnswer();
  feed(['half an answer']);
  cancelManualAnswer();

  expect(isManualAnswerActive()).toBe(false);
  await expect(close()).resolves.toBe('');
});

// A page turn mid-drain must not fire a stale answer at the new page.
test('cancelling during the drain resolves empty', async () => {
  startManualAnswer();
  feed(['an answer to the old page']);
  const pending = close(2000);

  cancelManualAnswer();

  await expect(pending).resolves.toBe('');
});
