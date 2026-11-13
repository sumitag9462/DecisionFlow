import React, { useState, useEffect } from 'react';
import StatusBadge from '../components/StatusBadge';
import StagePipeline from '../components/StagePipeline';
import { formatDateTime, formatValue } from '../utils/formatters';

export default function DecisionExplorer({
  request,
  allRequests = [],
  currentRole,
  onSelectRequest,
  onRetry,
  onReview,
  onVerifyAudit,
  onDownloadEvidence,
  auditIntegrity,
  loading
}) {
  const [reviewerName, setReviewerName] = useState(
    currentRole === 'ADMIN' ? 'Alice Admin' : currentRole === 'REVIEWER' ? 'Bob Reviewer' : 'Charlie Viewer'
  );
  const [reviewReason, setReviewReason] = useState('Supporting documentation verified and approved.');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setReviewerName(
      currentRole === 'ADMIN' ? 'Alice Admin' : currentRole === 'REVIEWER' ? 'Bob Reviewer' : 'Charlie Viewer'
    );
  }, [currentRole]);

  // If no request selected, prompt to pick one
  if (!request) {
    return (
      <div className="explorer-empty-page">
        <div className="card">
          <div className="card-header">
            <h3>Decision Explorer</h3>
          </div>
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
            <h3 style={{ fontSize: '16px', color: 'var(--text-primary)', margin: '0 0 8px' }}>No Request Selected</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto 20px', lineHeight: 1.5 }}>
              Select a previously processed request from the list below or submit a new request to inspect its rule evaluation trace, stage pipeline, and audit history.
            </p>

            {allRequests.length > 0 && (
              <div style={{ maxWidth: '360px', margin: 'auto', textAlign: 'left' }}>
                <label htmlFor="quick-pick" className="form-label">Inspect a Previous Request:</label>
                <select
                  id="quick-pick"
                  className="form-select"
                  onChange={e => {
                    const found = allRequests.find(r => r.id === e.target.value);
                    if (found) onSelectRequest(found);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Choose a request...</option>
                  {allRequests.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.id.slice(0, 10)}... | {r.workflowId} ({r.status})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isViewer = currentRole === 'VIEWER';

  function copyId() {
    navigator.clipboard.writeText(request.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="explorer-page">
      {/* Quick Switcher Bar */}
      {allRequests.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Active Request:</span>
            <select
              className="form-select"
              style={{ minHeight: '30px', padding: '4px 8px', fontSize: '12px', width: 'auto' }}
              value={request.id}
              onChange={e => {
                const found = allRequests.find(r => r.id === e.target.value);
                if (found) onSelectRequest(found);
              }}
            >
              {allRequests.map(r => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 12)}... — {r.workflowId} ({r.status})
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyId}>
            {copied ? '✓ Copied ID' : 'Copy Request ID'}
          </button>
        </div>
      )}

      {/* Section A: Decision Summary Card */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Section A — Decision Verdict</h3>
            <span className="card-subtitle">Deterministic Rule Output</span>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <div className="card-body">
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px', lineHeight: 1.4 }}>
            {request.reason || 'Decision pending worker execution.'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', padding: '14px 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', fontSize: '12px' }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Workflow ID</span>
              <strong>{request.workflowId}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Policy Version</span>
              <strong>v{request.policyVersion} (Pinned Snapshot)</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Execution Attempts</span>
              <strong>{request.attempts} / {request.policySnapshot?.maxAttempts || 3}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Triggered Rule</span>
              <strong>{request.matchedRule || 'None (Clean Pass)'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Created Timestamp</span>
              <span>{formatDateTime(request.createdAt)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Last Updated</span>
              <span>{formatDateTime(request.updatedAt)}</span>
            </div>
          </div>

          {/* Section B: Stage Execution Pipeline */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
              Section B — Sequential Stage Execution Pipeline
            </span>
            <StagePipeline
              stages={request.policySnapshot?.stages || []}
              trace={request.trace || []}
              status={request.status}
            />
          </div>

          {/* Action & Evidence Controls */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onVerifyAudit(request.id)}
              disabled={loading}
            >
              🛡️ Verify Audit Hash Chain
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onDownloadEvidence(request.id)}
              disabled={loading}
            >
              📜 Export Decision Evidence (.json)
            </button>
          </div>

          {/* Real-time Audit Chain Verification Result */}
          {auditIntegrity && (
            <div
              className={`alert ${auditIntegrity.status === 'VERIFIED' ? 'alert-success' : auditIntegrity.status === 'UNVERIFIABLE_LEGACY' ? 'alert-info' : 'alert-error'}`}
              style={{ marginTop: 'var(--space-3)', marginBottom: 0, padding: '10px 14px', fontSize: '12px' }}
            >
              {auditIntegrity.status === 'VERIFIED' ? (
                <span>
                  ✓ <b>Audit Ledger Cryptographically Verified:</b> All {auditIntegrity.count} transitions verified via SHA-256 hash chaining. Head: <code>{auditIntegrity.headHash?.slice(0, 16)}...</code>
                </span>
              ) : auditIntegrity.status === 'UNVERIFIABLE_LEGACY' ? (
                <span>
                  ℹ <b>Legacy Audit Record:</b> Record predates cryptographic audit hash chaining ({auditIntegrity.count} entries).
                </span>
              ) : (
                <span>
                  ⚠️ <b>Integrity Check Failed:</b> Broken sequence at event index #{auditIntegrity.brokenAtIndex} ({auditIntegrity.reason})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section E: Manual Review Interface (If in MANUAL_REVIEW) */}
      {request.status === 'MANUAL_REVIEW' && (
        <div className="card" style={{ borderLeft: '4px solid var(--status-review-text)' }}>
          <div className="card-header">
            <h3>Section E — Manual Review Decision Panel</h3>
            <span className="badge badge-manual-review">Action Required</span>
          </div>
          <div className="card-body">
            {isViewer ? (
              <div className="alert alert-error" style={{ margin: 0 }}>
                <span>🔒 <b>Read-Only Mode:</b> Current role <code>VIEWER</code> is not authorized to submit manual reviews. Switch to <code>Reviewer</code> or <code>Admin</code> in the top navigation bar.</span>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  This request exceeded an automated policy threshold and was routed for human sign-off. Enter an auditable reason to resolve this decision.
                </p>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="reviewer-name" className="form-label">Reviewer Identity</label>
                    <input
                      id="reviewer-name"
                      className="form-input"
                      value={reviewerName}
                      disabled
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="review-reason" className="form-label">Decision Justification <em>*</em></label>
                    <input
                      id="review-reason"
                      className="form-input"
                      value={reviewReason}
                      onChange={e => setReviewReason(e.target.value)}
                      placeholder="Minimum 5 characters..."
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={loading || reviewReason.trim().length < 5}
                    onClick={() => onReview(request.id, 'APPROVED', reviewerName, reviewReason)}
                  >
                    {loading ? 'Submitting...' : 'Approve Request'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={loading || reviewReason.trim().length < 5}
                    onClick={() => onReview(request.id, 'REJECTED', reviewerName, reviewReason)}
                  >
                    {loading ? 'Submitting...' : 'Reject Request'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Retry Action (If in RETRY_PENDING) */}
      {request.status === 'RETRY_PENDING' && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-primary)' }}>
          <div className="card-header">
            <h3>Transient Failure — Self-Healing Retry</h3>
            <span className="badge badge-retry-pending">Retry Pending</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
              The simulated external verification provider returned a 503 error. The request state is safely stored with an exponential backoff timestamp.
            </p>
            {request.nextRetryAt && (
              <div style={{ fontSize: '12px', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                Next eligible retry window: <strong>{formatDateTime(request.nextRetryAt)}</strong>
                {new Date(request.nextRetryAt) > new Date() && (
                  <span style={{ color: '#b45309', marginLeft: '8px' }}>
                    (Backoff active: retry will be eligible once timestamp is reached)
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || isViewer}
              onClick={() => onRetry(request.id)}
            >
              {loading ? 'Executing Retry...' : `Retry Request (Attempt ${request.attempts + 1})`}
            </button>
            {isViewer && <small style={{ display: 'block', color: 'var(--status-rejected-text)', marginTop: '6px' }}>Viewer role cannot execute retries.</small>}
          </div>
        </div>
      )}

      {/* Section C: Rule Evaluation Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Section C — Rule Evaluation Trace</h3>
            <span className="card-subtitle">{request.trace?.length || 0} evaluated checks</span>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Attempt & Stage</th>
                  <th>Rule ID & Expression</th>
                  <th>Evaluated Fact</th>
                  <th>Matched?</th>
                  <th>Configured Reason</th>
                </tr>
              </thead>
              <tbody>
                {request.trace?.map((item, idx) => {
                  const isFinalTrigger = item.matched && item.ruleId === request.matchedRule;
                  return (
                    <tr
                      key={`${item.attempt}-${idx}`}
                      style={isFinalTrigger ? { backgroundColor: '#fffbeb' } : {}}
                    >
                      <td>
                        <span className="mono-cell" style={{ color: 'var(--text-secondary)', marginRight: '4px' }}>
                          #{item.attempt}
                        </span>
                        <strong>{item.stageName}</strong>
                      </td>
                      <td>
                        {item.kind === 'rule' ? (
                          <div>
                            <code className="mono-cell" style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                              {item.ruleId}
                            </code>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {item.field} {item.operator} {formatValue(item.expected)}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <strong>Simulated Verification</strong>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              External Provider Call
                            </div>
                          </div>
                        )}
                      </td>
                      <td>
                        {item.kind === 'rule' ? (
                          formatValue(item.actual)
                        ) : (
                          <span className="mono-cell">{item.reference || '503 Service Unavailable'}</span>
                        )}
                      </td>
                      <td>
                        {item.kind === 'dependency' ? (
                          <span className={item.outcome === 'OK' ? 'badge badge-approved' : 'badge badge-rejected'}>
                            {item.outcome === 'OK' ? 'Passed' : 'Unavailable'}
                          </span>
                        ) : item.matched ? (
                          <span className="badge badge-rejected">Yes (Matched)</span>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No (Skipped)</span>
                        )}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '300px' }}>
                        {item.reason}
                        {isFinalTrigger && (
                          <span style={{ display: 'block', fontSize: '10px', color: 'var(--status-review-text)', fontWeight: 700, marginTop: '2px' }}>
                            ★ Triggered Final Decision
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!request.trace?.length && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No rule traces recorded for this request.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section D: Cryptographic Audit History */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Section D — Cryptographic Audit History</h3>
            <span className="card-subtitle">{request.audit?.length || 0} state transitions (SHA-256 Chained)</span>
          </div>
        </div>
        <div className="card-body">
          <ul className="timeline">
            {request.audit?.map((ev, i) => (
              <li key={i} className="timeline-item">
                <div className="timeline-time">
                  {formatDateTime(ev.at)}
                </div>
                <div className="timeline-content">
                  <strong>{ev.type.replaceAll('_', ' ')}</strong>
                  <p>
                    Transition: <code>{ev.from || 'null'}</code> → <b>{ev.to}</b> · Actor: <code>{ev.actor}</code>
                  </p>
                  {ev.detail?.reason && (
                    <p style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}>
                      "{ev.detail.reason}"
                    </p>
                  )}
                  {ev.hash && (
                    <div className="timeline-hash">
                      <span>prev: <code>{ev.prevHash?.slice(0, 12)}...</code></span>
                      <span>hash: <code>{ev.hash?.slice(0, 12)}...</code></span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

