const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

const analysisCache = new Map();
const taggingCache = new Map();

export async function ImageTagging({ book, page }) {
  console.log(`Fetching image tags for Book ${book}, Page ${page}...`);
  const key = `${book}-${page}`;
  if (taggingCache.has(key)) return taggingCache.get(key);
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/tag-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, page }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Server error');
      const tags = data.tags || [];
      return tags;
    } catch (err) {
      console.error('ImageTagging error:', err);
      taggingCache.delete(key);
      return [];
    }
  })();
  taggingCache.set(key, promise);
  return promise;
}

export async function ImageAnalysis({ book, page, pageText }) {
  console.log(`Fetching image analysis for Book ${book}, Page ${page}...`);
  const key = `${book}-${page}`;
  if (analysisCache.has(key)) return analysisCache.get(key);
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/analyze-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book,
          page,
          question: 'Describe what is happening in this image, focusing on the characters\' actions, emotions, and any visual details relevant to the story.',
          pageText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Server error');
      return data.answer || null;
    } catch (err) {
      console.error('ImageAnalysis error:', err);
      analysisCache.delete(key);
      return null;
    }
    })();
  analysisCache.set(key, promise);
  return promise;
}

function stripSSML(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, '');
}

export function prefetchImageAnalysis(book, pages) {
  console.log(`Prefetching image analysis for Book ${book}...`);
  pages.forEach((pageData, index) => {
    const page = index + 1;
    const pageText = pageData.text?.map(t => stripSSML(t.Dialogue)).join(' ') || '';
    ImageAnalysis({ book, page, pageText });
    ImageTagging({ book, page });
  });
}
