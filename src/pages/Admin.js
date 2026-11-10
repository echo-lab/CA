import React, { useCallback, useEffect, useState } from 'react';

// Study admin (roster + recent sessions), gated by ADMIN_TOKEN kept in sessionStorage so it's gone when the tab closes.
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
const TOKEN_KEY = 'jennie.adminToken';

const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = (t) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } };
const dropToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

const WHEN = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

export default function Admin() {
  const [token, setToken] = useState(readToken);
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [roster, setRoster] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newRow, setNewRow] = useState({ user_id: '', parent: '', child: '', 'parent-figure': '' });

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
      const [p, s] = await Promise.all([api('/api/admin/participants'), api('/api/admin/sessions')]);
      setRoster(p.participants || []);
      setSessions(s.sessions || []);
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

  const signOut = () => { dropToken(); setToken(''); setAuthed(false); setRoster([]); setSessions([]); };

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
    if (!window.confirm(`Remove "${id}" from the roster?\n\nTheir logged data stays in the database.`)) return;
    setError('');
    try {
      const data = await api(`/api/admin/participants/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setRoster(data.participants || []);
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

  const columns = [...new Set(roster.flatMap((r) => Object.keys(r || {})))].filter((c) => c !== 'created_at');

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

      <h3 style={{ marginTop: 36 }}>Recent sessions ({sessions.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Participant</th><th style={th}>Session</th><th style={th}>Book</th>
          <th style={th}>Training</th><th style={th}>Started</th><th style={th}>Ended</th><th style={th}>Pages</th>
        </tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={`${s.user_id}/${s.session_id}`}>
              <td style={td}>{s.user_id}</td>
              <td style={td}>{s.session_id}</td>
              <td style={td}>{s.book_name || '—'}</td>
              <td style={td}>{String(s.is_training ?? '')}</td>
              <td style={td}>{WHEN(s.started_at)}</td>
              <td style={td}>{WHEN(s.ended_at)}</td>
              <td style={td}>{s.pages_reached ?? '—'}</td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td style={td} colSpan={7}>No sessions yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
