import nlp from 'compromise';
import numberToWords from 'number-to-words';

export function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return [text];
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 0);
  return sentences.length > 0 ? sentences : [text];
}

export function isMultiSentenceLong(text) {
  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const hasMultipleSentences = /[.!?]\s+[A-Z]/.test(text);
  return wordCount >= 8 && hasMultipleSentences;
}

export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text.toLowerCase().trim();

  // Normalize curly/smart quotes to straight equivalents
  result = result.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  let resultOptions = [];

  // Convert numbers to words: "5" → "five", "1st" → "first"
  result = convertNumbersToWords(result);

  let expandedResult = expandContractions(result);
  if (expandedResult !== result) {
    expandedResult = expandedResult.replace(/-/g, ' ');
    expandedResult = expandedResult.replace(/[*.,!?%@#;:'"'""“”()…]/g, "");
    resultOptions.push(expandedResult);
  }

  // Replace hyphens with spaces: "well-known" → "well known"
  result = result.replace(/-/g, ' ');

  // Strip punctuation (contractions already expanded, apostrophes safe to remove)
  result = result.replace(/[*.,!?%@#;:'"'""“”()…]/g, "");

  resultOptions.push(result);

  return resultOptions;
}

function expandContractions(text) {
  const doc = nlp(text);
  doc.contractions().expand();
  return doc.text().replace(/\bcan not\b/g, 'cannot');
}

function convertNumbersToWords(text) {
  // Match decimals (e.g. "32.25"), ordinals (e.g. "1st"), or plain integers (e.g. "5")
  return text.replace(/\b(\d+)\.(\d+)\b|\b(\d+)(st|nd|rd|th)?\b/g, (match, intPart, decPart, wholeNum, suffix) => {
    // Decimal number: convert integer part, then "point", then each digit
    if (intPart !== undefined && decPart !== undefined) {
      const n = parseInt(intPart, 10);
      if (isNaN(n) || n > 9999) return match;
      try {
        const intWords = numberToWords.toWords(n);
        const digitWords = decPart.split('').map(d => numberToWords.toWords(parseInt(d, 10))).join(' ');
        return `${intWords} point ${digitWords}`;
      } catch { return match; }
    }
    // Ordinal or plain integer
    const num = parseInt(wholeNum, 10);
    if (isNaN(num) || num > 9999) return match;
    if (suffix) {
      try { return numberToWords.toWordsOrdinal(num); } catch { return match; }
    }
    try { return numberToWords.toWords(num); } catch { return match; }
  });
}
