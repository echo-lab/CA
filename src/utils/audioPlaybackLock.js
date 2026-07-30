export const AUDIO_SOURCES = {
  TTS: 'tts',
  STORY_NARRATION: 'story-narration',
  PAGE_QUESTION: 'page-question',
  GENERATED_QUESTION: 'generated-question',
  ACKNOWLEDGEMENT: 'acknowledgement',
  GEMINI_LIVE: 'gemini-live',
  REMOTE_REALTIME: 'remote-realtime',
};

export function createAudioPlaybackLock(onChange = () => {}) {
  let activeAudioSource = null;

  const notify = () => onChange(activeAudioSource);

  return {
    get activeAudioSource() {
      return activeAudioSource;
    },
    isAnyAudioPlaying() {
      return Boolean(activeAudioSource);
    },
    tryBeginAudio(source) {
      if (!source) throw new Error('Audio source is required');
      if (activeAudioSource) return false;
      activeAudioSource = source;
      notify();
      return true;
    },
    endAudio(source) {
      if (activeAudioSource !== source) return false;
      activeAudioSource = null;
      notify();
      return true;
    },
    reset() {
      if (!activeAudioSource) return false;
      activeAudioSource = null;
      notify();
      return true;
    },
  };
}
