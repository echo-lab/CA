import { TextDecoder, TextEncoder } from 'util';

jest.mock('../debugMonitor', () => ({ gptDebugLog: jest.fn() }));
jest.mock('../studyLog', () => ({ pushQuestion: jest.fn() }));

global.TextDecoder = global.TextDecoder || TextDecoder;
global.TextEncoder = global.TextEncoder || TextEncoder;

const { categorizeOffScriptUtterancesStreaming } = require('../InnerThoughtProcessStream');

// Feeds the reader one SSE event per chunk, then closes the body — exactly what
// the browser does when the response ends, cut short or not.
function mockSseResponse(events) {
  const frames = events.map((e) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (i < frames.length ? { done: false, value: frames[i++] } : { done: true }),
      }),
    },
  });
}

const DONE = { type: 'done', generatedQuestion: 'Which cake has blue and orange?' };
const CHUNK = (seq) => ({ type: 'audio_chunk', seq, audioContent: 'AAAA', durationMs: 200 });

async function run() {
  const onAudioChunk = jest.fn();
  const onAudioEnd = jest.fn();
  const onAudioError = jest.fn();
  const onQuestionReady = jest.fn();
  // Positional, and the audio callbacks sit at the tail — named here so the
  // order stays checkable against the signature.
  await categorizeOffScriptUtterancesStreaming(
    'what colour is it',  // formattedUtterances
    'page question',      // currentPageQuestion
    'book text',          // bookText
    1,                    // currentPageNumber
    null,                 // imageDescription
    null,                 // userAttention
    [],                   // questionHistory
    'kore',               // ttsVoiceName
    onAudioError,
    onQuestionReady,
    undefined,            // signal
    1,                    // book
    [],                   // systemQuestions
    [],                   // clickTags
    onAudioChunk,
    onAudioEnd,
  );
  return { onAudioEnd, onAudioError, onQuestionReady };
}

describe('categorize stream — terminal audio signal', () => {
  it('ends the player when the body is cut short mid-speech', async () => {
    // No audio_end: the stream died after two chunks. Without a terminal signal
    // the player never finishes, so the audio lock is never released.
    mockSseResponse([DONE, CHUNK(0), CHUNK(1)]);

    const { onAudioEnd } = await run();

    expect(onAudioEnd).toHaveBeenCalledTimes(1);
  });

  it('ends the player when the server reports an error mid-speech', async () => {
    mockSseResponse([DONE, CHUNK(0), { type: 'error', error: 'model exploded' }]);

    const { onAudioEnd } = await run();

    expect(onAudioEnd).toHaveBeenCalledTimes(1);
  });

  it('does not double-signal a stream that ended cleanly', async () => {
    mockSseResponse([DONE, CHUNK(0), { type: 'audio_end' }]);

    const { onAudioEnd } = await run();

    expect(onAudioEnd).toHaveBeenCalledTimes(1);
  });

  it('leaves an audio_error to settle the turn, without also ending', async () => {
    // onAudioError finishes playback itself; a second signal would finish it twice.
    mockSseResponse([DONE, CHUNK(0), { type: 'audio_error', message: 'tts failed' }]);

    const { onAudioEnd, onAudioError } = await run();

    expect(onAudioError).toHaveBeenCalledWith('tts failed');
    expect(onAudioEnd).not.toHaveBeenCalled();
  });

  it('stays silent when no audio ever started', async () => {
    // The no-audio path is already settled by the caller; signalling here would
    // end a player belonging to an earlier question.
    mockSseResponse([DONE]);

    const { onAudioEnd } = await run();

    expect(onAudioEnd).not.toHaveBeenCalled();
  });
});
