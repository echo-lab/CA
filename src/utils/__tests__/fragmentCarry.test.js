/**
 * Mid-sentence Deepgram finals must be carried forward, not dropped — but never
 * merged across speakers. Replays the 2026-08-17 20:56 session in which six of
 * ten utterances never reached categorization.
 */
jest.mock('../InnerThoughtProcessStream', () => ({
  categorizeOffScriptUtterancesStreaming: jest.fn(async () => ({ items: [], generatedQuestion: null })),
}));

import { categorizeOffScriptUtterancesStreaming } from '../InnerThoughtProcessStream';
import { abortCurrentCategorization, processUserUtterance } from '../utteranceProcessor';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  categorizeOffScriptUtterancesStreaming.mockClear();
});
afterEach(() => {
  abortCurrentCategorization();
});

// Past the last line of the page, so every utterance is off-script and goes
// straight to the speculative log — the path the debug monitor showed.
function makeHarness() {
  const state = {
    page: 0,
    index: 1,
    CharacterRoles: [{ Character: 'Narrator', role: 'Parent' }],
    pagesValues: [{
      text: [{ Character: 'Narrator', Dialogue: 'Read this.', Reading: false }],
      question: 'What happened?',
    }],
  };
  const refs = {
    lastProcessedUtteranceRef: { current: '' },
    accumulatedUtterancesRef: { current: [] },
    utteranceQueuesRef: { current: [] },
    currentLineTrackingRef: { current: { page: 0, index: 0 } },
    offScriptLogRef: { current: [] },
  };
  const say = (userUtterance, speakerLabels = 'Speaker 0') => processUserUtterance({
    ...refs,
    state,
    userUtterance,
    speakerLabels,
    onCategorizationResult: jest.fn(),
    onCategorizationStart: jest.fn(),
    imageDescriptionRef: { current: null },
    userAttentionRef: { current: null },
    questionHistoryRef: { current: [] },
    sendContentMessage: jest.fn(),
    jumpToLine: jest.fn(),
    setAudioHasEnded: jest.fn(),
    setIsPlaying: jest.fn(),
  });
  return { say };
}

// Everything the model was shown across all sends this test made.
const sentText = () => categorizeOffScriptUtterancesStreaming.mock.calls.map(c => c[0]).join('\n');

describe('mid-sentence fragment carry-forward', () => {
  test('a final that stops mid-sentence is held, then prepended to the next one', async () => {
    const { say } = makeHarness();

    say("Right. That's weird because I");
    await Promise.resolve();
    expect(categorizeOffScriptUtterancesStreaming).not.toHaveBeenCalled();

    say('clicked the right place. Yeah.');
    await Promise.resolve();
    expect(sentText()).toContain("Right. That's weird because I clicked the right place. Yeah.");
  });

  test("the child's list survives instead of being dropped piece by piece", async () => {
    const { say } = makeHarness();

    say('Yeah. What else would you bring to the sleepover? Well, I would bring some');
    say('my books, game cards,');
    say('puzzles, maybe. Oh, well, obviously, my');
    say('blanket, pillows, those kind of things.');
    await Promise.resolve();

    const out = sentText();
    for (const word of ['books', 'game cards', 'puzzles', 'blanket', 'pillows']) {
      expect(out).toContain(word);
    }
  });

  test("a fragment is never glued to a different speaker's words", async () => {
    const { say } = makeHarness();

    say("Who do you think that is on the wall? Do you think that's", 'Speaker 0');
    say("Clara's family. Maybe.", 'Speaker 1');
    await Promise.resolve();

    const out = sentText();
    expect(out).toContain("Who do you think that is on the wall? Do you think that's");
    expect(out).toContain("Clara's family. Maybe.");
    expect(out).not.toContain("that's Clara's family");
  });

  test('a complete final still goes straight through', async () => {
    const { say } = makeHarness();

    say('I know why that happened.');
    await Promise.resolve();
    expect(sentText()).toContain('I know why that happened.');
  });
});
