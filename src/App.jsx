import { useState, useEffect } from 'react';

const IDLE = 'idle';
const LOADING = 'loading';
const SUCCESS = 'success';
const ERROR = 'error';
const REVISING = 'revising';

const TYPES = ['Tool', 'Post', 'Video', 'Article', 'Thread', 'Newsletter', 'Book', 'Song', 'Film'];
const RELEVANCES = ['⭐ High', '👀 Medium', '🗃️ Low'];
const TOPICS = [
  '🤖 AI & Tech', '🛠️ Product Building', '💼 Business', '💡 Ideas & Inspiration',
  '📈 Career & Jobs', '📚 Books & Learning', '🏋️ Health & Fitness', '🎨 Design & Creativity',
  '🎮 Entertainment', '🎵 Music', '🎬 Films', '💰 Finance', '🌍 Travel', '🎯 Personal', '🔀 Other',
];

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('radar_token') || '');
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!token) { setAuthChecked(true); return; }
    fetch('/api/auth-check', { headers: { 'x-app-token': token } })
      .then((r) => {
        if (r.ok) setAuthed(true);
        else { localStorage.removeItem('radar_token'); setToken(''); }
      })
      .catch(() => setAuthed(true))
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
  const [view, setView] = useState('save');

  if (view === 'library') {
    return <LibraryView token={token} onLogout={onLogout} onBack={() => setView('save')} />;
  }
  return <SaveView token={token} onLogout={onLogout} onOpenLibrary={() => setView('library')} />;
}

function SaveView({ token, onLogout, onOpenLibrary }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState(IDLE);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [feedback, setFeedback] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setState(LOADING);
    setResult(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/analyze-and-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-token': token },
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

  async function handleRevise(e) {
    e.preventDefault();
    if (!feedback.trim() || !result?.pageId) return;
    setState(REVISING);
    setErrorMsg('');
    try {
      const res = await fetch('/api/update-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ pageId: result.pageId, currentAnalysis: result, feedback: feedback.trim(), url }),
      });
      if (res.status === 401) { onLogout(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
      setFeedback('');
      setState(SUCCESS);
    } catch (err) {
      setErrorMsg(err.message);
      setState(SUCCESS);
    }
  }

  function handleReset() {
    setUrl('');
    setNote('');
    setState(IDLE);
    setResult(null);
    setErrorMsg('');
    setFeedback('');
  }

  return (
    <div className="page">
      <div className="card">
        <div className="header">
          <span className="logo">📡</span>
          <div style={{ flex: 1 }}>
            <h1>Radar Saver</h1>
            <p className="subtitle">Save anything to Notion — instantly.</p>
          </div>
          <button className="lib-nav-btn" onClick={onOpenLibrary}>Library →</button>
        </div>

        {state !== SUCCESS && state !== REVISING && (
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
              {state === LOADING ? <><span className="spinner" />Analyzing & saving…</> : 'Save to Notion'}
            </button>
          </form>
        )}

        {(state === SUCCESS || state === REVISING) && result && (
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
                {result.topic.map((t) => <span key={t} className="topic-chip">{t}</span>)}
              </div>
            </div>
            <form onSubmit={handleRevise} className="form" style={{ marginTop: '1rem' }}>
              <div className="field">
                <label htmlFor="feedback">Request a change <span className="optional">(optional)</span></label>
                <input
                  id="feedback"
                  type="text"
                  placeholder="e.g. summary missed the point, type should be Article…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={state === REVISING}
                  autoFocus
                />
              </div>
              {errorMsg && (
                <div className="error-banner">
                  <span>⚠️</span>
                  <span>{errorMsg}</span>
                </div>
              )}
              <div className="button-row">
                <button
                  type="submit"
                  className={`save-btn ${state === REVISING ? 'loading' : ''}`}
                  disabled={state === REVISING || !feedback.trim()}
                >
                  {state === REVISING ? <><span className="spinner" />Revising…</> : 'Revise'}
                </button>
                <button type="button" className="reset-btn" onClick={handleReset}>Save another</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryView({ token, onLogout, onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterRelevance, setFilterRelevance] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [viewMode, setViewMode] = useState('list');

  useEffect(() => {
    document.body.classList.add('library-mode');
    return () => document.body.classList.remove('library-mode');
  }, []);

  useEffect(() => {
    loadEntries(true);
  }, [filterType, filterRelevance, filterTopic, sort]);

  async function loadEntries(reset = false) {
    if (reset) { setLoading(true); setEntries([]); setNextCursor(null); }
    else setLoadingMore(true);
    setErrorMsg('');

    const params = new URLSearchParams({ sort });
    if (filterType) params.set('type', filterType);
    if (filterRelevance) params.set('relevance', filterRelevance);
    if (filterTopic) params.set('topic', filterTopic);
    if (!reset && nextCursor) params.set('cursor', nextCursor);

    try {
      const res = await fetch(`/api/entries?${params}`, { headers: { 'x-app-token': token } });
      if (res.status === 401) { onLogout(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEntries((prev) => reset ? data.entries : [...prev, ...data.entries]);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function toggleFilter(setter, current, value) {
    setter(current === value ? '' : value);
  }

  function clearFilters() {
    setFilterType('');
    setFilterRelevance('');
    setFilterTopic('');
  }

  const hasFilters = filterType || filterRelevance || filterTopic;

  return (
    <div className="lib-page">
      {/* Header */}
      <div className="lib-header">
        <button className="lib-back-btn" onClick={onBack}>← Back</button>
        <span className="lib-title">Library</span>
        <div className="lib-view-toggle">
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="List view">☰</button>
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid view">⊞</button>
        </div>
      </div>

      {/* Filters */}
      <div className="lib-toolbar">
        <div className="filter-row">
          <span className="filter-label">Type</span>
          <div className="filter-pills">
            <button className={`filter-pill ${!filterType ? 'active' : ''}`} onClick={() => setFilterType('')}>All</button>
            {TYPES.map((t) => (
              <button key={t} className={`filter-pill ${filterType === t ? 'active' : ''}`} onClick={() => toggleFilter(setFilterType, filterType, t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">Relevance</span>
          <div className="filter-pills">
            <button className={`filter-pill ${!filterRelevance ? 'active' : ''}`} onClick={() => setFilterRelevance('')}>All</button>
            {RELEVANCES.map((r) => (
              <button key={r} className={`filter-pill ${filterRelevance === r ? 'active' : ''}`} onClick={() => toggleFilter(setFilterRelevance, filterRelevance, r)}>{r}</button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">Topic</span>
          <div className="filter-pills">
            <button className={`filter-pill ${!filterTopic ? 'active' : ''}`} onClick={() => setFilterTopic('')}>All</button>
            {TOPICS.map((t) => (
              <button key={t} className={`filter-pill ${filterTopic === t ? 'active' : ''}`} onClick={() => toggleFilter(setFilterTopic, filterTopic, t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="lib-sort-row">
          {hasFilters && (
            <button className="clear-filters" onClick={clearFilters}>Clear filters</button>
          )}
          <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="title_asc">A – Z</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {errorMsg && (
        <div className="error-banner" style={{ marginBottom: '16px' }}>
          <span>⚠️</span><span>{errorMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="lib-loading"><span className="spinner-dark" />Loading…</div>
      ) : entries.length === 0 ? (
        <div className="lib-empty">
          {hasFilters ? 'No entries match these filters.' : 'Nothing saved yet — add your first link!'}
        </div>
      ) : (
        <>
          <div className={viewMode === 'grid' ? 'lib-grid' : 'lib-list'}>
            {entries.map((entry) => <EntryCard key={entry.id} entry={entry} viewMode={viewMode} />)}
          </div>
          {hasMore && (
            <button className="load-more-btn" onClick={() => loadEntries(false)} disabled={loadingMore}>
              {loadingMore ? <><span className="spinner-dark" />Loading…</> : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function EntryCard({ entry, viewMode }) {
  const date = new Date(entry.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className={`entry-card ${viewMode}`}>
      <div className="entry-card-top">
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="entry-title">
          {entry.title}
        </a>
        <span className="entry-date">{date}</span>
      </div>
      {entry.summary && <p className="entry-summary">{entry.summary}</p>}
      <div className="entry-meta">
        {entry.type && <MetaBadge icon="📂" value={entry.type} />}
        {entry.source && <MetaBadge icon="🔗" value={entry.source} />}
        {entry.author && <MetaBadge icon="✍️" value={entry.author} />}
        {entry.relevance && <MetaBadge icon={relevanceIcon(entry.relevance)} value={entry.relevance} />}
      </div>
      {entry.topic?.length > 0 && (
        <div className="topics">
          {entry.topic.map((t) => <span key={t} className="topic-chip">{t}</span>)}
        </div>
      )}
    </div>
  );
}

function MetaBadge({ icon, value }) {
  return <span className="meta-badge">{icon} {value}</span>;
}

function relevanceIcon(relevance) {
  if (relevance?.includes('High')) return '⭐';
  if (relevance?.includes('Medium')) return '👀';
  return '🗃️';
}
