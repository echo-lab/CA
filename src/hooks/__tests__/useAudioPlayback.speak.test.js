import { renderHook, act } from '@testing-library/react';
import { useAudioPlayback } from '../useAudioPlayback';
import { say } from '../../utils/ttsClient';
import { AUDIO_SOURCES } from '../../utils/audioPlaybackLock';

jest.mock('../../utils/ttsClient');
jest.mock('../../utils/utteranceProcessor', () => ({ setAwaitingQuestionAnswer: jest.fn() }));
jest.mock('../../utils/studyLog', () => ({ pushQuestion: jest.fn() }));

// Interrupting an utterance is the case the shared <audio> cannot signal for
// itself: pause() fires neither `ended` nor `error`, so both the lock release
// and the listener removal have to be done by hand. These two assertions are
// what a regression there would break.
function setup() {
  const audioEl = { addEventListener: jest.fn(), removeEventListener: jest.fn(), ended: false };
  say.mockResolvedValue({ audio: audioEl, url: 'blob:x' });

  const tryBeginAudio = jest.fn(() => true);
  const endAudio = jest.fn();
  const noop = () => {};

  const { result } = renderHook(() => useAudioPlayback({
    tryBeginAudio,
    endAudio,
    remoteAudioRef: { current: null },
    isMuted: false,
    audio: null,
    setAudio: noop,
    isPlaying: false,
    setIsPlaying: noop,
    setIsAudioPlaying: noop,
    setAudioHasEnded: noop,
    setIsButtonDisabled: noop,
    setChildHasPlayed: noop,
    generatedQuestion: '',
    setGeneratedQuestion: noop,
    setQuestionHistory: noop,
    setShowAvatar: noop,
    showAvatarRef: { current: false },
    setInAcknowledgementLoop: noop,
    setAvatarPhase: noop,
    hasSlidCloserRef: { current: false },
    lastAskedQuestionRef: { current: '' },
    questionHistoryRef: { current: [] },
    acknowledgementFromPageQuestionRef: { current: false },
    generatedQuestionPendingRef: { current: false },
    questionGenEnabledRef: { current: false },
    state: { page: 0, index: 0, pagesValues: [] },
    narratorRole: null,
  }));

  return { result, audioEl, tryBeginAudio, endAudio };
}

test('stopSpeaking releases the lock it acquired', async () => {
  const { result, tryBeginAudio, endAudio } = setup();

  await act(async () => {
    await result.current.speak('hello', 'kore', 'neutral', null, AUDIO_SOURCES.STORY_NARRATION);
  });
  expect(tryBeginAudio).toHaveBeenCalledWith(AUDIO_SOURCES.STORY_NARRATION);

  act(() => { result.current.stopSpeaking(); });

  // The lock lives above <Router> and survives unmount, so a missed release
  // pins isAnyAudioPlaying true and permanently disables the Next button.
  expect(endAudio).toHaveBeenCalledWith(AUDIO_SOURCES.STORY_NARRATION);
});

test('stopSpeaking removes the exact listeners it registered', async () => {
  const { result, audioEl } = setup();

  await act(async () => {
    await result.current.speak('hello', 'kore', 'neutral', null, AUDIO_SOURCES.STORY_NARRATION);
  });

  act(() => { result.current.stopSpeaking(); });

  // removeEventListener only matches on function identity. Registering a fresh
  // closure per speak() and removing a different one leaks a pair per
  // interrupt, and every stale pair fires on some later `ended`.
  const added = Object.fromEntries(audioEl.addEventListener.mock.calls.map(([t, fn]) => [t, fn]));
  const removed = Object.fromEntries(audioEl.removeEventListener.mock.calls.map(([t, fn]) => [t, fn]));

  expect(removed.ended).toBe(added.ended);
  expect(removed.error).toBe(added.error);
});
