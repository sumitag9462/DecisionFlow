import React, { useState, useEffect, useCallback, useMemo } from 'react';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime } from '../utils/formatters';
import { api } from '../services/api';

export default function RequestHistory({
  workflows = [],
  onInspect,
  onRefresh: parentRefresh,
  loading: parentLoading
}) {
  const [filterWorkflow, setFilterWorkflow] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [serverData, setServerData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);

  const loadRequests = useCallback(async (targetPage = page, wf = filterWorkflow, st = filterStatus) => {
    setLoading(true);
    try {
      const res = await api.getRequests({
        paginated: true,
        page: targetPage,
        limit,
        status: st !== 'ALL' ? st : undefined,
        workflowId: wf !== 'ALL' ? wf : undefined
      });
      if (res && Array.isArray(res.items)) {
        setServerData(res);
      }
    } catch (err) {
      console.error('[RequestHistory] Pagination fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, filterWorkflow, filterStatus]);

  useEffect(() => {
    loadRequests(page, filterWorkflow, filterStatus);
  }, [loadRequests, page, filterWorkflow, filterStatus]);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return serverData.items;
    const q = searchTerm.trim().toLowerCase();
    return serverData.items.filter(row =>
      (row.id && row.id.toLowerCase().includes(q)) ||
      (row.idempotencyKey && row.idempotencyKey.toLowerCase().includes(q)) ||
      (row.matchedRule && row.matchedRule.toLowerCase().includes(q))
    );
  }, [serverData.items, searchTerm]);

  function handleFilterChange(type, value) {
    setPage(1);
    if (type === 'workflow') setFilterWorkflow(value);
    if (type === 'status') setFilterStatus(value);
  }

  function handleRefresh() {
    loadRequests(page, filterWorkflow, filterStatus);
    if (parentRefresh) parentRefresh();
  }

  const isBusy = loading || parentLoading;

  return (
    <div className="history-page">
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Request Lifecycle History</h3>
            <span className="card-subtitle">
              Showing {filtered.length} of {serverData.total} records (Page {page} of {serverData.totalPages || 1})
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRefresh}
            disabled={isBusy}
          >
            {isBusy ? 'Refreshing...' : 'Refresh Records'}
          </button>
        </div>

        <div className="card-body">
          {/* Filter Bar */}
          <div className="filter-bar">
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="filter-wf" className="form-label" style={{ fontSize: '11px' }}>Workflow</label>
              <select
                id="filter-wf"
                className="form-select"
                style={{ padding: '6px 10px', minHeight: '32px' }}
                value={filterWorkflow}
                onChange={e => handleFilterChange('workflow', e.target.value)}
              >
                <option value="ALL">All Workflows</option>
                {workflows.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="filter-status" className="form-label" style={{ fontSize: '11px' }}>Status</label>
              <select
                id="filter-status"
                className="form-select"
                style={{ padding: '6px 10px', minHeight: '32px' }}
                value={filterStatus}
                onChange={e => handleFilterChange('status', e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
                <option value="RETRY_PENDING">Retry Pending</option>
                <option value="FAILED">Failed</option>
                <option value="PROCESSING">Processing</option>
              </select>
            </div>

            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '180px' }}>
              <label htmlFor="filter-search" className="form-label" style={{ fontSize: '11px' }}>Search Page (ID / Key / Rule)</label>
              <input
                id="filter-search"
                type="text"
                className="form-input"
                style={{ padding: '6px 10px', minHeight: '32px' }}
                placeholder="Search MongoDB ID or idempotency key..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            {(filterWorkflow !== 'ALL' || filterStatus !== 'ALL' || searchTerm) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ alignSelf: 'flex-end', height: '32px' }}
                onClick={() => {
                  setFilterWorkflow('ALL');
                  setFilterStatus('ALL');
                  setSearchTerm('');
                  setPage(1);
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Attempts</th>
                  <th>Triggered Rule</th>
                  <th>Created Date</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.id}>
                    <td className="mono-cell" title={row.id}>
                      {row.id.slice(0, 10)}...
                    </td>
                    <td style={{ fontWeight: 500 }}>{row.workflowId}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>v{row.policyVersion}</td>
                    <td>#{row.attempts}</td>
                    <td className="mono-cell" style={{ fontSize: '11px' }}>
                      {row.matchedRule || '—'}
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {formatDateTime(row.createdAt)}
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
                {!filtered.length && (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                      {isBusy ? 'Loading records from MongoDB...' : 'No requests match the selected filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-color)', fontSize: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Showing {serverData.total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, serverData.total)} of {serverData.total} total records
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1 || isBusy}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <span style={{ fontWeight: 600 }}>
                Page {page} of {serverData.totalPages || 1}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= serverData.totalPages || isBusy}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
