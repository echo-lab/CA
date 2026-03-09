import { cleanFillerWords, findSubsequenceMatch, calculateHybridScore } from '../speechMatcher';

// --- Combinatorial test data ---

// All filler words from speechMatcher.js FILLER_WORDS set
const FILLER_WORDS = ['uh', 'um', 'like', 'basically', 'ummm',
  'actually', 'uh', 'uhh', 'uhhh', 'uhhhh', 'huh', 'huhh',
  'huhhh', 'um', 'umm', 'ummm', 'ummmm', 'ah', 'ahh', 'ahhh', 'ahhhh',
  'er', 'err', 'errr', 'eh', 'ehh', 'ehhh', 'hm', 'hmm', 'hmmm',
  'hmmmm', 'mhm', 'mhmm', 'erm', 'ermm', 'ermmm',
  'literally', 'honestly', 'obviously', 'well', 'anyway', 'anyways',
];

const FILLER_POSITIONS = [
  { label: 'prefix', fn: (f) => `${f} the bear went home` },
  { label: 'middle', fn: (f) => `the bear ${f} went home` },
  { label: 'suffix', fn: (f) => `the bear went home ${f}` },
];

// [expectedText, spokenWords, shouldMatch, description]
const SUBSEQUENCE_CASES = [
  ['hey what are these decorations for', ['what', 'are', 'hey', 'these'], false, 'B1: decorations wrong order'],
  ['come help', ['come', 'help'], true, 'B1: come help exact'],
  ['come help', ['please', 'come', 'help', 'me'], true, 'B1: come help with noise'],
  ['beep boop beep boop', ['beep', 'beep', 'boop', 'boop'], false, 'B1: beep boop wrong order'],
  ['happy birthday clara', ['happy', 'birthday', 'clara'], true, 'B1: happy birthday exact'],
  ['star star circle star star circle', ['star', 'star', 'circle', 'star', 'star', 'circle'], true, 'B1: star circle pattern exact'],
  ['it matches the pattern of the streamers', ['it', 'matches', 'the', 'pattern', 'of', 'the', 'streamers'], true, 'B1: streamers exact'],
  ['welcome to my house', ['my', 'house', 'welcome', 'to'], false, 'B2: welcome wrong order'],
  ['this is going to be so much fun', ['this', 'is', 'going', 'to', 'be', 'so', 'much', 'fun'], true, 'B2: so much fun exact'],
  ['our sleeping bags have the same pattern', ['our', 'sleeping', 'bags', 'have', 'the', 'same', 'pattern'], true, 'B2: sleeping bags exact'],
  ['my flowers go tall short tall short', ['my', 'flowers', 'go', 'tall', 'short', 'tall', 'short'], true, 'B2: flowers pattern exact'],
  ['i miss my house', ['i', 'miss', 'my', 'house'], true, 'B2: miss my house exact'],
  ['books', ['books'], true, 'B3: single word exact'],
  ['use your inside voice', ['use', 'your', 'inside', 'voice'], true, 'B3: inside voice exact'],
  ['use your inside voice', ['use', 'inside', 'voice'], false, 'B3: inside voice missing word'],
  ['what can we do here', ['what', 'can', 'we', 'do', 'here'], true, 'B3: what can we do exact'],
  ['we can pick out books', ['we', 'can', 'pick', 'out', 'books'], true, 'B3: pick out books exact'],
  ['each of my stacks has one more book than the last', ['each', 'of', 'my', 'stacks', 'has', 'one', 'more', 'book', 'than', 'the', 'last'], true, 'B3: stacks line exact'],
];

// [word1, word2] — phonetically similar pairs (character names + book vocabulary)
const PHONETIC_PAIRS = [
  // Homophones
  ['bear', 'bare'],
  ['night', 'knight'],
  ['their', 'there'],
  ['flower', 'flour'],
  ['see', 'sea'],
  ['to', 'too'],
  ['hear', 'here'],
  ['right', 'write'],
  ['tale', 'tail'],
  ['won', 'one'],
  // Character name misrecognitions
  ['zoe', 'zoh'],
  ['zoe', 'zo'],
  ['zoe', 'so'],
  ['clara', 'clara'],
  ['clara', 'clarify'],
  ['clara', 'clarity'],
  ['clara', 'clarinet'],
  ['clara', 'clarion'],
  ['clara', 'claret'],
  ['clara', 'declare'],
  ['clara', 'area'],
  ['clara', 'sierra'],
  ['clara', 'tiara'],
  // Book vocabulary ASR confusions
  ['house', 'hows'],
  ['pattern', 'patton'],
  ['beep', 'bead'],
  ['boop', 'boot'],
  ['cake', 'cape'],
  ['hide', 'height'],
  ['heart', 'hart'],
  ['circle', 'surgical'],
];

// [utterance, target, shouldMatch, description]
const THRESHOLD_CASES = [
  // Basic
  ['the bear went home', 'the bear went home', true, 'identical strings'],
  ['the bear went home', 'the bare went home', true, 'one phonetic error'],
  ['pizza delivery tonight', 'the bear went home', false, 'no relation'],
  ['completely unrelated words here', 'the bear went home', false, 'totally different content'],
  // Book 1 dialogue
  ['come help', 'come help', true, 'B1: come help identical'],
  ['purple green purple green', 'purple green purple green', true, 'B1: pattern chant identical'],
  ['beep bood beep bood', 'beep boop beep boop', true, 'B1: beep boop ASR error'],
  ['happy birthday klara', 'happy birthday clara', true, 'B1: birthday phonetic error'],
  ['stir star sickle star star circle', 'star star circle star star circle', true, 'B1: star circle ASR and phonetic errors'],
  ['we faxed it', 'we fixed it', true, 'B1: we fixed it ASR error'],
  ['off coarse', 'of course', true, 'B1: of course phonetic error'],
  ['i want to eat pizza', 'come help', false, 'B1: unrelated vs come help'],
  // Book 2 dialogue
  ['welcome to my house', 'welcome to my house', true, 'B2: welcome identical'],
  ['welcum too my howse', 'welcome to my house', true, 'B2: welcome ASR errors'],
  ['hey is going to be so much fun', 'this is going to be so much fun', true, 'B2: so much fun missing word'],
  ['our shipping bags has the same pattern', 'our sleeping bags have the same pattern', true, 'B2: sleeping bags ASR and phonetic errors'],
  ['sip sap sip sap', 'zip zap zip zap', true, 'B2: zip zap phonetic error'],
  ['zip zap zoo dely zoop', 'zip zap zoodely zoop', true, 'B2: zoodely zoop ASR error'],
  ['i miss my house', 'i miss my house', true, 'B2: miss my house identical'],
  ['i feel batter', 'i feel better', true, 'B2: feel better phonetic error'],
  ['my flowers go tall shot tell short', 'my flowers go tall short tall short', true, 'B2: flowers pattern ASR error'],
  // Book 3 dialogue
  ['use your inside voice', 'use your inside voice', true, 'B3: inside voice identical'],
  ['can we do here alright', 'what can we do here', true, 'B3: what can we do ASR error'],
  ["we can't pick out boots", 'we can pick out books', true, 'B3: pick out books ASR and phonetic errors'],
  ['each of this stack has more books than the last', 'each of my stacks has one more book than the last', true, 'B3: stacks unrelated'],
];

// --- Tests ---

describe('speechMatcher', () => {

  describe('cleanFillerWords', () => {

    describe('filler removal by position', () => {
      FILLER_WORDS.forEach(filler => {
        FILLER_POSITIONS.forEach(({ label, fn }) => {
          it(`removes "${filler}" from ${label}`, () => {
            const result = cleanFillerWords(fn(filler));
            expect(result.cleaned).toBe('the bear went home');
            expect(result.removed).toContain(filler);
          });
        });
      });
    });

    describe('fillers in book dialogue', () => {
      it('cleans fillers from B1 "come help"', () => {
        const result = cleanFillerWords('um come uh help');
        expect(result.cleaned).toBe('come help');
      });

      it('cleans fillers from B2 "welcome to my house"', () => {
        const result = cleanFillerWords('uh welcome um to like my house');
        expect(result.cleaned).toBe('welcome to my house');
      });

      it('cleans fillers from B3 "use your inside voice"', () => {
        const result = cleanFillerWords('well use your um inside voice');
        expect(result.cleaned).toBe('use your inside voice');
      });

      it('cleans fillers around character name Clara', () => {
        const result = cleanFillerWords('uh happy birthday um clara');
        expect(result.cleaned).toBe('happy birthday clara');
      });

      it('cleans fillers around character name Zoe', () => {
        const result = cleanFillerWords('um come help uh zoe');
        expect(result.cleaned).toBe('come help zoe');
      });

      it('cleans fillers from pattern chant "beep boop"', () => {
        const result = cleanFillerWords('um beep uh boop like beep boop');
        expect(result.cleaned).toBe('beep boop beep boop');
      });

      it('cleans fillers from pattern chant "zip zap"', () => {
        const result = cleanFillerWords('ah zip um zap zip zap');
        expect(result.cleaned).toBe('zip zap zip zap');
      });

      it('cleans multiple fillers from long book line', () => {
        const result = cleanFillerWords('um it like matches the uh pattern of the um streamers');
        expect(result.cleaned).toBe('it matches the pattern of the streamers');
      });
    });

    describe('edge cases', () => {
      it('handles empty string', () => {
        const result = cleanFillerWords('');
        expect(result.cleaned).toBe('');
        expect(result.removed).toEqual([]);
      });

      it('handles null', () => {
        const result = cleanFillerWords(null);
        expect(result.cleaned).toBe('');
      });

      it('handles undefined', () => {
        const result = cleanFillerWords(undefined);
        expect(result.cleaned).toBe('');
      });

      it('handles number input', () => {
        const result = cleanFillerWords(42);
        expect(result.cleaned).toBe('');
      });

      it('preserves text with no fillers', () => {
        const result = cleanFillerWords('the bear went home');
        expect(result.cleaned).toBe('the bear went home');
        expect(result.removed).toEqual([]);
      });

      it('handles text that is all fillers', () => {
        const result = cleanFillerWords('uh um like basically');
        expect(result.cleaned).toBe('');
        expect(result.removed.length).toBe(4);
      });

      it('preserves original in result', () => {
        const input = 'um hello there';
        const result = cleanFillerWords(input);
        expect(result.original).toBe(input);
      });

      it('handles single filler word', () => {
        const result = cleanFillerWords('um');
        expect(result.cleaned).toBe('');
        expect(result.removed).toContain('um');
      });

      it('handles single non-filler word', () => {
        const result = cleanFillerWords('books');
        expect(result.cleaned).toBe('books');
        expect(result.removed).toEqual([]);
      });

      it('preserves "likely" (not same as filler "like")', () => {
        const result = cleanFillerWords('this is likely correct');
        expect(result.cleaned).toBe('this is likely correct');
      });
    });
  });

  describe('findSubsequenceMatch', () => {
    SUBSEQUENCE_CASES.forEach(([expected, spoken, shouldMatch, desc]) => {
      it(desc, () => {
        const result = findSubsequenceMatch(expected, spoken);
        if (shouldMatch) {
          expect(result).not.toBeNull();
          expect(result).toHaveProperty('startIdx');
          expect(result).toHaveProperty('endIdx');
        } else {
          expect(result).toBeNull();
        }
      });
    });

    describe('array of expected options', () => {
      it('matches second option when first fails', () => {
        const result = findSubsequenceMatch(
          ['wrong text entirely', 'the bear went home'],
          ['the', 'bear', 'went', 'home']
        );
        expect(result).not.toBeNull();
      });

      it('matches B1 dialogue with multiple normalized variants', () => {
        const result = findSubsequenceMatch(
          ['lets choose a cake', 'let us choose a cake'],
          ['let', 'us', 'choose', 'a', 'cake']
        );
        expect(result).not.toBeNull();
      });

      it('returns null when no option matches', () => {
        const result = findSubsequenceMatch(
          ['cats and dogs', 'birds and bees'],
          ['happy', 'birthday']
        );
        expect(result).toBeNull();
      });
    });

    describe('index correctness', () => {
      it('returns correct indices for B1 "come help" with noise', () => {
        const result = findSubsequenceMatch(
          'come help',
          ['um', 'come', 'help', 'please']
        );
        expect(result).not.toBeNull();
        expect(result.startIdx).toBe(1);
        expect(result.endIdx).toBe(3);
      });

      it('returns correct indices for B2 "welcome to my house" with noise', () => {
        const result = findSubsequenceMatch(
          'welcome to my house',
          ['oh', 'welcome', 'to', 'my', 'house', 'yeah']
        );
        expect(result).not.toBeNull();
        expect(result.startIdx).toBe(1);
        expect(result.endIdx).toBe(5);
      });

      it('returns 0-based start for exact match at beginning', () => {
        const result = findSubsequenceMatch('books', ['books']);
        expect(result).not.toBeNull();
        expect(result.startIdx).toBe(0);
        expect(result.endIdx).toBe(1);
      });
    });
  });

  describe('calculateHybridScore', () => {

    describe('phonetic similarity', () => {
      PHONETIC_PAIRS.forEach(([word1, word2]) => {
        it(`"${word1}" matches "${word2}" phonetically`, () => {
          const result = calculateHybridScore(
            `the ${word1} is here`,
            `the ${word2} is here`
          );
          expect(result.confidence).toBeGreaterThanOrEqual(0.5);
          expect(result.phoneticScore).toBeLessThan(0.5);
        });
      });
    });

    describe('threshold boundaries', () => {
      THRESHOLD_CASES.forEach(([utterance, target, shouldMatch, desc]) => {
        it(desc, () => {
          const result = calculateHybridScore(utterance, target);
          expect(result.matched).toBe(shouldMatch);
          if (shouldMatch) {
            expect(result.confidence).toBeGreaterThanOrEqual(0.6);
          } else {
            expect(result.confidence).toBeLessThan(0.6);
          }
        });
      });
    });

    describe('array targets (contraction variants from books)', () => {
      it('B1: "i do not know whats missing" vs contracted/expanded', () => {
        const result = calculateHybridScore(
          'i do not know whats missing',
          ['i dont know whats missing', 'i do not know whats missing']
        );
        expect(result.matched).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('B2: "lets play hide and seek" vs "let us play hide and seek"', () => {
        const result = calculateHybridScore(
          'let us play hide and seek',
          ['lets play hide and seek', 'let us play hide and seek']
        );
        expect(result.matched).toBe(true);
      });

      it('B2: "its the same pattern though" vs expanded', () => {
        const result = calculateHybridScore(
          'it is the same pattern though',
          ['its the same pattern though', 'it is the same pattern though']
        );
        expect(result.matched).toBe(true);
      });

      it('B1: "youre my best friend" vs expanded', () => {
        const result = calculateHybridScore(
          'you are my best friend',
          ['youre my best friend', 'you are my best friend']
        );
        expect(result.matched).toBe(true);
      });
    });

    describe('filler word tolerance with book dialogue', () => {
      it('ignores fillers when scoring generic text', () => {
        const withFillers = calculateHybridScore(
          'um the bear like went home',
          'the bear went home'
        );
        const withoutFillers = calculateHybridScore(
          'the bear went home',
          'the bear went home'
        );
        expect(withFillers.matched).toBe(true);
        expect(Math.abs(withFillers.confidence - withoutFillers.confidence)).toBeLessThan(0.2);
      });

      it('B1: ignores fillers in "um come uh help"', () => {
        const result = calculateHybridScore('um come uh help', 'come help');
        expect(result.matched).toBe(true);
      });

      it('B2: ignores fillers in "uh welcome um to my house"', () => {
        const result = calculateHybridScore('uh welcome um to my house', 'welcome to my house');
        expect(result.matched).toBe(true);
      });

      it('B3: ignores fillers in "um books"', () => {
        const result = calculateHybridScore('um books', 'books');
        expect(result.matched).toBe(true);
      });

      it('B2: ignores fillers in "like zip zap um zip zap"', () => {
        const result = calculateHybridScore('like zip zap um zip zap', 'zip zap zip zap');
        expect(result.matched).toBe(true);
      });

      it('B1: ignores fillers in "uh beep boop um beep boop"', () => {
        const result = calculateHybridScore('uh beep boop um beep boop', 'beep boop beep boop');
        expect(result.matched).toBe(true);
      });
    });

    describe('cross-book non-matches', () => {
      it('B1 line does not match B2 line', () => {
        const result = calculateHybridScore('come help', 'welcome to my house');
        expect(result.matched).toBe(false);
      });

      it('B2 line does not match B3 line', () => {
        const result = calculateHybridScore('zip zap zip zap', 'use your inside voice');
        expect(result.matched).toBe(false);
      });

      it('B1 pattern does not match B2 pattern', () => {
        const result = calculateHybridScore('beep boop beep boop', 'zip zap zip zap');
        expect(result.matched).toBe(false);
      });
    });

    describe('result object shape', () => {
      it('returns all expected properties', () => {
        const result = calculateHybridScore('hello', 'hello');
        expect(result).toHaveProperty('fuzzyScore');
        expect(result).toHaveProperty('phoneticScore');
        expect(result).toHaveProperty('combinedScore');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('matched');
        expect(result).toHaveProperty('cleanedUtterance');
        expect(result).toHaveProperty('cleanedTarget');
      });

      it('confidence is between 0 and 1', () => {
        const result = calculateHybridScore('hello world', 'goodbye moon');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });

      it('perfect match has confidence near 1', () => {
        const result = calculateHybridScore('the bear went home', 'the bear went home');
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      });
    });
  });
});
