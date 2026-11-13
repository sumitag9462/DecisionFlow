import React from 'react';

export default function Header({ title, description, connected, currentRole, onRoleChange }) {
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

        <div className="role-badge">
          <label htmlFor="role-select" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Role:
          </label>
          <select
            id="role-select"
            value={currentRole}
            onChange={e => onRoleChange(e.target.value)}
          >
            <option value="ADMIN">Alice Admin (ADMIN)</option>
            <option value="REVIEWER">Bob Reviewer (REVIEWER)</option>
            <option value="VIEWER">Charlie Viewer (VIEWER)</option>
          </select>
        </div>
      </div>
    </header>
  );
}

