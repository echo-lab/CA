const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

export async function ImageAnalysis({ book, page, pageText }) {
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
    return null;
  }
}
