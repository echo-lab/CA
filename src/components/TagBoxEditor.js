import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invalidateTagCache } from '../utils/imageAnalysis';

// Drag-to-edit overlay for tag bounding boxes — dev tool. Renders nothing unless
// `visible`, and intercepts nothing until Edit is switched on. To remove: delete this
// file, its two lines in Story.js, invalidateTagCache in imageAnalysis.js, and
// server/routes/tagEdit.js.

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
const MIN_SIZE = 10;   // 0-1000 units; stops a resize from inverting the box
const HANDLE = 12;     // px

// Applies a drag delta (already converted to 0-1000 units) to a box.
// 'move' keeps the size and slides both edges of each axis; 'resize' drags the
// bottom-right corner only. Both stay inside the frame.
export function applyDrag(box, mode, dy, dx) {
  const [y0, x0, y1, x1] = box.map(Number);
  if (mode === 'move') {
    const my = Math.max(-y0, Math.min(1000 - y1, dy));
    const mx = Math.max(-x0, Math.min(1000 - x1, dx));
    return [y0 + my, x0 + mx, y1 + my, x1 + mx].map(Math.round);
  }
  return [
    y0,
    x0,
    Math.min(1000, Math.max(y0 + MIN_SIZE, y1 + dy)),
    Math.min(1000, Math.max(x0 + MIN_SIZE, x1 + dx)),
  ].map(Math.round);
}

export default function TagBoxEditor({ visible, book, page, pageText, tags, onChange }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  const wrapRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => { setEditing(false); setStatus(''); }, [book, page]);

  useEffect(() => {
    if (!editing) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const dy = ((e.clientY - d.startY) / rect.height) * 1000;
      const dx = ((e.clientX - d.startX) / rect.width) * 1000;
      onChange(tags.map((t, i) => (i === d.i ? { ...t, box_2d: applyDrag(d.box, d.mode, dy, dx) } : t)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editing, tags, onChange]);

  const startDrag = useCallback((e, i, mode) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { i, mode, box: tags[i].box_2d, startX: e.clientX, startY: e.clientY };
    setStatus('');
  }, [tags]);

  const save = useCallback(async () => {
    setStatus('saving…');
    try {
      const res = await fetch(`${API_BASE}/save-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, page, pageText, tags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Server error');
      invalidateTagCache(book, page);  // else navigating away and back restores the pre-edit memo
      setStatus(`saved ${data.count}`);
    } catch (err) {
      setStatus(`failed: ${err.message}`);
    }
  }, [book, page, pageText, tags]);

  if (!visible) return null;

  const btn = {
    fontSize: '11px', padding: '2px 6px', border: '1px solid #333',
    background: '#fff', cursor: 'pointer', pointerEvents: 'auto',
  };

  return (
    <div
      ref={wrapRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: editing ? 'auto' : 'none' }}
    >
      {editing && (tags || []).map((tag, i) => {
        if (!Array.isArray(tag?.box_2d) || tag.box_2d.length < 4) return null;
        const [y0, x0, y1, x1] = tag.box_2d;
        return (
          <div
            key={`edit-${i}`}
            onMouseDown={(e) => startDrag(e, i, 'move')}
            title={`${tag.label}\n[${tag.box_2d.join(', ')}]`}
            style={{
              position: 'absolute',
              top: `${y0 / 10}%`, left: `${x0 / 10}%`,
              height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%`,
              outline: '2px solid #0074d9', outlineOffset: '-2px',
              background: 'rgba(0,116,217,0.08)', cursor: 'move', boxSizing: 'border-box',
            }}
          >
            <div
              onMouseDown={(e) => startDrag(e, i, 'resize')}
              style={{
                position: 'absolute', right: 0, bottom: 0,
                width: HANDLE, height: HANDLE, background: '#0074d9', cursor: 'nwse-resize',
              }}
            />
          </div>
        );
      })}

      <div style={{ position: 'absolute', top: 4, left: 4, display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
        <button type="button" style={btn} onClick={() => setEditing(v => !v)}>
          {editing ? 'Done' : 'Edit boxes'}
        </button>
        {editing && <button type="button" style={btn} onClick={save}>Save to cache</button>}
        {status && (
          <span style={{ fontSize: '11px', background: '#fff', padding: '2px 4px' }}>{status}</span>
        )}
      </div>
    </div>
  );
}
