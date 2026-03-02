import nlp from 'compromise';
import numberToWords from 'number-to-words';

export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text.toLowerCase().trim();

  let resultOptions = [];

  // Convert numbers to words: "5" → "five", "1st" → "first"
  result = convertNumbersToWords(result);

  // Strip punctuation (contractions already expanded, apostrophes safe to remove)
  result = result.replace(/[*.,!?;:'"'""()\-—…]/g, "");

  // Replace hyphens with spaces: "well-known" → "well known"
  //result = result.replace(/-/g, ' ');

  resultOptions.push(result);

  // Expand contractions: "don't" → "do not", "I'm" → "I am"
  let expandedResult = expandContractions(result);

  resultOptions.push(expandedResult);

  return resultOptions;
}

function expandContractions(text) {
  const doc = nlp(text);
  doc.contractions().expand();
  return doc.text();
}

function convertNumbersToWords(text) {
  return text.replace(/\b(\d+)(st|nd|rd|th)?\b/g, (match, num, suffix) => {
    const n = parseInt(num, 10);
    if (isNaN(n) || n > 9999) return match;
    if (suffix) {
      try { return numberToWords.toWordsOrdinal(n); } catch { return match; }
    }
    try { return numberToWords.toWords(n); } catch { return match; }
  });
}
