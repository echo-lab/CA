/**
 * A question must not reach the UI until its TTS has STARTED — it is handed over on
 * the first audio chunk so the child sees it while the rest is still synthesising,
 * and never before there is audio to speak. What still must not happen: delivering
 * twice, delivering with no audio at all, or leaving a fragment behind after a
 * mid-stream failure, any of which lets a click catch a half-streamed question and
 * overlap the previous one.
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
const run = (onQuestionReady, onAudioChunk) => categorizeOffScriptUtterancesStreaming(
  '[Line 1, Turn 1] "hi"', 'q', 'text', 1, null, null, null, 'kore',
  null, onQuestionReady, undefined, 1, [], [], onAudioChunk,
);

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('question is committed once its audio has started', () => {
  test('nothing is delivered before the first audio chunk', async () => {
    global.fetch = mockStream([ITEM, DONE]);
    const ready = jest.fn();
    await run(ready);
    // 'done' alone is not enough — there is a question but nothing can speak it,
    // so it waits for the stream to close rather than showing an unspeakable one.
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][4]).toBe('stream_closed');
    expect(ready.mock.calls[0][3]).toEqual([]);
  });

  test('delivers once on the first chunk, marked incomplete, rest streamed after', async () => {
    global.fetch = mockStream([ITEM, DONE, CHUNK(0), CHUNK(1), CHUNK(2), { type: 'audio_end' }]);
    const ready = jest.fn();
    const chunk = jest.fn();
    await run(ready, chunk);

    expect(ready).toHaveBeenCalledTimes(1);
    const [question, expected, click, chunks, reason, audioComplete] = ready.mock.calls[0];
    expect(question).toBe('Which plate is purple?');
    expect(expected).toBe('the purple one');
    expect(click).toEqual({ answerLabel: null, answerBox: null });
    // Only chunk 0 was in hand at delivery; the caller is told more are coming.
    expect(chunks.map((c) => c.audioContent)).toEqual(['pcm0']);
    expect(reason).toBe('audio_started');
    expect(audioComplete).toBe(false);
    // The remainder arrives through onAudioChunk, in order, exactly once each.
    expect(chunk.mock.calls.map((c) => c[1])).toEqual(['pcm1', 'pcm2']);
  });

  test('audio_end closes the question it already delivered, without redelivering', async () => {
    global.fetch = mockStream([ITEM, DONE, CHUNK(0), { type: 'audio_end' }]);
    const ready = jest.fn();
    await run(ready, jest.fn());
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][5]).toBe(false);
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
    await run(ready, jest.fn());
    // The question was already delivered on chunk 0, so the caller holds this exact
    // array — it must be emptied in place, or a tap plays a fragment and hangs
    // waiting for an end() that the failed stream will never send.
    expect(ready).toHaveBeenCalledTimes(1);
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
