import React, { useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import { formatValue, getFieldLabel } from '../utils/formatters';

export default function WorkflowPolicies({ workflows = [] }) {
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0]?.id || 'vendor-approval');
  const activeWf = workflows.find(w => w.id === activeWorkflowId) || workflows[0];

  return (
    <div className="policies-page">
      {/* Introduction Banner */}
      <div className="card" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <div className="card-body">
          <h3 style={{ fontSize: '14px', margin: '0 0 6px', color: 'var(--text-primary)' }}>
            Declarative Policy Architecture
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            DecisionFlow uses declarative JSON policies stored in <code>backend/config/*.json</code>. The rule engine contains zero hardcoded workflow branches. Modifying thresholds, adding rules, or introducing new stages requires editing JSON configuration—no Java, C++, or backend code changes required.
          </p>
        </div>
      </div>

      {/* Workflow Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {workflows.map(wf => (
          <button
            key={wf.id}
            type="button"
            className={`btn ${activeWorkflowId === wf.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveWorkflowId(wf.id)}
          >
            {wf.name} (v{wf.version})
          </button>
        ))}
      </div>

      {activeWf && (
        <>
          {/* Policy Overview Card */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3>{activeWf.name}</h3>
                <span className="card-subtitle">{activeWf.description}</span>
              </div>
              <span className="badge" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}>
                Policy Version {activeWf.version}
              </span>
            </div>

            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', fontSize: '12px' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>
                    Workflow Identifier
                  </span>
                  <code>{activeWf.id}</code>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>
                    Total Evaluation Stages
                  </span>
                  <strong>{activeWf.stages?.length || 0} Stages</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>
                    Max Retry Attempts
                  </span>
                  <strong>{activeWf.maxAttempts || 3} Attempts</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>
                    Default Outcome
                  </span>
                  <StatusBadge status={activeWf.defaultOutcome} />
                </div>
              </div>
            </div>
          </div>

          {/* Input Schema Definition */}
          <div className="card">
            <div className="card-header">
              <h3>Input Schema Definition</h3>
              <span className="card-subtitle">{Object.keys(activeWf.fields || {}).length} declared fields</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Field Key</th>
                      <th>Human Label</th>
                      <th>Data Type</th>
                      <th>Constraints</th>
                      <th>Required?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(activeWf.fields || {}).map(([key, schema]) => (
                      <tr key={key}>
                        <td><code>{key}</code></td>
                        <td>{getFieldLabel(key)}</td>
                        <td><span className="mono-cell">{schema.type}</span></td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {schema.min !== undefined && `min: ${schema.min} `}
                          {schema.max !== undefined && `max: ${schema.max} `}
                          {schema.minLength !== undefined && `minLength: ${schema.minLength}`}
                          {!schema.min && !schema.max && !schema.minLength && '—'}
                        </td>
                        <td>
                          {schema.required ? (
                            <span style={{ color: 'var(--status-rejected-text)', fontWeight: 600 }}>Yes (Mandatory)</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Optional</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Stage Sequence and Rules */}
          <div className="card">
            <div className="card-header">
              <h3>Evaluation Stages & Configured Rules</h3>
              <span className="card-subtitle">Executed sequentially with short-circuit guards</span>
            </div>
            <div className="card-body">
              {activeWf.stages?.map((stage, idx) => (
                <div key={stage.id} style={{ marginBottom: idx < activeWf.stages.length - 1 ? 'var(--space-5)' : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--bg-active)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: '4px' }}>
                      Stage {idx + 1}
                    </span>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{stage.name}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({stage.type.toUpperCase()})</span>
                  </div>

                  {stage.type === 'rules' && stage.rules?.length ? (
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Rule ID</th>
                            <th>Field</th>
                            <th>Operator</th>
                            <th>Threshold Value</th>
                            <th>Triggered Outcome</th>
                            <th>Configured Justification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stage.rules.map(r => (
                            <tr key={r.id}>
                              <td><code>{r.id}</code></td>
                              <td>{r.field}</td>
                              <td><span className="mono-cell">{r.operator}</span></td>
                              <td><strong>{formatValue(r.value)}</strong></td>
                              <td><StatusBadge status={r.outcome} /></td>
                              <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Calls simulated external identity verification adapter with deterministic 503 test doubles.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Version Comparison & Immutability Demonstration */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3>Policy Versioning & Immutability Demonstration</h3>
                <span className="card-subtitle">How DecisionFlow prevents historical corruption</span>
              </div>
            </div>
            <div className="card-body">
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px' }}>
                When business rules change (e.g. lowering annual spend ceiling from ₹5,00,000 to ₹2,50,000 in v2), historical decisions remain 100% explainable because every request stores an immutable <code>policySnapshot</code>. Compare the active v1 baseline against the proposed v2 schema:
              </p>

              <div className="diff-grid">
                <div className="diff-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>vendor-approval (Active v1)</strong>
                    <span className="badge badge-approved">Active</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <li>Annual Spend Review Threshold: <b>₹5,00,000</b></li>
                    <li>Acceptable Risk Score Ceiling: <b>≥ 70</b></li>
                    <li>Declared Required Fields: <code>5 fields</code></li>
                    <li>Compliance Tier: <em>Not required</em></li>
                  </ul>
                </div>

                <div className="diff-box proposed">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--accent-primary)' }}>vendor-approval (Proposed v2)</strong>
                    <span className="badge badge-retry-pending">Staged</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <li>Annual Spend Review Threshold: <b>₹2,50,000 (Strict)</b></li>
                    <li>Acceptable Risk Score Ceiling: <b>≥ 50 (Higher Sensitivity)</b></li>
                    <li>Added Mandatory Field: <code>complianceTier (string)</code></li>
                    <li>Protected Replay: <em>Historical v1 requests bypass v2 validation on idempotent replays.</em></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

