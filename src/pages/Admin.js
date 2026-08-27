import React, { useCallback, useEffect, useState } from 'react';

// Study admin: roster management and log browsing. Gated by the shared
// ADMIN_TOKEN the server holds; the token lives in sessionStorage so it is gone
// when the tab closes rather than sitting in localStorage on a shared machine.
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
const TOKEN_KEY = 'jennie.adminToken';

const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = (t) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } };
const dropToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

const KB = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// Log files are written as session_<id>_<stream>.csv, plus a per-participant
// sessions.csv. Anything else (a stray README, older flat session_<id>.csv) lands
// in "other" so it is still reachable through the filter rather than invisible.
const NO_PARTICIPANT = '(top level)';
const streamOf = (name) => {
  const m = String(name).match(/_(events|questions|transcript)\.csv$/i);
  if (m) return m[1].toLowerCase();
  if (/(^|[/\\])sessions\.csv$/i.test(name)) return 'sessions';
  return 'other';
};
const WHEN = (ms) => new Date(ms).toLocaleString();

// Toggleable chips. Multi-select on purpose: picking questions and transcript
// shows both, rather than the last one clicked.
function FilterRow({ label, options, picked, onToggle }) {
  if (options.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#666', width: 82 }}>{label}</span>
      {options.map((opt) => {
        const on = picked.includes(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            aria-pressed={on}
            style={{
              fontSize: 12, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
              border: `1px solid ${on ? '#0d6efd' : '#ccc'}`,
              background: on ? '#0d6efd' : '#fff',
              color: on ? '#fff' : '#333',
            }}
          >{opt}</button>
        );
      })}
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(readToken);
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [roster, setRoster] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newRow, setNewRow] = useState({ user_id: '', parent: '', child: '', 'parent-figure': '' });
  // Within a category the picks are OR'd, across categories AND'd — so
  // [T001] + [questions, transcript] means T001's questions and transcripts.
  const [pickedIds, setPickedIds] = useState([]);
  const [pickedTypes, setPickedTypes] = useState([]);

  const api = useCallback(async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token, ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }, [token]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [p, l] = await Promise.all([api('/api/admin/participants'), api('/api/admin/logs')]);
      setRoster(p.participants || []);
      setFiles(l.files || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [api]);

  // Verify a stored token before showing the page, so a rotated token surfaces
  // as a login prompt rather than an empty table.
  useEffect(() => {
    if (!token) { setAuthed(false); return; }
    let cancelled = false;
    api('/api/admin/session')
      .then(() => { if (!cancelled) { setAuthed(true); refresh(); } })
      .catch((err) => { if (!cancelled) { setAuthed(false); dropToken(); setError(err.message); } });
    return () => { cancelled = true; };
  }, [token, api, refresh]);

  const signIn = (e) => {
    e.preventDefault();
    setError('');
    saveToken(tokenInput.trim());
    setToken(tokenInput.trim());
    setTokenInput('');
  };

  const signOut = () => { dropToken(); setToken(''); setAuthed(false); setRoster([]); setFiles([]); };

  const addParticipant = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = Object.fromEntries(Object.entries(newRow).filter(([, v]) => String(v).trim()));
      const data = await api('/api/admin/participants', { method: 'POST', body: JSON.stringify(body) });
      setRoster(data.participants || []);
      setNewRow({ user_id: '', parent: '', child: '', 'parent-figure': '' });
      refresh();
    } catch (err) { setError(err.message); }
  };

  const removeParticipant = async (id) => {
    // Irreversible for the roster row, so make them say the id out loud.
    if (!window.confirm(`Remove "${id}" from the roster?\n\nTheir log files stay on disk and can still be downloaded.`)) return;
    setError('');
    try {
      const data = await api(`/api/admin/participants/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setRoster(data.participants || []);
    } catch (err) { setError(err.message); }
  };

  // A plain <a href> cannot carry the token header, so fetch the bytes and hand
  // the browser a blob instead.
  const download = async (path, filename) => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: { 'x-admin-token': token } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };

  const box = { maxWidth: 1000, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' };
  const th = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '6px 8px', fontSize: 13 };
  const td = { borderBottom: '1px solid #eee', padding: '6px 8px', fontSize: 13 };
  const input = { padding: '6px 8px', marginRight: 6, border: '1px solid #ccc', borderRadius: 4 };

  if (!authed) {
    return (
      <div style={{ ...box, maxWidth: 420 }}>
        <h2>Study admin</h2>
        <form onSubmit={signIn}>
          <input
            type="password" style={{ ...input, width: '100%', marginBottom: 10 }}
            placeholder="Admin token" value={tokenInput} autoFocus
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Sign in</button>
        </form>
        {error && <p style={{ color: '#b00', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const columns = [...new Set(roster.flatMap((r) => Object.keys(r || {})))];

  // Options come from the files actually present, so a filter can never offer a
  // choice that matches nothing.
  const idOptions = [...new Set(files.map((f) => f.participant || NO_PARTICIPANT))].sort();
  const typeOptions = [...new Set(files.map((f) => streamOf(f.file)))].sort();
  const toggle = (setter) => (value) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  // An empty category means "no constraint", not "match nothing".
  const visibleFiles = files.filter((f) =>
    (pickedIds.length === 0 || pickedIds.includes(f.participant || NO_PARTICIPANT)) &&
    (pickedTypes.length === 0 || pickedTypes.includes(streamOf(f.file))));

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Study admin</h2>
        <div>
          <button className="btn btn-outline-secondary" onClick={refresh} disabled={busy} style={{ marginRight: 8 }}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
          <button className="btn btn-outline-secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>
      {error && <p style={{ color: '#b00' }}>{error}</p>}

      <h3 style={{ marginTop: 28 }}>Participants ({roster.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{columns.map((c) => <th key={c} style={th}>{c}</th>)}<th style={th} /></tr></thead>
        <tbody>
          {roster.map((r) => (
            <tr key={r.user_id}>
              {columns.map((c) => <td key={c} style={td}>{String(r?.[c] ?? '')}</td>)}
              <td style={{ ...td, textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline-danger" onClick={() => removeParticipant(r.user_id)}>Remove</button>
              </td>
            </tr>
          ))}
          {roster.length === 0 && <tr><td style={td} colSpan={columns.length + 1}>Roster is empty.</td></tr>}
        </tbody>
      </table>

      <form onSubmit={addParticipant} style={{ marginTop: 16 }}>
        {['user_id', 'parent', 'child', 'parent-figure'].map((f) => (
          <input
            key={f} style={input} placeholder={f} value={newRow[f]}
            onChange={(e) => setNewRow({ ...newRow, [f]: e.target.value })}
            required={f === 'user_id'}
          />
        ))}
        <button className="btn btn-primary" type="submit">Add</button>
      </form>

      <h3 style={{ marginTop: 36 }}>Combined exports</h3>
      {['events', 'transcript', 'questions'].map((s) => (
        <button key={s} className="btn btn-outline-secondary" style={{ marginRight: 8 }}
          onClick={() => download(`/api/study-log/download/${s}`, `${s}-logs.csv`)}>{s}.csv</button>
      ))}
      <button className="btn btn-outline-secondary"
        onClick={() => download('/api/study-log/download-sessions', 'sessions.csv')}>sessions.csv</button>

      <h3 style={{ marginTop: 36 }}>
        Log files ({visibleFiles.length}{visibleFiles.length !== files.length ? ` of ${files.length}` : ''})
      </h3>

      <div style={{ marginBottom: 12 }}>
        <FilterRow label="Participant" options={idOptions} picked={pickedIds} onToggle={toggle(setPickedIds)} />
        <FilterRow label="Type" options={typeOptions} picked={pickedTypes} onToggle={toggle(setPickedTypes)} />
        {(pickedIds.length > 0 || pickedTypes.length > 0) && (
          <button className="btn btn-sm btn-link" style={{ padding: 0 }}
            onClick={() => { setPickedIds([]); setPickedTypes([]); }}>
            Clear filters
          </button>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Participant</th><th style={th}>File</th><th style={th}>Size</th><th style={th}>Modified</th><th style={th} /></tr></thead>
        <tbody>
          {visibleFiles.map((f) => (
            <tr key={f.file}>
              <td style={td}>{f.participant || '—'}</td>
              <td style={td}>{f.file}</td>
              <td style={td}>{KB(f.bytes)}</td>
              <td style={td}>{WHEN(f.modified)}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline-secondary"
                  onClick={() => download(`/api/admin/logs/download?file=${encodeURIComponent(f.file)}`, f.file.replace(/[/\\]/g, '_'))}>
                  Download
                </button>
              </td>
            </tr>
          ))}
          {visibleFiles.length === 0 && (
            <tr><td style={td} colSpan={5}>
              {files.length === 0 ? 'No log files yet.' : 'No files match these filters.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
