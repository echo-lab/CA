import { processUserUtterance } from '../utteranceProcessor';
import { createMockRefs, createMockState } from '../testFixtures';

// Suppress console output during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

// Use fake timers for setTimeout in advanceToNextLine / jumpToFutureLine
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// --- Test data ---

const BOOK_LINES = [
  'Once upon a time there was a little bear.',
  '"Hello!" said the rabbit.',
  "I don't think we should go there.",
];

// [description, transform function]
const SPEECH_VARIATIONS = [
  ['exact read', (line) => line],
  ['lowercase no punctuation', (line) => line.toLowerCase().replace(/[.,!?\u201C\u201D"]/g, '')],
  ['with filler prefix', (line) => `um ${line.toLowerCase().replace(/[.,!?\u201C\u201D"]/g, '')}`],
];

// Helper to build standard call args
function buildCallArgs(refs, state, overrides = {}) {
  return {
    ...refs,
    state,
    speakerLabels: 'Parent',
    sendContentMessage: jest.fn(),
    jumpToLine: jest.fn(),
    setAudioHasEnded: jest.fn(),
    setIsPlaying: jest.fn(),
    ...overrides,
  };
}

// --- Tests ---

describe('utteranceProcessor', () => {

  describe('line matching', () => {
    BOOK_LINES.forEach((line, lineIdx) => {
      SPEECH_VARIATIONS.forEach(([desc, transform]) => {
        it(`matches line ${lineIdx} with ${desc}`, async () => {
          const refs = createMockRefs();
          const state = createMockState([line], 0, 0);
          const setAudioHasEnded = jest.fn();
          const setIsPlaying = jest.fn();

          const spoken = transform(line);

          await processUserUtterance({
            userUtterance: spoken,
            ...refs,
            state,
            speakerLabels: 'Parent',
            sendContentMessage: jest.fn(),
            jumpToLine: jest.fn(),
            setAudioHasEnded,
            setIsPlaying,
          });

          jest.runAllTimers();

          expect(setAudioHasEnded).toHaveBeenCalled();
        });
      });
    });

    // --- Book 1: Birthday Beeps and Boops ---
    describe('Book 1 dialogue matching', () => {
      it('matches "come help"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CCome help!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'come help',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "hey what are these decorations for" with filler', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CHey, what are these decorations for?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'um hey what are these decorations for',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "lets choose a cake"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CLet\u2019s choose a cake!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'lets choose a cake',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "purple green purple green" pattern chant', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CPurple, green, purple, green!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'purple green purple green',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "beep boop beep boop" pattern chant', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CBeep, boop, beep, boop!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'beep boop beep boop',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "those are my favorite colors too"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['Those are my favorite colors, too!'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'those are my favorite colors too',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "can you please tell me who this party is for"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CCan you please tell me who this party is for?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'can you please tell me who this party is for',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "no time no time"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CNo time, no time!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'no time no time',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "we need more hats"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CWe need more hats!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'we need more hats',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "how do i look"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CHow do I look?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'how do i look',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "star star circle star star circle"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CStar, star, circle! Star, star, circle!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'star star circle star star circle',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "we fixed it"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CWe fixed it!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'we fixed it',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "happy birthday clara"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CHappy birthday, Clara!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'happy birthday clara',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "for me"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CFor me?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'for me',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "of course"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201COf course!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'of course',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "keep it"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CKeep it!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'keep it',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "it matches the pattern of the streamers"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CIt matches the pattern of the streamers.\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'it matches the pattern of the streamers',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "it still tastes delicious"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CIt still tastes delicious!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'it still tastes delicious',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });
    });

    // --- Book 2: Sleepover Similarities ---
    describe('Book 2 dialogue matching', () => {
      it('matches "welcome to my house"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CWelcome to my house!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'welcome to my house',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "this is going to be so much fun"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CThis is going to be so much fun!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'this is going to be so much fun',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "our sleeping bags have the same pattern"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201COur sleeping bags have the same pattern!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'our sleeping bags have the same pattern',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "lets play hide and seek"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CLet\u2019s play hide and seek!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'lets play hide and seek',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "ready or not here i come"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CReady or not, here I come!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'ready or not here i come',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "how will i find clara"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CHow will I find Clara?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'how will i find clara',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "sorry"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CSorry!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'sorry',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "i miss my house"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CI miss my house,\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'i miss my house',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "they go star star heart star star heart"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['They go star, star, heart, star, star, heart.'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'they go star star heart star star heart',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "zip zap zip zap"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CZip, zap, zip, zap!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'zip zap zip zap',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "zip zap zoodely zoop"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CZip, zap, zoodely, zoop!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'zip zap zoodely zoop',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "my flowers go tall short tall short"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['My flowers go tall, short, tall, short.'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'my flowers go tall short tall short',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "you got it"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CYou got it!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'you got it',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "i feel better"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CI feel better.\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'i feel better',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "maybe your house is more like mine than you think"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CMaybe your house is more like mine than you think,\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'maybe your house is more like mine than you think',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });
    });

    // --- Book 3: Levels in the Library ---
    describe('Book 3 dialogue matching', () => {
      it('matches "books" (single word)', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CBooks!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'books',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "shh" (single word)', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CShh!\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'shh',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "use your inside voice"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CUse your inside voice.\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'use your inside voice',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "what can we do here"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CWhat can we do here?\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'what can we do here',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "we can pick out books"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CWe can pick out books,\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'we can pick out books',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });

      it('matches "each of my stacks has one more book than the last"', async () => {
        const refs = createMockRefs();
        const state = createMockState(['\u201CEach of my stacks has one more book than the last.\u201D'], 0, 0);
        const setAudioHasEnded = jest.fn();

        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: 'each of my stacks has one more book than the last',
          setAudioHasEnded,
        }));
        jest.runAllTimers();
        expect(setAudioHasEnded).toHaveBeenCalled();
      });
    });
  });

  describe('phonetic tolerance in matching', () => {
    it('matches "bare" spoken as "bear" (phonetic sub)', async () => {
      const refs = createMockRefs();
      const state = createMockState(['The bare went home.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'the bear went home',
        setAudioHasEnded,
      }));
      jest.runAllTimers();
      expect(setAudioHasEnded).toHaveBeenCalled();
    });

    it('matches with filler words in utterance', async () => {
      const refs = createMockRefs();
      const state = createMockState(['The bear went home.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'um the bear uh went home',
        setAudioHasEnded,
      }));
      jest.runAllTimers();
      expect(setAudioHasEnded).toHaveBeenCalled();
    });

    it('B1: matches "happy birthday klara" (phonetic Clara)', async () => {
      const refs = createMockRefs();
      const state = createMockState(['\u201CHappy birthday, Clara!\u201D'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'happy birthday klara',
        setAudioHasEnded,
      }));
      jest.runAllTimers();
      expect(setAudioHasEnded).toHaveBeenCalled();
    });

    it('B2: matches "welcum too my howse" (phonetic errors)', async () => {
      const refs = createMockRefs();
      const state = createMockState(['\u201CWelcome to my house!\u201D'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'welcum too my howse',
        setAudioHasEnded,
      }));
      jest.runAllTimers();
      expect(setAudioHasEnded).toHaveBeenCalled();
    });
  });

  describe('forward search (skip ahead)', () => {
    it('detects when user skips to a future line', async () => {
      const lines = [
        'The brave little fox jumped over the lazy brown dog.',
        'Then the rabbit hopped into the garden quickly.',
        'Finally the owl flew silently through the dark forest.',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'finally the owl flew silently through the dark forest',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).toHaveBeenCalled();
    });

    it('does not jump when spoken text matches nothing', async () => {
      const lines = [
        'Once upon a time there was a bear.',
        'The bear went into the forest.',
        'He found a cave.',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'i want pizza for dinner',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).not.toHaveBeenCalled();
    });

    it('B1: jumps ahead when user skips "Clara asked." to "Come help!"', async () => {
      const lines = [
        '\u201CHey, what are these decorations for?\u201D',
        'Clara asked.',
        '\u201CCome help!\u201D',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'come help',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).toHaveBeenCalled();
    });

    it('B1: jumps ahead when user skips to "we need more hats"', async () => {
      const lines = [
        '\u201CCan you please tell me who this party is for?\u201D',
        'Clara asked.',
        '\u201CNo time, no time!\u201D',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'no time no time',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).toHaveBeenCalled();
    });

    it('B2: jumps ahead when user skips to "lets play hide and seek"', async () => {
      const lines = [
        '\u201CWelcome to my house!\u201D',
        'Clara beamed.',
        '\u201CLet\u2019s play hide and seek!\u201D',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'lets play hide and seek',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).toHaveBeenCalled();
    });

    it('B3: jumps ahead when user skips to "use your inside voice"', async () => {
      const lines = [
        '\u201CBooks!\u201D',
        'squawked Zoe.',
        '\u201CUse your inside voice.\u201D',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'use your inside voice',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).toHaveBeenCalled();
    });

    it('does not jump beyond 3 lines ahead', async () => {
      const lines = [
        'Line one here.',
        'Line two here.',
        'Line three here.',
        'Line four here.',
        'The special target line is way down here in the story.',
      ];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const jumpToLine = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'the special target line is way down here in the story',
        jumpToLine,
      }));
      jest.runAllTimers();
      expect(jumpToLine).not.toHaveBeenCalled();
    });
  });

  describe('off-script capture', () => {
    it('captures off-script words in utteranceQueuesRef', async () => {
      const lines = ['Once upon a time there was a little bear.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);

      for (const utterance of ['pizza', 'delivery', 'tonight']) {
        await processUserUtterance(buildCallArgs(refs, state, {
          userUtterance: utterance,
        }));
      }

      const queue = refs.utteranceQueuesRef.current[0] || [];
      expect(queue.length).toBeGreaterThan(0);
    });

    it('captures post-last-line utterances', async () => {
      const lines = ['The end.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 1);
      state.pagesValues[0].text[0].Reading = false;

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'that was a great story',
      }));

      expect(refs.offScriptLogRef.current.length).toBeGreaterThan(0);
      expect(refs.offScriptLogRef.current[0].text).toContain('great');
    });

    it('B1: captures post-story comment about birthday', async () => {
      const lines = ['The End.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 1);
      state.pagesValues[0].text[0].Reading = false;

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'i liked the birthday party',
      }));

      expect(refs.offScriptLogRef.current.length).toBeGreaterThan(0);
      expect(refs.offScriptLogRef.current[0].text).toContain('birthday');
    });

    it('B2: captures post-story comment about sleepover', async () => {
      const lines = ['The End.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 1);
      state.pagesValues[0].text[0].Reading = false;

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'the sleepover was fun',
      }));

      expect(refs.offScriptLogRef.current.length).toBeGreaterThan(0);
      expect(refs.offScriptLogRef.current[0].text).toContain('sleepover');
    });

    it('B3: captures post-story comment about library', async () => {
      const lines = ['The End.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 1);
      state.pagesValues[0].text[0].Reading = false;

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'i want to go to the library',
      }));

      expect(refs.offScriptLogRef.current.length).toBeGreaterThan(0);
      expect(refs.offScriptLogRef.current[0].text).toContain('library');
    });

    it('captures multiple off-script utterances after story ends', async () => {
      const lines = ['The End.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 1);
      state.pagesValues[0].text[0].Reading = false;

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'that was fun',
      }));
      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'can we read another book',
      }));

      expect(refs.offScriptLogRef.current.length).toBe(2);
    });
  });

  describe('word queue accumulation', () => {
    it('accumulates words across multiple utterances', async () => {
      const lines = ['Once upon a time there was a little bear.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'once upon',
      }));
      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'a time',
      }));

      const queue = refs.utteranceQueuesRef.current[0] || [];
      expect(queue.length).toBeGreaterThanOrEqual(4);
    });

    it('accumulates and eventually matches full line', async () => {
      const lines = ['The bear went home.'];
      const refs = createMockRefs();
      const state = createMockState(lines, 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'the bear',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'went home',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      expect(setAudioHasEnded).toHaveBeenCalled();
    });

    it('B2: accumulates partial "welcome to" then "my house"', async () => {
      const refs = createMockRefs();
      const state = createMockState(['\u201CWelcome to my house!\u201D'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'welcome to',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'my house',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      expect(setAudioHasEnded).toHaveBeenCalled();
    });

    it('B1: accumulates partial "happy birthday" then "clara"', async () => {
      const refs = createMockRefs();
      const state = createMockState(['\u201CHappy birthday, Clara!\u201D'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'happy birthday',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'clara',
        setAudioHasEnded,
      }));
      jest.runAllTimers();

      expect(setAudioHasEnded).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('ignores empty utterance', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: '',
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('ignores null utterance', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: null,
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('ignores undefined utterance', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: undefined,
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('ignores duplicate utterance', async () => {
      const refs = createMockRefs();
      refs.lastProcessedUtteranceRef.current = 'already processed';
      const state = createMockState(['Hello.'], 0, 0);
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'already processed',
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('skips non-reading lines', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);
      state.pagesValues[0].text[0].Reading = false;
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'hello',
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('does not match when role is Narrator (not a user-reading role)', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);
      state.CharacterRoles = [{ Character: 'Narrator', role: 'Narrator' }];
      const setAudioHasEnded = jest.fn();

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'hello',
        setAudioHasEnded,
      }));
      expect(setAudioHasEnded).not.toHaveBeenCalled();
    });

    it('updates lastProcessedUtteranceRef after processing', async () => {
      const refs = createMockRefs();
      const state = createMockState(['Hello.'], 0, 0);

      await processUserUtterance(buildCallArgs(refs, state, {
        userUtterance: 'hello world',
      }));
      expect(refs.lastProcessedUtteranceRef.current).toBe('hello world');
    });
  });
});
