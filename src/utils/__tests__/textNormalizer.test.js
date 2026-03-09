import { normalizeText, splitIntoSentences, isMultiSentenceLong } from '../textNormalizer';

// --- Combinatorial test data ---

const NUMBERS = [
  ['5', 'five'],
  ['10', 'ten'],
  ['100', 'one hundred'],
  ['32.2512', 'thirty two point two five one two'],
  ['0.75', 'zero point seven five'],
  ['2168', "two thousand one hundred sixty eight" ],
  ['100000', '100000'], // out of range, should stay numeric
  ['1st', 'first'],
  ['2nd', 'second'],
  ['3rd', 'third'],
  ['4th', 'fourth'],
  ['21st', 'twenty first'],
  ['1', 'one'],
  ['2', 'two'],
  ['3', 'three'],
  ['0', 'zero'],
  ['9999', 'nine thousand nine hundred ninety nine'],
];

const CONTRACTIONS = [
  ["aren't", "are not"], ["can't", "cannot"], ["couldn't", "could not"], ["didn't", "did not"],
  ["doesn't", "does not"], ["don't", "do not"], ["hadn't", "had not"], ["hasn't", "has not"],
  ["haven't", "have not"], ["he'd", "he would"], ["he'll", "he will"], ["he's", "he is"], ["i'd", "i would"],
  ["i'll", "i will"], ["i'm", "i am"], ["i've", "i have"], ["isn't", "is not"], ["it'd", "it would"],
  ["it'll", "it will"], ["it's", "it is"], ["let's", "let us"], ["mightn't", "might not"], ["mustn't", "must not"],
  ["she'd", "she would"], ["she'll", "she will"], ["she's", "she is"], ["shouldn't", "should not"],
  ["that's", "that is"], ["there's", "there is"], ["they'd", "they would"], ["they'll", "they will"], ["they're", "they are"],
  ["they've", "they have"], ["we'd", "we would"], ["we'll", "we will"], ["we're", "we are"], ["we've", "we have"],
  ["weren't", "were not"], ["what'll", "what will"], ["what're", "what are"], ["what's", "what is"], ["what've", "what have"],
  ["where's", "where is"], ["who'd", "who would"], ["who'll", "who will"], ["who're", "who are"], ["who's", "who is"],
  ["who've", "who have"], ["won't", "will not"], ["wouldn't", "would not"], ["you'd", "you would"], ["you'll", "you will"],
  ["you're", "you are"], ["you've", "you have"],
];

const PUNCTUATION_CASES = [
  ['"Hello," said Bear.', 'hello said bear'],
  ['Wait... what?', 'wait what'],
  ['The bear ran!', 'the bear ran'],
  ['(whispered) come here', 'whispered come here'],
  ['Go away, bear!', 'go away bear'],
  ['Bear? Where?', 'bear where'],
  ["The bear's honey.", 'the bears honey'],
  ['"Stop!" he yelled.', 'stop he yelled'],
  ['The bear (a grizzly) ate.', 'the bear a grizzly ate'],
  ['Look: a bear!', 'look a bear'],
  ['Bear; run now.', 'bear run now'],
  ['The bear... disappeared.', 'the bear disappeared'],
  ['Stop, bear, stop!', 'stop bear stop'],
  ['Is it a "bear"?', 'is it a bear'],
];

// Book dialogue normalization (after SSML stripping — curly quotes, smart apostrophes present)
// These test what normalizeText actually does to raw book text
const BOOK_DIALOGUE_CASES = [
  // Book 1: Birthday Beeps and Boops
  ['Hey, what are these decorations for?', 'hey what are these decorations for'],
  ['Come help!', 'come help'],
  ['Purple, green, purple, green!', 'purple green purple green'],
  ['Beep, boop, beep, boop!', 'beep boop beep boop'],
  ['Those are my favorite colors, too!', 'those are my favorite colors too'],
  ['Can you please tell me who this party is for?', 'can you please tell me who this party is for'],
  ['No time, no time!', 'no time no time'],
  ['We need more hats!', 'we need more hats'],
  ['We need plates!', 'we need plates'],
  ['I have an idea,', 'i have an idea'],
  ['How do I look?', 'how do i look'],
  ['Great!', 'great'],
  ['Beep, beep, boop! Beep, beep, boop!', 'beep beep boop beep beep boop'],
  ['Star, star, circle! Star, star, circle!', 'star star circle star star circle'],
  ['We fixed it!', 'we fixed it'],
  ['Happy birthday, Clara!', 'happy birthday clara'],
  ['For me?', 'for me'],
  ['Of course!', 'of course'],
  ['Keep it!', 'keep it'],
  ['It matches the pattern of the streamers.', 'it matches the pattern of the streamers'],
  ['It still tastes delicious!', 'it still tastes delicious'],
  // Book 2: Sleepover Similarities
  ['Welcome to my house!', 'welcome to my house'],
  ['This is going to be so much fun!', 'this is going to be so much fun'],
  ['Our sleeping bags have the same pattern!', 'our sleeping bags have the same pattern'],
  ['Ready or not, here I come!', 'ready or not here i come'],
  ['Sorry!', 'sorry'],
  ['I miss my house,', 'i miss my house'],
  ['Maybe your house is more like mine than you think,', 'maybe your house is more like mine than you think'],
  ['My curtains seem different,', 'my curtains seem different'],
  ['They go star, star, heart, star, star, heart.', 'they go star star heart star star heart'],
  ['Our blankets have the same pattern,', 'our blankets have the same pattern'],
  ['My flowers go tall, short, tall, short.', 'my flowers go tall short tall short'],
  ['You got it!', 'you got it'],
  ['I feel better.', 'i feel better'],
  // Book 3: Levels in the Library
  ['Books!', 'books'],
  ['Shh!', 'shh'],
  ['Use your inside voice.', 'use your inside voice'],
  ['What can we do here?', 'what can we do here'],
  ['We can pick out books,', 'we can pick out books'],
  ['Each of my stacks has one more book than the last.', 'each of my stacks has one more book than the last'],
];

// Book narrator lines for sentence splitting
// [input, isMultiSentence, expectedSentenceCount]
const MULTI_SENTENCE_CASES = [
  // Generic
  ['Hello there.', false, 1],
  ['Go!', false, 1],
  ['Short. Line.', false, 2],
  ['The big brown bear ran through the forest. He stopped suddenly.', true, 2],
  ['The bear ran away. He hid behind a tree. Then he peeked out carefully.', true, 3],
  // Book 1 narrator lines
  ['Clara asked.', false, 1],
  ['said Zoe.', false, 1],
  ['Clara beamed.', false, 1],
  ['Zoe set the table.', false, 1],
  ['Clara and Zoe moved the balloons.', false, 1],
  ['They threw open the cake box.', false, 1],
  ['Clara saw Zoe was upset. Zoe was still her best friend. Clara took a deep breath.', true, 3],
  // Book 2 narrator lines
  ['said Clara.', false, 1],
  ['Zoe worried.', false, 1],
  ['Clara cried.', false, 1],
  ['Zoe admitted.', false, 1],
  ['She looked around. No Clara.', true, 2],
  ['Zoe checked under the blanket. No Clara.', true, 2],
  ['She opened the closet. No Clara.', true, 2],
  // Book 3 narrator lines
  ['Clara whispered.', false, 1],
];

// --- Tests ---

describe('textNormalizer', () => {

  describe('normalizeText', () => {

    describe('number conversion', () => {
      NUMBERS.forEach(([input, expected]) => {
        it(`converts "${input}" to "${expected}"`, () => {
          const result = normalizeText(`${input}`);
          expect(result[0]).toContain(expected);
        });
      });

      it('converts Book3 counting: "1 book"', () => {
        const result = normalizeText('1 book');
        expect(result[0]).toContain('one');
      });

      it('converts Book3 counting: "2 books"', () => {
        const result = normalizeText('2 books');
        expect(result[0]).toContain('two');
      });

      it('converts Book3 counting: "3 books"', () => {
        const result = normalizeText('3 books');
        expect(result[0]).toContain('three');
      });

      it('converts Book2 counting: "eighteen, nineteen, twenty"', () => {
        const result = normalizeText('18, 19, 20');
        expect(result[0]).toContain('eighteen');
        expect(result[0]).toContain('nineteen');
        expect(result[0]).toContain('twenty');
      });
    });

    describe('contraction expansion', () => {
      CONTRACTIONS.forEach(([contraction, expanded]) => {
        it(`expands "${contraction}" to "${expanded}"`, () => {
          const result = normalizeText(`I ${contraction} know`);
          const hasExpansion = result.some(variant => variant.includes(expanded));
          expect(hasExpansion).toBe(true);
        });
      });
    });

    describe('punctuation stripping', () => {
      PUNCTUATION_CASES.forEach(([input, expected]) => {
        it(`strips punctuation: "${input}"`, () => {
          const result = normalizeText(input);
          const normalized = result[0].replace(/\s+/g, ' ').trim();
          expect(normalized).toBe(expected);
        });
      });
    });

    describe('book dialogue normalization', () => {
      BOOK_DIALOGUE_CASES.forEach(([input, expected]) => {
        it(`normalizes: "${input.substring(0, 50)}..."`, () => {
          const result = normalizeText(input);
          const normalized = result[0].replace(/\s+/g, ' ').trim();
          expect(normalized).toBe(expected);
        });
      });
    });

    describe('returns multiple variants for contractions', () => {
      it('returns both contracted and expanded for "don\'t"', () => {
        const result = normalizeText("I don't know");
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result[0]).toContain('do not');
        expect(result.some(v => v.includes('dont'))).toBe(true);
      });

      it('returns single variant when no contractions', () => {
        const result = normalizeText('the bear ran home');
        expect(result.length).toBe(1);
        expect(result[0]).toBe('the bear ran home');
      });
    });

    describe('edge cases', () => {
      it('handles empty string', () => {
        expect(normalizeText('')).toBe('');
      });

      it('handles null', () => {
        expect(normalizeText(null)).toBe('');
      });

      it('handles undefined', () => {
        expect(normalizeText(undefined)).toBe('');
      });

      it('passes through numbers > 9999', () => {
        const result = normalizeText('there are 10000 stars');
        expect(result[0]).toContain('10000');
      });

      it('lowercases all text', () => {
        const result = normalizeText('HELLO WORLD');
        expect(result[0]).toBe('hello world');
      });

      it('trims whitespace', () => {
        const result = normalizeText('  hello  ');
        expect(result[0]).toBe('hello');
      });
    });

    describe('combined transformations with book content', () => {
      it('handles numbers + punctuation: "There are 3 bears!"', () => {
        const result = normalizeText('There are 3 bears!');
        const normalized = result[0].replace(/\s+/g, ' ').trim();
        expect(normalized).toBe('there are three bears');
      });

      it('handles Book3 counting with numbers and punctuation', () => {
        const result = normalizeText('one book. One, two books. One, two, three books.');
        const normalized = result[0].replace(/\s+/g, ' ').trim();
        expect(normalized).toContain('one book');
        expect(normalized).toContain('two books');
        expect(normalized).toContain('three books');
      });
    });
  });

  describe('splitIntoSentences', () => {
    MULTI_SENTENCE_CASES.forEach(([input, , expectedCount]) => {
      it(`splits "${input.substring(0, 40)}..." into ${expectedCount} sentence(s)`, () => {
        const result = splitIntoSentences(input);
        expect(result.length).toBe(expectedCount);
      });
    });

    describe('book narrator line splitting', () => {
      it('B1: splits "Clara saw Zoe was upset. Zoe was still her best friend. Clara took a deep breath."', () => {
        const result = splitIntoSentences('Clara saw Zoe was upset. Zoe was still her best friend. Clara took a deep breath.');
        expect(result.length).toBe(3);
        expect(result[0]).toContain('Clara saw Zoe');
        expect(result[2]).toContain('deep breath');
      });

      it('B1: keeps "They threw open the cake box." as single sentence', () => {
        const result = splitIntoSentences('They threw open the cake box.');
        expect(result.length).toBe(1);
      });
    });
  });
});
