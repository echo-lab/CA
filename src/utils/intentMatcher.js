/**
 * Intent Matcher - Hybrid Fuzzy + Phonetic Matching System
 *
 * Combines Fuse.js (character-based fuzzy matching) with phonetic matching
 * using Talisman's Double Metaphone algorithm (browser-compatible).
 *
 * TUNING GUIDE:
 * -------------
 * - High typo noise (keyboard errors): Increase fuzzyWeight (e.g., 0.7)
 * - High phonetic noise (speech recognition): Increase phoneticWeight (e.g., 0.7)
 * - Balanced noise: Use equal weights (0.5, 0.5)
 * - For speech-to-text applications: Recommend phoneticWeight >= 0.6
 */

import Fuse from 'fuse.js';
import doubleMetaphone from 'talisman/phonetics/double-metaphone';
import levenshtein from 'talisman/metrics/levenshtein';
import { TokenizerEn } from '@nlpjs/lang-en';

// ============================================================================
// FILLER WORD REMOVAL (using NLP.js tokenizer)
// ============================================================================

// Common speech disfluencies and filler words
const FILLER_WORDS = new Set([
  // Hesitation sounds (with variations)
  'uh', 'uhh', 'uhhh', 'uhhhh',
  'um', 'umm', 'ummm', 'ummmm',
  'ah', 'ahh', 'ahhh', 'ahhhh',
  'er', 'err', 'errr',
  'eh', 'ehh', 'ehhh',
  'hm', 'hmm', 'hmmm', 'hmmmm',
  'mhm', 'mhmm',
  'erm',
  // Common filler phrases
  'like',
  'basically',
  'actually',
  'literally',
  'honestly',
  'obviously',
  'so',
  'well',
  'anyway',
  'anyways',
  // You can add more as needed
]);

// Initialize NLP.js English tokenizer
const tokenizer = new TokenizerEn();

/**
 * Remove filler words from text using NLP.js tokenizer
 *
 * @param {string} text - Input text (utterance or expected text)
 * @returns {object} { cleaned: string, removed: string[], original: string }
 *
 * @example
 * cleanFillerWords("uhhh maybe two apples")
 * // Returns: { cleaned: "maybe two apples", removed: ["uhhh"], original: "uhhh maybe two apples" }
 */
export function cleanFillerWords(text) {
  if (!text || typeof text !== 'string') {
    return { cleaned: '', removed: [], original: text || '' };
  }

  const original = text.toLowerCase().trim();

  // Use NLP.js tokenizer to split into tokens
  const tokens = tokenizer.tokenize(original);

  // Filter out filler words
  const removed = [];
  const cleanedTokens = tokens.filter(token => {
    const lowerToken = token.toLowerCase();
    if (FILLER_WORDS.has(lowerToken)) {
      removed.push(token);
      return false;
    }
    return true;
  });

  return {
    cleaned: cleanedTokens.join(' '),
    removed,
    original,
  };
}

/**
 * Clean filler words from an array of words
 *
 * @param {string[]} words - Array of words
 * @returns {object} { cleaned: string[], removed: string[] }
 */
export function cleanFillerWordsFromArray(words) {
  if (!Array.isArray(words)) {
    return { cleaned: [], removed: [] };
  }

  const removed = [];
  const cleaned = words.filter(word => {
    const lowerWord = word.toLowerCase();
    if (FILLER_WORDS.has(lowerWord)) {
      removed.push(word);
      return false;
    }
    return true;
  });

  return { cleaned, removed };
}

// ============================================================================
// CONFIGURATION - Tune these weights based on your input noise type
// ============================================================================

const DEFAULT_CONFIG = {
  // Weight for exact word matching
  // Higher = stricter matching, requires exact words present
  exactWordWeight: 0.3,

  // Weight for character-based fuzzy matching (Fuse.js)
  // Higher = better for typos, keyboard errors
  fuzzyWeight: 0.3,

  // Weight for phonetic matching (sound-based)
  // Higher = better for speech recognition errors, homophones
  phoneticWeight: 0.4,

  // Fuse.js options
  fuseOptions: {
    includeScore: true,
    threshold: 0.6,        // 0.0 = perfect match required, 1.0 = match anything
    ignoreLocation: true,  // Search entire string, not just beginning
    minMatchCharLength: 2,
  },

  // Tie-breaking threshold: if scores differ by less than this, use phonetic
  tieBreakThreshold: 0.05,

  // Score threshold for considering a match valid (confidence >= this = match)
  matchThreshold: 0.6,
};

// ============================================================================
// PHONETIC DISTANCE CALCULATOR (using Talisman Double Metaphone)
// ============================================================================

/**
 * Calculate phonetic distance between two strings
 * Uses Double Metaphone algorithm to compare how words "sound"
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Normalized distance (0 = identical sound, 1 = completely different)
 */
function calculatePhoneticDistance(str1, str2) {
  if (!str1 || !str2) return 1;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 0;

  try {
    // Split into words and compare phonetically
    const words1 = s1.split(/\s+/).filter(w => w.length > 0);
    const words2 = s2.split(/\s+/).filter(w => w.length > 0);

    if (words1.length === 0 || words2.length === 0) return 1;

    // Get phonetic codes for each word using Double Metaphone
    const codes1 = words1.map(word => {
      const codes = doubleMetaphone(word);
      return codes[0] || codes[1] || word; // Primary or alternate code
    }).join(' ');

    const codes2 = words2.map(word => {
      const codes = doubleMetaphone(word);
      return codes[0] || codes[1] || word;
    }).join(' ');

    // If phonetic codes are identical, perfect match
    if (codes1 === codes2) return 0;

    // Calculate Levenshtein distance between phonetic codes
    const distance = levenshtein(codes1, codes2);
    const maxLength = Math.max(codes1.length, codes2.length);

    // Normalize: distance / maxLength, capped at 1
    const normalizedDistance = Math.min(distance / maxLength, 1);

    return normalizedDistance;
  } catch (error) {
    console.warn('Phonetic matching error:', error);
    return 1; // Return worst score on error
  }
}

// ============================================================================
// INTENT MATCHER CLASS
// ============================================================================

export class IntentMatcher {
  /**
   * Create an Intent Matcher instance
   *
   * @param {string[]} targets - Array of target phrases to match against
   * @param {object} config - Configuration options (optional)
   */
  constructor(targets, config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.targets = targets;

    // Initialize Fuse.js with target phrases
    this.fuse = new Fuse(
      targets.map((phrase, index) => ({ phrase, index })),
      {
        ...this.config.fuseOptions,
        keys: ['phrase'],
      }
    );
  }

  /**
   * Update the target phrases
   * @param {string[]} newTargets - New array of target phrases
   */
  updateTargets(newTargets) {
    this.targets = newTargets;
    this.fuse = new Fuse(
      newTargets.map((phrase, index) => ({ phrase, index })),
      {
        ...this.config.fuseOptions,
        keys: ['phrase'],
      }
    );
  }

  /**
   * Match utterance against all targets and return scored results
   *
   * @param {string} utterance - User utterance to match
   * @returns {object} Match result with scores
   */
  match(utterance) {
    if (!utterance || !this.targets.length) {
      return {
        matched: false,
        bestMatch: null,
        confidence: 0,
        scores: [],
      };
    }

    const normalizedUtterance = utterance.toLowerCase().trim();

    // Get fuzzy matches from Fuse.js
    const fuseResults = this.fuse.search(normalizedUtterance);

    // Calculate scores for all targets
    const scores = this.targets.map((target, index) => {
      const normalizedTarget = target.toLowerCase().trim();

      // Fuzzy score from Fuse.js (0 = perfect, 1 = no match)
      const fuseMatch = fuseResults.find(r => r.item.index === index);
      const fuzzyScore = fuseMatch ? fuseMatch.score : 1;

      // Phonetic score (0 = perfect, 1 = no match)
      const phoneticScore = calculatePhoneticDistance(normalizedUtterance, normalizedTarget);

      // Combined score using weighted average
      const combinedScore =
        (this.config.fuzzyWeight * fuzzyScore) +
        (this.config.phoneticWeight * phoneticScore);

      return {
        target,
        index,
        fuzzyScore,
        phoneticScore,
        combinedScore,
        // Convert to confidence (0 = no match, 1 = perfect)
        confidence: 1 - combinedScore,
      };
    });

    // Sort by combined score (lower is better)
    scores.sort((a, b) => a.combinedScore - b.combinedScore);

    // Apply tie-breaking: if top two are close, prefer better phonetic match
    if (scores.length >= 2) {
      const [first, second] = scores;
      const scoreDiff = Math.abs(first.combinedScore - second.combinedScore);

      if (scoreDiff < this.config.tieBreakThreshold) {
        // Scores are very close - prefer better phonetic match
        if (second.phoneticScore < first.phoneticScore) {
          // Swap if second has better phonetic score
          [scores[0], scores[1]] = [scores[1], scores[0]];
        }
      }
    }

    const bestMatch = scores[0];
    const matched = bestMatch.combinedScore <= this.config.matchThreshold;

    return {
      matched,
      bestMatch: {
        target: bestMatch.target,
        index: bestMatch.index,
        fuzzyScore: bestMatch.fuzzyScore,
        phoneticScore: bestMatch.phoneticScore,
        combinedScore: bestMatch.combinedScore,
        confidence: bestMatch.confidence,
      },
      allScores: scores,
    };
  }

  /**
   * Quick check if utterance matches a specific target
   *
   * @param {string} utterance - User utterance
   * @param {string} target - Specific target to check
   * @returns {object} Score details for this specific match
   */
  matchSingle(utterance, target) {
    const normalizedUtterance = utterance.toLowerCase().trim();
    const normalizedTarget = target.toLowerCase().trim();

    // Fuzzy score using Fuse.js logic
    const tempFuse = new Fuse([{ phrase: target }], {
      ...this.config.fuseOptions,
      keys: ['phrase'],
    });
    const fuseResult = tempFuse.search(normalizedUtterance);
    const fuzzyScore = fuseResult.length > 0 ? fuseResult[0].score : 1;

    // Phonetic score
    const phoneticScore = calculatePhoneticDistance(normalizedUtterance, normalizedTarget);

    // Combined score
    const combinedScore =
      (this.config.fuzzyWeight * fuzzyScore) +
      (this.config.phoneticWeight * phoneticScore);

    return {
      target,
      fuzzyScore,
      phoneticScore,
      combinedScore,
      confidence: 1 - combinedScore,
      matched: combinedScore <= this.config.matchThreshold,
    };
  }
}

// ============================================================================
// STANDALONE FUNCTIONS (for use without class instantiation)
// ============================================================================

/**
 * Calculate exact word match score
 * Checks if expected words exist in the spoken words list
 *
 * @param {string[]} spokenWords - Array of spoken words
 * @param {string[]} expectedWords - Array of expected words
 * @returns {object} { matchedWords, matchPercentage, exactMatchScore }
 */
function calculateExactWordMatch(spokenWords, expectedWords) {
  if (expectedWords.length === 0) {
    return { matchedWords: [], matchPercentage: 0, exactMatchScore: 1 };
  }

  // Check if expected words exist in spoken words list
  const matchedWords = expectedWords.filter(word =>
    spokenWords.includes(word)
  );

  const matchPercentage = matchedWords.length / expectedWords.length;

  // Convert to score where 0 = perfect match, 1 = no match
  const exactMatchScore = 1 - matchPercentage;

  return { matchedWords, matchPercentage, exactMatchScore };
}

/**
 * Calculate hybrid match score between utterance and target
 * Combines exact word matching, fuzzy matching (Fuse.js), and phonetic matching
 * Automatically cleans filler words from both utterance and target before matching
 *
 * @param {string} utterance - User utterance
 * @param {string} target - Target phrase to match
 * @param {object} options - Optional configuration
 * @returns {object} Score details
 */
export function calculateHybridScore(utterance, target, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  // Clean filler words from both utterance and target
  const cleanedUtterance = cleanFillerWords(utterance);
  const cleanedTarget = cleanFillerWords(target);

  const normalizedUtterance = cleanedUtterance.cleaned;
  const normalizedTarget = cleanedTarget.cleaned;

  // Split into words for exact matching
  const spokenWords = normalizedUtterance.split(/\s+/).filter(w => w.length > 0);
  const expectedWords = normalizedTarget.split(/\s+/).filter(w => w.length > 0);

  // Perfect match - strings are identical
  if (normalizedUtterance === normalizedTarget) {
    return {
      exactMatchScore: 0,
      fuzzyScore: 0,
      phoneticScore: 0,
      combinedScore: 0,
      confidence: 1,
      matched: true,
      matchedWords: expectedWords,
      matchPercentage: 1,
      cleanedUtterance: normalizedUtterance,
      cleanedTarget: normalizedTarget,
      removedFillers: {
        fromUtterance: cleanedUtterance.removed,
        fromTarget: cleanedTarget.removed,
      },
    };
  }

  // Exact word match
  const exactResult = calculateExactWordMatch(spokenWords, expectedWords);

  // If all expected words are found, it's a full match regardless of other scores
  if (exactResult.matchPercentage === 1) {
    return {
      exactMatchScore: 0,
      fuzzyScore: 0,
      phoneticScore: 0,
      combinedScore: 0,
      confidence: 1,
      matched: true,
      matchedWords: exactResult.matchedWords,
      matchPercentage: 1,
      cleanedUtterance: normalizedUtterance,
      cleanedTarget: normalizedTarget,
      removedFillers: {
        fromUtterance: cleanedUtterance.removed,
        fromTarget: cleanedTarget.removed,
      },
    };
  }

  // Fuzzy score using Fuse.js (0 = perfect, 1 = no match)
  const fuse = new Fuse([{ phrase: normalizedTarget }], {
    ...config.fuseOptions,
    keys: ['phrase'],
  });
  const fuseResult = fuse.search(normalizedUtterance);
  const fuzzyScore = fuseResult.length > 0 ? fuseResult[0].score : 1;

  // Phonetic score (0 = perfect, 1 = no match)
  const phoneticScore = calculatePhoneticDistance(normalizedUtterance, normalizedTarget);

  // Combined score (weighted average, 0 = perfect, 1 = no match)
  const combinedScore =
    (config.exactWordWeight * exactResult.exactMatchScore) +
    (config.fuzzyWeight * fuzzyScore) +
    (config.phoneticWeight * phoneticScore);

  // Confidence is inverse of combined score (0 = no match, 1 = perfect)
  const confidence = 1 - combinedScore;

  return {
    exactMatchScore: exactResult.exactMatchScore,
    fuzzyScore,
    phoneticScore,
    combinedScore,
    confidence,
    matched: confidence >= config.matchThreshold,
    matchedWords: exactResult.matchedWords,
    matchPercentage: exactResult.matchPercentage,
    cleanedUtterance: normalizedUtterance,
    cleanedTarget: normalizedTarget,
    removedFillers: {
      fromUtterance: cleanedUtterance.removed,
      fromTarget: cleanedTarget.removed,
    },
  };
}

/**
 * Find best match from array of targets
 * Standalone function for quick matching without class instantiation
 *
 * @param {string} utterance - User utterance
 * @param {string[]} targets - Array of target phrases
 * @param {object} options - Optional configuration
 * @returns {object} Best match result
 */
export function findBestMatch(utterance, targets, options = {}) {
  const matcher = new IntentMatcher(targets, options);
  return matcher.match(utterance);
}

// ============================================================================
// EXAMPLE USAGE AND TESTING
// ============================================================================

/**
 * Demo function showing how to use the Intent Matcher
 */
export function demo() {
  const targets = ["Open the door", "Play music", "Turn off the lights"];
  const utterance = "Play the muse ik";

  console.log("=== Intent Matcher Demo ===\n");
  console.log(`Targets: ${JSON.stringify(targets)}`);
  console.log(`Utterance: "${utterance}"\n`);

  const matcher = new IntentMatcher(targets, {
    fuzzyWeight: 0.4,
    phoneticWeight: 0.6,
  });

  const result = matcher.match(utterance);
  
  result.allScores.forEach((score, i) => {
    console.log(`  ${i + 1}. "${score.target}" - confidence: ${(score.confidence * 100).toFixed(1)}%`);
  });

  return result;
}

export default IntentMatcher;
