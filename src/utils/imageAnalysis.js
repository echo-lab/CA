import { imageDebugLog } from './debugMonitor';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

const analysisCache = new Map();
const taggingCache = new Map();

export async function ImageTagging({ book, page }) {
  const key = `${book}-${page}`;
  if (taggingCache.has(key)) return taggingCache.get(key);
  const promise = (async () => {
    imageDebugLog({ type: 'tagging_request', book, page });
    try {
      const res = await fetch(`${API_BASE}/tag-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, page }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Server error');
      const tags = data.tags || [];
      imageDebugLog({ type: 'tagging_response', book, page, tags });
      return tags;
    } catch (err) {
      console.error('ImageTagging error:', err);
      imageDebugLog({ type: 'tagging_error', book, page, error: err.message });
      taggingCache.delete(key);
      return [];
    }
  })();
  taggingCache.set(key, promise);
  return promise;
}

export async function ImageAnalysis({ book, page, pageText }) {
  const key = `${book}-${page}`;
  if (analysisCache.has(key)) return analysisCache.get(key);
  const promise = (async () => {
    imageDebugLog({ type: 'analysis_request', book, page, pageText });
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
      const description = data.answer || null;
      imageDebugLog({ type: 'analysis_response', book, page, description });
      return description;
    } catch (err) {
      console.error('ImageAnalysis error:', err);
      imageDebugLog({ type: 'analysis_error', book, page, error: err.message });
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
  imageDebugLog({ type: 'book_info', book, totalPages: pages.length });
  pages.forEach((pageData, index) => {
    const page = index + 1;
    const pageText = pageData.text?.map(t => stripSSML(t.Dialogue)).join(' ') || '';
    ImageAnalysis({ book, page, pageText });
    ImageTagging({ book, page });
  });
}
