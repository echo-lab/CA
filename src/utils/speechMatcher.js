import Fuse from 'fuse.js';
import doubleMetaphone from 'talisman/phonetics/double-metaphone';
import levenshtein from 'talisman/metrics/levenshtein';
import { TokenizerEn } from '@nlpjs/lang-en';

// Common speech disfluencies and filler words
const FILLER_WORDS = new Set([
  // Hesitation sounds (with variations)
  'uh', 'uhh', 'uhhh', 'uhhhh',
  'huh', 'huhh', 'huhhh',
  'um', 'umm', 'ummm', 'ummmm',
  'ah', 'ahh', 'ahhh', 'ahhhh',
  'er', 'err', 'errr',
  'eh', 'ehh', 'ehhh',
  'hm', 'hmm', 'hmmm', 'hmmmm',
  'mhm', 'mhmm',
  'erm', 'ermm', 'ermmm',
  // Common filler phrases
  'like',
  'basically',
  'actually',
  'literally',
  'honestly',
  'obviously',
  'well',
  'anyway',
  'anyways',
  // You can add more as needed
]);

// Initialize NLP.js English tokenizer
const tokenizer = new TokenizerEn();

export function cleanFillerWords(text) {
  if (!text || typeof text !== 'string') {
    return { cleaned: '', removed: [], original: text || '' };
  }

  const original = text;

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

const DEFAULT_CONFIG = {
  exactWordWeight: 0.3,
  fuzzyWeight: 0.3,
  phoneticWeight: 0.4,

  // Fuse.js options
  fuseOptions: {
    includeScore: true,
    threshold: 0.6,        // 0.0 = perfect match required, 1.0 = match anything
    ignoreLocation: true,  // Search entire string, not just beginning
    minMatchCharLength: 2,
  },

  // Score threshold for considering a match valid (confidence >= this = match)
  matchThreshold: 0.6,
};

function calculatePhoneticDistance(str1, str2) {
  if (!str1 || !str2) return 1;

  const s1 = str1;
  const s2 = str2;

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


// Checks if expectedWords appear in order (with gaps allowed) in spokenWords.
export function findSubsequenceMatch(expectedText, spokenWords) {
  const options = Array.isArray(expectedText) ? expectedText : [expectedText];
  for (const option of options) {
    const expectedWords = option.split(/\s+/).filter(w => w.length > 0);
    if (expectedWords.length === 0) continue;
    let queueIdx = 0;
    let firstMatchIdx = -1;
    let lastMatchIdx = -1;

    let matched = true;
    for (const word of expectedWords) {
      while (queueIdx < spokenWords.length && spokenWords[queueIdx] !== word) {
        queueIdx++;
      }
      if (queueIdx >= spokenWords.length) { matched = false; break; }
      if (firstMatchIdx === -1) firstMatchIdx = queueIdx;
      lastMatchIdx = queueIdx;
      queueIdx++;
    }

    if (matched) return { startIdx: firstMatchIdx, endIdx: lastMatchIdx + 1 };
  }
  return null;
}

// Calculates a hybrid score between an utterance and a target phrase, combining fuzzy text similarity and phonetic similarity.
export function calculateHybridScore(utterance, target, options = {}) {
  // If target is an array (from normalizeText), score against each option and return the best
  if (Array.isArray(target)) {
    let bestResult = null;
    for (const option of target) {
      const result = calculateHybridScore(utterance, option, options);
      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
      if (bestResult.confidence === 1) break;
    }
    return bestResult;
  }

  const config = { ...DEFAULT_CONFIG, ...options };

  // Clean filler words from both utterance and target
  const cleanedUtterance = cleanFillerWords(utterance);
  const cleanedTarget = cleanFillerWords(target);

  const normalizedUtterance = cleanedUtterance.cleaned;
  const normalizedTarget = cleanedTarget.cleaned;

  // Fuzzy score using Fuse.js (0 = perfect, 1 = no match)
  const fuse = new Fuse([{ phrase: normalizedTarget }], {...config.fuseOptions, keys: ['phrase'],});
  const fuseResult = fuse.search(normalizedUtterance);
  const fuzzyScore = fuseResult.length > 0 ? fuseResult[0].score : 1;

  // Phonetic score (0 = perfect, 1 = no match)
  const phoneticScore = calculatePhoneticDistance(normalizedUtterance, normalizedTarget);

  // Combined score (weighted average, 0 = perfect, 1 = no match)
  const combinedScore =
    (config.fuzzyWeight * fuzzyScore) +
    (config.phoneticWeight * phoneticScore);

  // Confidence is inverse of combined score (0 = no match, 1 = perfect)
  const confidence = 1 - combinedScore;

  return {
    fuzzyScore,
    phoneticScore,
    combinedScore,
    confidence,
    matched: confidence >= config.matchThreshold,
    cleanedUtterance: normalizedUtterance,
    cleanedTarget: normalizedTarget,
  };
}