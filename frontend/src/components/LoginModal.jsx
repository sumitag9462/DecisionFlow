import React, { useState } from 'react';
import { api } from '../services/api';

const DEMO_PRESETS = [
  { label: 'Alice Admin (ADMIN)', email: 'admin@decisionflow.io', password: 'Admin@123', role: 'ADMIN' },
  { label: 'Bob Reviewer (REVIEWER)', email: 'reviewer@decisionflow.io', password: 'Reviewer@123', role: 'REVIEWER' },
  { label: 'Charlie Viewer (VIEWER)', email: 'viewer@decisionflow.io', password: 'Viewer@123', role: 'VIEWER' }
];

export default function LoginModal({ isOpen, onClose, onLoginSuccess, canClose = true }) {
  const [email, setEmail] = useState('admin@decisionflow.io');
  const [password, setPassword] = useState('Admin@123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  function handleSelectPreset(preset) {
    setEmail(preset.email);
    setPassword(preset.password);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.login(email.trim(), password);
      if (res?.user && res?.token) {
        onLoginSuccess(res.user);
        if (onClose) onClose();
      } else {
        setError('Login failed: invalid response from server.');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="modal-content">
        <div className="modal-header">
          <h3 id="login-title">Sign In to DecisionFlow</h3>
          {canClose && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              aria-label="Close"
              style={{ padding: '2px 8px', minWidth: 'auto' }}
            >
              ✕
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
              Select a demo profile or enter custom credentials to authenticate with RFC 7519 JWT and RBAC.
            </p>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                Quick-Fill Demo Accounts:
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DEMO_PRESETS.map(p => (
                  <button
                    key={p.role}
                    type="button"
                    className="example-chip"
                    onClick={() => handleSelectPreset(p)}
                    style={{
                      borderColor: email === p.email ? 'var(--accent-primary)' : 'var(--border-color)',
                      backgroundColor: email === p.email ? 'var(--bg-active)' : 'var(--bg-subtle)'
                    }}
                  >
                    <strong>{p.role}</strong>
                    <span>{p.label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: 'var(--space-3)' }}>
                {error}
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
              <label htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                type="email"
                className="form-control"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@decisionflow.io"
                autoComplete="email"
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                className="form-control"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            {canClose && (
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

