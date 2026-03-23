import React, { useState, useCallback } from 'react';
import { data as book1Data } from '../Book/Book1';
import { data as book2Data } from '../Book/Book2';
import { data as book3Data } from '../Book/Book3';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

const PAGE_KEYS = ['Cover','PageOne','PageTwo','PageThree','PageFour','PageFive','PageSix','PageSeven','PageEight','PageNine','PageTen','PageEleven','PageTwelve','PageThirteen','PageFourteen','PageFifteen'];

const BOOK_DATA = {
  1: book1Data[0].Book.Pages,
  2: book2Data[0].Book.Pages,
  3: book3Data[0].Book.Pages,
};

function stripSsml(text) {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function getPageText(book, page) {
  const pages = BOOK_DATA[book];
  if (!pages) return '';
  const key = PAGE_KEYS[page]; // page 1 → PageOne (index 1)
  const pageData = pages[key];
  if (!pageData) return '';
  return pageData.text
    .map(t => `${t.Character}: ${stripSsml(t.Dialogue)}`)
    .join('\n');
}

// Build catalog of all 45 book pages
const IMAGES = [];
for (let p = 1; p <= 15; p++) {
  IMAGES.push({ book: 1, page: p, url: `${API_BASE}/pictures/book1/Page_${p}.jpg`, label: `Book 1 — Page ${p}` });
}
for (let p = 1; p <= 15; p++) {
  IMAGES.push({ book: 2, page: p, url: `${API_BASE}/pictures/book2/Page_${p}.jpg`, label: `Book 2 — Page ${p}` });
}
for (let p = 1; p <= 15; p++) {
  IMAGES.push({ book: 3, page: p, url: `${API_BASE}/pictures/book3/${p} Library.jpg`, label: `Book 3 — Page ${p}` });
}

export default function ImageAnalysis() {
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const current = IMAGES[index];

  const prev = useCallback(() => {
    setIndex(i => (i - 1 + IMAGES.length) % IMAGES.length);
    setAnswer('');
    setError('');
  }, []);

  const next = useCallback(() => {
    setIndex(i => (i + 1) % IMAGES.length);
    setAnswer('');
    setError('');
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  }, [prev, next]);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer('');
    setError('');
    try {
      const res = await fetch(`${API_BASE}/analyze-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book: current.book, page: current.page, question: question.trim(), pageText: getPageText(current.book, current.page) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Server error');
      setAnswer(data.answer);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px', fontFamily: 'sans-serif', outline: 'none' }}
    >
      <p style={{ margin: '0 0 16px', color: '#888', fontSize: '0.85rem' }}>
        Image Analysis — {current.label} ({index + 1}/{IMAGES.length})
        &nbsp;
        {[1,2,3].map(b => (
          <button key={b} onClick={() => { setIndex((b-1)*15); setAnswer(''); setError(''); }}
            style={{ marginLeft: 6, padding: '1px 10px', borderRadius: 4, border: '1px solid #ccc', background: current.book === b ? '#333' : '#fff', color: current.book === b ? '#fff' : '#333', cursor: 'pointer', fontSize: '0.8rem' }}>
            Book {b}
          </button>
        ))}
      </p>

      {/* Image + nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={prev} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: '1rem' }}>←</button>
        <img key={current.url} src={current.url} alt={current.label}
          style={{ flex: 1, maxHeight: '60vh', objectFit: 'contain', borderRadius: 8, background: '#f0f0f0', minWidth: 0 }} />
        <button onClick={next} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: '1rem' }}>→</button>
      </div>

      {/* Q&A */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleQuestionKey}
          placeholder="Ask Gemini about this image…"
          style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc', fontSize: '0.95rem', outline: 'none' }}
        />
        <button onClick={ask} disabled={loading || !question.trim()}
          style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: loading || !question.trim() ? 'default' : 'pointer', fontSize: '0.95rem', color: '#333', opacity: loading || !question.trim() ? 0.5 : 1 }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {error && <p style={{ marginTop: 10, color: 'red', fontSize: '0.9rem' }}>{error}</p>}
      {answer && <p style={{ marginTop: 12, fontSize: '0.95rem', lineHeight: 1.6, color: '#222' }}>{answer}</p>}
    </div>
  );
}
