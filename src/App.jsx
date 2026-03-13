import { useState, useEffect } from 'react';

const IDLE = 'idle';
const LOADING = 'loading';
const SUCCESS = 'success';
const ERROR = 'error';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('radar_token') || '');
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Verify stored token on load
  useEffect(() => {
    if (!token) { setAuthChecked(true); return; }
    fetch('/api/analyze-and-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': token },
      body: JSON.stringify({ url: 'ping' }),
    }).then((r) => {
      // 400 = wrong body but auth passed; 401 = bad token
      if (r.status !== 401) setAuthed(true);
      else { localStorage.removeItem('radar_token'); setToken(''); }
    }).catch(() => setAuthed(true)) // network error — assume ok
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) return null;
  if (!authed) return <LoginScreen onLogin={(t) => { setToken(t); setAuthed(true); }} />;
  return <MainApp token={token} onLogout={() => { localStorage.removeItem('radar_token'); setToken(''); setAuthed(false); }} />;
}

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Wrong password');
      localStorage.setItem('radar_token', data.token);
      onLogin(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="header">
          <span className="logo">📡</span>
          <div>
            <h1>Radar Saver</h1>
            <p className="subtitle">Enter your password to continue.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="form">
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              disabled={loading}
            />
          </div>
          {error && (
            <div className="error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <button type="submit" className={`save-btn ${loading ? 'loading' : ''}`} disabled={loading || !password}>
            {loading ? <><span className="spinner" />Checking…</> : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}

function MainApp({ token, onLogout }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState(IDLE);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    if (!url.trim()) return;

    setState(LOADING);
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/analyze-and-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': token,
        },
        body: JSON.stringify({ url: url.trim(), note: note.trim() }),
      });

      if (res.status === 401) { onLogout(); return; }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      setResult(data);
      setState(SUCCESS);
    } catch (err) {
      setErrorMsg(err.message);
      setState(ERROR);
    }
  }

  function handleReset() {
    setUrl('');
    setNote('');
    setState(IDLE);
    setResult(null);
    setErrorMsg('');
  }

  return (
    <div className="page">
      <div className="card">
        <div className="header">
          <span className="logo">📡</span>
          <div>
            <h1>Radar Saver</h1>
            <p className="subtitle">Save anything to Notion — instantly.</p>
          </div>
        </div>

        {state !== SUCCESS && (
          <form onSubmit={handleSave} className="form">
            <div className="field">
              <label htmlFor="url">URL</label>
              <input
                id="url"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                disabled={state === LOADING}
                autoFocus
              />
            </div>

            <div className="field">
              <label htmlFor="note">Note <span className="optional">(optional)</span></label>
              <input
                id="note"
                type="text"
                placeholder="e.g. want to watch later, for Voyager project…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={state === LOADING}
              />
            </div>

            {state === ERROR && (
              <div className="error-banner">
                <span>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              className={`save-btn ${state === LOADING ? 'loading' : ''}`}
              disabled={state === LOADING || !url.trim()}
            >
              {state === LOADING ? (
                <><span className="spinner" />Analyzing & saving…</>
              ) : (
                'Save to Notion'
              )}
            </button>
          </form>
        )}

        {state === SUCCESS && result && (
          <div className="success">
            <div className="success-icon">✓</div>
            <p className="saved-label">Saved to Notion</p>

            <div className="result-card">
              <h2 className="result-title">{result.title}</h2>
              <p className="result-summary">{result.summary}</p>

              <div className="meta-row">
                <MetaBadge icon="📂" value={result.type} />
                <MetaBadge icon="🔗" value={result.source} />
                {result.author && <MetaBadge icon="✍️" value={result.author} />}
                <MetaBadge icon={relevanceIcon(result.relevance)} value={result.relevance} />
              </div>

              <div className="topics">
                {result.topic.map((t) => (
                  <span key={t} className="topic-chip">{t}</span>
                ))}
              </div>
            </div>

            <button className="reset-btn" onClick={handleReset}>
              Save another
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaBadge({ icon, value }) {
  return (
    <span className="meta-badge">
      {icon} {value}
    </span>
  );
}

function relevanceIcon(relevance) {
  if (relevance?.includes('High')) return '⭐';
  if (relevance?.includes('Medium')) return '👀';
  return '🗃️';
}
