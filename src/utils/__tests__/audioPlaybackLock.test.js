import { AUDIO_SOURCES, createAudioPlaybackLock } from '../audioPlaybackLock';

describe('audioPlaybackLock', () => {
  it('acquires an idle lock', () => {
    const lock = createAudioPlaybackLock();

    expect(lock.tryBeginAudio(AUDIO_SOURCES.TTS)).toBe(true);
    expect(lock.activeAudioSource).toBe(AUDIO_SOURCES.TTS);
    expect(lock.isAnyAudioPlaying()).toBe(true);
  });

  it('rejects competing audio while a source is active', () => {
    const lock = createAudioPlaybackLock();

    expect(lock.tryBeginAudio(AUDIO_SOURCES.TTS)).toBe(true);
    expect(lock.tryBeginAudio(AUDIO_SOURCES.GENERATED_QUESTION)).toBe(false);
    expect(lock.activeAudioSource).toBe(AUDIO_SOURCES.TTS);
  });

  it('rejects duplicate starts from the active source', () => {
    const lock = createAudioPlaybackLock();

    expect(lock.tryBeginAudio(AUDIO_SOURCES.TTS)).toBe(true);
    expect(lock.tryBeginAudio(AUDIO_SOURCES.TTS)).toBe(false);
    expect(lock.activeAudioSource).toBe(AUDIO_SOURCES.TTS);
  });

  it('only releases the owning source', () => {
    const lock = createAudioPlaybackLock();

    lock.tryBeginAudio(AUDIO_SOURCES.PAGE_QUESTION);

    expect(lock.endAudio(AUDIO_SOURCES.TTS)).toBe(false);
    expect(lock.activeAudioSource).toBe(AUDIO_SOURCES.PAGE_QUESTION);
    expect(lock.endAudio(AUDIO_SOURCES.PAGE_QUESTION)).toBe(true);
    expect(lock.activeAudioSource).toBe(null);
  });

  it('notifies when the active source changes', () => {
    const onChange = jest.fn();
    const lock = createAudioPlaybackLock(onChange);

    lock.tryBeginAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);
    lock.endAudio(AUDIO_SOURCES.ACKNOWLEDGEMENT);

    expect(onChange).toHaveBeenNthCalledWith(1, AUDIO_SOURCES.ACKNOWLEDGEMENT);
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });
});
