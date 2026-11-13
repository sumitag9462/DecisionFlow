import React from 'react';

export default function Header({
  title,
  description,
  connected,
  currentUser,
  onOpenLogin,
  onLogout
}) {
  return (
    <header className="app-header">
      <div className="header-title-group">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>

      <div className="header-meta">
        <div className="connectivity-badge">
          <span className={`dot ${connected ? 'connected' : 'disconnected'}`} />
          <span>{connected ? 'Backend Online' : 'Backend Offline'}</span>
        </div>

        {currentUser ? (
          <div className="auth-user-pill">
            <span style={{ fontSize: '13px' }}>👤</span>
            <strong>{currentUser.name}</strong>
            <span
              className="badge"
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                backgroundColor: currentUser.role === 'ADMIN' ? '#dbeafe' : currentUser.role === 'REVIEWER' ? '#fef3c7' : '#f1f5f9',
                color: currentUser.role === 'ADMIN' ? '#1e40af' : currentUser.role === 'REVIEWER' ? '#92400e' : '#475569',
                border: '1px solid currentColor'
              }}
            >
              {currentUser.role}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenLogin}
              title="Switch demo account"
              style={{ padding: '3px 8px', fontSize: '11px' }}
            >
              Switch
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLogout}
              title="Sign out of DecisionFlow"
              style={{ padding: '3px 8px', fontSize: '11px' }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Not signed in</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onOpenLogin}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
