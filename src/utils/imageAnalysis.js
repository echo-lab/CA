const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

// Flip to false to disable image tagging + analysis (and their prefetch).
const IMAGE_PIPELINE_ENABLED = true;

const analysisCache = new Map();
const taggingCache = new Map();

export async function ImageTagging({ book, page, pageText }) {
  if (!IMAGE_PIPELINE_ENABLED) return [];
  console.log(`Fetching image tags for Book ${book}, Page ${page}...`);
  const key = `${book}-${page}`;
  if (taggingCache.has(key)) return taggingCache.get(key);
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/tag-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, page, pageText }),
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
  if (!IMAGE_PIPELINE_ENABLED) return null;
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
          question: `Describe what is happening in the image. Focus on:
- What the characters are doing
- Their emotions and interactions
- Important objects and background details
- What is happening in the scene
Use clear and simple language. Avoid guessing.`,
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

// Throttled prefetch queue — at most 2 concurrent page fetches (4 requests: analyze + tag per page)
const PREFETCH_CONCURRENCY = 2;
let activeCount = 0;
const prefetchQueue = [];

function drainQueue() {
  while (activeCount < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
    const { book, page, pageText } = prefetchQueue.shift();
    activeCount++;
    Promise.all([
      ImageAnalysis({ book, page, pageText }),
      ImageTagging({ book, page, pageText }),
    ]).finally(() => {
      activeCount--;
      drainQueue();
    });
  }
}

function enqueuePage(book, page, pageText) {
  const alreadyQueued = prefetchQueue.some(e => e.book === book && e.page === page);
  if (alreadyQueued) return;
  prefetchQueue.push({ book, page, pageText });
  drainQueue();
}

// Called from CharacterSelecter — prefetches first 3 pages
export function prefetchImageAnalysis(book, pages) {
  if (!IMAGE_PIPELINE_ENABLED) return;
  console.log(`Prefetching image analysis for Book ${book}...`);
  pages.slice(1, 4).forEach((pageData, sliceIndex) => {
    const page = sliceIndex + 1; // slice starts at pages[1], so page 1, 2, 3
    const pageText = pageData.text?.map(t => stripSSML(t.Dialogue)).join(' ') || '';
    enqueuePage(book, page, pageText);
  });
}

// Called from Story on page advance — prefetches 3 pages ahead of current
export function prefetchPage(book, pages, currentPage) {
  if (!IMAGE_PIPELINE_ENABLED) return;
  const targetIndex = currentPage + 3; // 3 pages ahead
  if (targetIndex >= pages.length) return;
  const pageData = pages[targetIndex];
  const pageText = pageData?.text?.map(t => stripSSML(t.Dialogue)).join(' ') || '';
  enqueuePage(book, targetIndex, pageText);
}
