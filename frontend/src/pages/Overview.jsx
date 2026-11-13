import React from 'react';
import StatusBadge from '../components/StatusBadge';
import { formatShortDate } from '../utils/formatters';

export default function Overview({
  metrics,
  workflows,
  recentRequests,
  onInspect,
  onNavigate,
  onRefresh,
  loading
}) {
  return (
    <div className="overview-page">
      {/* Top Banner / Heading */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 6px', color: 'var(--text-primary)' }}>
          DecisionFlow
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, maxWidth: '680px' }}>
          Configurable approval workflows with traceable decisions and failure recovery.
        </p>
      </div>

      {/* Real Statistics from /api/metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Total Requests</span>
          <span className="metric-value">{metrics?.total ?? 0}</span>
          <span className="metric-sub">MongoDB records</span>
        </div>
        <div className="metric-card" style={{ borderLeft: '3px solid var(--status-approved-text)' }}>
          <span className="metric-label">Approved</span>
          <span className="metric-value" style={{ color: 'var(--status-approved-text)' }}>
            {metrics?.approved ?? 0}
          </span>
          <span className="metric-sub">Clean decisions</span>
        </div>
        <div className="metric-card" style={{ borderLeft: '3px solid var(--status-rejected-text)' }}>
          <span className="metric-label">Rejected</span>
          <span className="metric-value" style={{ color: 'var(--status-rejected-text)' }}>
            {metrics?.rejected ?? 0}
          </span>
          <span className="metric-sub">Rule exclusions</span>
        </div>
        <div className="metric-card" style={{ borderLeft: '3px solid var(--status-review-text)' }}>
          <span className="metric-label">Manual Review</span>
          <span className="metric-value" style={{ color: 'var(--status-review-text)' }}>
            {metrics?.manualReview ?? 0}
          </span>
          <span className="metric-sub">Pending review sign-off</span>
        </div>
        <div className="metric-card" style={{ borderLeft: '3px solid var(--status-retry-text)' }}>
          <span className="metric-label">Retry Pending</span>
          <span className="metric-value" style={{ color: 'var(--status-retry-text)' }}>
            {metrics?.retryPending ?? 0}
          </span>
          <span className="metric-sub">Transient 503 backoff</span>
        </div>
        <div className="metric-card" style={{ borderLeft: '3px solid #dc2626' }}>
          <span className="metric-label">Failed</span>
          <span className="metric-value" style={{ color: '#dc2626' }}>
            {metrics?.failed ?? 0}
          </span>
          <span className="metric-sub">Exhausted retry ceiling</span>
        </div>
      </div>

      {/* Available Workflows Section */}
      <div className="card">
        <div className="card-header">
          <h3>Active Workflow Configurations</h3>
          <span className="card-subtitle">{workflows.length} JSON policies loaded</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
            {workflows.map(wf => (
              <div
                key={wf.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  backgroundColor: 'var(--bg-subtle)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{wf.name}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>v{wf.version}</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.4 }}>
                  {wf.description}
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>{wf.stages?.length || 0} stages · Max {wf.maxAttempts || 3} attempts</span>
                  <button
                    type="button"
                    className="btn-link"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                    onClick={() => onNavigate('policies')}
                  >
                    View Policy →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="card">
        <div className="card-header">
          <h3>Recent Requests</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Activity'}
          </button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.map(row => (
                  <tr key={row.id}>
                    <td className="mono-cell">{row.id}</td>
                    <td style={{ fontWeight: 500 }}>{row.workflowId}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>#{row.attempts}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {formatShortDate(row.createdAt)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onInspect(row)}
                      >
                        Inspect Decision
                      </button>
                    </td>
                  </tr>
                ))}
                {!recentRequests.length && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      No requests recorded yet. Submit a new request to see its decision history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

