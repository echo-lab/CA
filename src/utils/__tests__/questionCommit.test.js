/**
 * A question must not reach the UI until its TTS is complete. Otherwise a click
 * lands on a half-streamed question and its audio overlaps the previous one.
 */
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

// jsdom ships neither, and the SSE reader needs both.
global.TextEncoder = global.TextEncoder || NodeTextEncoder;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;

// eslint-disable-next-line import/first
const { categorizeOffScriptUtterancesStreaming } = require('../InnerThoughtProcessStream');

// Builds a fetch that replays the given SSE events as one streamed body.
function mockStream(events) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return jest.fn(async () => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
  }));
}

const ITEM = { type: 'item', item: { category: 'ON_TOPIC', reason: 'x' } };
const DONE = { type: 'done', generatedQuestion: 'Which plate is purple?', expectedAnswer: 'the purple one' };
const CHUNK = (seq) => ({ type: 'audio_chunk', seq, audioContent: `pcm${seq}`, durationMs: 100 });

// Only the args the question path uses; the rest are positional filler.
const run = (onQuestionReady) => categorizeOffScriptUtterancesStreaming(
  '[Line 1, Turn 1] "hi"', 'q', 'text', 1, null, null, null, 'kore',
  null, onQuestionReady, undefined, 1, [], [],
);

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('question is committed only once its audio is complete', () => {
  test('nothing is delivered before audio_end', async () => {
    global.fetch = mockStream([ITEM, DONE, CHUNK(0), CHUNK(1)]);
    const ready = jest.fn();
    await run(ready);
    // Stream closed without audio_end, so it still commits — but exactly once,
    // and only after every chunk was collected.
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][3]).toHaveLength(2);
    expect(ready.mock.calls[0][4]).toBe('stream_closed');
  });

  test('delivers once at audio_end, carrying every chunk', async () => {
    global.fetch = mockStream([ITEM, DONE, CHUNK(0), CHUNK(1), CHUNK(2), { type: 'audio_end' }]);
    const ready = jest.fn();
    await run(ready);
    expect(ready).toHaveBeenCalledTimes(1);
    const [question, expected, click, chunks, reason] = ready.mock.calls[0];
    expect(question).toBe('Which plate is purple?');
    expect(expected).toBe('the purple one');
    expect(click).toEqual({ answerLabel: null, answerBox: null });
    expect(chunks.map((c) => c.audioContent)).toEqual(['pcm0', 'pcm1', 'pcm2']);
    expect(reason).toBe('audio_ready');
  });

  test('a TTS failure still delivers the question, with no audio', async () => {
    global.fetch = mockStream([ITEM, DONE, { type: 'audio_error', message: 'quota' }]);
    const ready = jest.fn();
    await run(ready);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][3]).toEqual([]);
    expect(ready.mock.calls[0][4]).toBe('audio_failed');
  });

  test('chunks that arrived before a failure are discarded, not half-played', async () => {
    global.fetch = mockStream([ITEM, DONE, CHUNK(0), { type: 'audio_error', message: 'died mid-stream' }]);
    const ready = jest.fn();
    await run(ready);
    expect(ready.mock.calls[0][3]).toEqual([]);
  });

  test('no question means no delivery at all', async () => {
    global.fetch = mockStream([ITEM, { type: 'done', generatedQuestion: null }, { type: 'audio_end' }]);
    const ready = jest.fn();
    await run(ready);
    expect(ready).not.toHaveBeenCalled();
  });

  test('a click answer carries its box through the commit', async () => {
    global.fetch = mockStream([
      ITEM,
      { type: 'done', generatedQuestion: 'Tap Clara!', expectedAnswer: 'Clara', answerLabel: 'Clara', answerBox: [100, 200, 300, 400] },
      CHUNK(0),
      { type: 'audio_end' },
    ]);
    const ready = jest.fn();
    await run(ready);
    expect(ready.mock.calls[0][2]).toEqual({ answerLabel: 'Clara', answerBox: [100, 200, 300, 400] });
  });
});
