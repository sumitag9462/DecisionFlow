import React, { useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatValue, getFieldLabel } from '../utils/formatters';

const defaultInputs = {
  'vendor-approval': {
    vendorName: 'Acme Logistics Ltd',
    annualSpend: 350000,
    riskScore: 22,
    blacklisted: false,
    documentsComplete: true
  },
  'claim-processing': {
    claimReference: 'CLM-2026-900',
    claimAmount: 45000,
    policyActive: true,
    documentsComplete: true,
    fraudScore: 25
  }
};

export default function WhatIfSimulator({
  workflows = [],
  onSimulate,
  simulationResult,
  loading
}) {
  const [selectedWfId, setSelectedWfId] = useState('vendor-approval');
  const [inputs, setInputs] = useState({ ...defaultInputs['vendor-approval'] });

  // Proposed threshold overrides
  const [vendorSpendLimit, setVendorSpendLimit] = useState(250000); // Baseline is 500,000
  const [vendorRiskLimit, setVendorRiskLimit] = useState(50);       // Baseline is 70
  const [claimAmountLimit, setClaimAmountLimit] = useState(80000);  // Baseline is 100,000
  const [claimFraudLimit, setClaimFraudLimit] = useState(45);       // Baseline is 60

  function handleWfChange(id) {
    setSelectedWfId(id);
    setInputs({ ...(defaultInputs[id] || {}) });
  }

  function handleInputChange(field, val, type) {
    let value = val;
    if (type === 'number') value = val === '' ? '' : Number(val);
    else if (type === 'boolean') value = val === 'true';
    setInputs(prev => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const proposedThresholds = selectedWfId === 'vendor-approval'
      ? { 'VEN-04': vendorSpendLimit, 'VEN-03': vendorRiskLimit }
      : { 'CLM-04': claimAmountLimit, 'CLM-03': claimFraudLimit };

    onSimulate({
      workflowId: selectedWfId,
      data: inputs,
      proposedThresholds
    });
  }

  const activeWf = workflows.find(w => w.id === selectedWfId);

  return (
    <div className="simulator-page">
      {/* Introduction Card */}
      <div className="card" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <div className="card-body" style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <strong style={{ fontSize: '13px', color: '#166534' }}>
                🛡️ Zero-Mutation Sandbox Guarantee
              </strong>
              <p style={{ fontSize: '12px', color: '#15803d', margin: '2px 0 0', lineHeight: 1.4 }}>
                Evaluates prospective policy thresholds in-memory against the deterministic rule engine. No database records are written, and historical audits remain untouched.
              </p>
            </div>
            <span className="badge badge-approved" style={{ fontSize: '11px' }}>
              In-Memory Dry Run
            </span>
          </div>
        </div>
      </div>

      <div className="two-col-grid">
        {/* Left Column: Form & Threshold Controls */}
        <div className="card">
          <div className="card-header">
            <h3>1. Configure Proposed Scenario</h3>
            <span className="card-subtitle">Adjust Inputs & Policy Thresholds</span>
          </div>

          <form onSubmit={handleSubmit} className="card-body">
            <div className="form-group">
              <label htmlFor="sim-wf-select" className="form-label">Workflow Policy</label>
              <select
                id="sim-wf-select"
                className="form-select"
                value={selectedWfId}
                onChange={e => handleWfChange(e.target.value)}
              >
                {workflows.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            {/* Threshold Overrides */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 'var(--space-3)' }}>
                Proposed Policy Threshold Overrides
              </span>

              {selectedWfId === 'vendor-approval' ? (
                <>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span className="form-label">Rule VEN-04: Annual Spend Review Threshold</span>
                      <strong>{formatCurrency(vendorSpendLimit)}</strong>
                    </div>
                    <input
                      type="range"
                      min="50000"
                      max="1000000"
                      step="25000"
                      value={vendorSpendLimit}
                      onChange={e => setVendorSpendLimit(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span className="form-hint">Baseline threshold: ₹5,00,000</span>
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span className="form-label">Rule VEN-03: Max Acceptable Risk Score</span>
                      <strong>{vendorRiskLimit} / 100</strong>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="90"
                      step="5"
                      value={vendorRiskLimit}
                      onChange={e => setVendorRiskLimit(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span className="form-hint">Baseline threshold: 70</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span className="form-label">Rule CLM-04: Max Auto-Approve Claim Amount</span>
                      <strong>{formatCurrency(claimAmountLimit)}</strong>
                    </div>
                    <input
                      type="range"
                      min="10000"
                      max="250000"
                      step="5000"
                      value={claimAmountLimit}
                      onChange={e => setClaimAmountLimit(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span className="form-hint">Baseline threshold: ₹100,000</span>
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span className="form-label">Rule CLM-03: Max Acceptable Fraud Score</span>
                      <strong>{claimFraudLimit} / 100</strong>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="80"
                      step="5"
                      value={claimFraudLimit}
                      onChange={e => setClaimFraudLimit(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span className="form-hint">Baseline threshold: 60</span>
                  </div>
                </>
              )}
            </div>

            {/* Test Input Payload */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 'var(--space-3)' }}>
                Test Input Payload
              </span>

              <div className="form-row">
                {Object.entries(activeWf?.fields || {}).map(([key, schema]) => (
                  <div key={key} className="form-group">
                    <label htmlFor={`sim-input-${key}`} className="form-label">{getFieldLabel(key)}</label>
                    {schema.type === 'boolean' ? (
                      <select
                        id={`sim-input-${key}`}
                        className="form-select"
                        value={String(inputs[key] ?? false)}
                        onChange={e => handleInputChange(key, e.target.value, 'boolean')}
                      >
                        <option value="false">No (False)</option>
                        <option value="true">Yes (True)</option>
                      </select>
                    ) : (
                      <input
                        id={`sim-input-${key}`}
                        className="form-input"
                        type={schema.type === 'number' ? 'number' : 'text'}
                        value={inputs[key] ?? ''}
                        onChange={e => handleInputChange(key, e.target.value, schema.type)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px' }}
              disabled={loading}
            >
              {loading ? 'Evaluating Dry-Run...' : 'Execute What-If Comparison'}
            </button>
          </form>
        </div>

        {/* Right Column: Simulation Output */}
        <div>
          {simulationResult ? (
            <div className="card">
              <div className="card-header">
                <h3>2. Side-by-Side Impact Comparison</h3>
                <span className="badge badge-approved">Evaluated In-Memory</span>
              </div>

              <div className="card-body">
                {/* Diff Summary Alert */}
                <div
                  className={`alert ${simulationResult.diff.outcomeChanged ? 'alert-info' : 'alert-success'}`}
                  style={{ marginBottom: 'var(--space-4)' }}
                >
                  <div>
                    <strong>
                      {simulationResult.diff.outcomeChanged ? '⚠️ Policy Outcome Shift Detected' : '✓ Outcome Unchanged'}
                    </strong>
                    <p style={{ margin: '3px 0 0', fontSize: '12px' }}>
                      {simulationResult.diff.summary}
                    </p>
                  </div>
                </div>

                {/* Two Comparison Cards */}
                <div className="diff-grid">
                  <div className="diff-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '12px' }}>Original / Baseline</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{simulationResult.baseline.policyVersion}</span>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <StatusBadge status={simulationResult.baseline.status} />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                      {simulationResult.baseline.reason}
                    </p>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Triggered: <b>{simulationResult.baseline.matchedRule || 'None'}</b>
                    </span>
                  </div>

                  <div className="diff-box proposed">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--accent-primary)' }}>Simulated Policy</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{simulationResult.simulation.policyVersion}</span>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <StatusBadge status={simulationResult.simulation.status} />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                      {simulationResult.simulation.reason}
                    </p>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Triggered: <b>{simulationResult.simulation.matchedRule || 'None'}</b>
                    </span>
                  </div>
                </div>

                {/* Overrides Table */}
                <div style={{ marginTop: 'var(--space-5)' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                    Applied Threshold Overrides ({simulationResult.simulation.appliedOverrides?.length || 0})
                  </span>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Rule ID</th>
                          <th>Field</th>
                          <th>Baseline Threshold</th>
                          <th>Simulated Threshold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulationResult.simulation.appliedOverrides?.map(o => (
                          <tr key={o.ruleId}>
                            <td><code>{o.ruleId}</code></td>
                            <td>{o.field}</td>
                            <td>{formatValue(o.oldThreshold)}</td>
                            <td><strong style={{ color: 'var(--accent-primary)' }}>{formatValue(o.newThreshold)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>🧪</div>
                <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', margin: '0 0 6px' }}>Awaiting Simulation</h3>
                <p style={{ fontSize: '12px', maxWidth: '340px', margin: 'auto', lineHeight: 1.5 }}>
                  Adjust the threshold sliders on the left and click <b>Execute What-If Comparison</b> to inspect how policy changes impact decisions before deploying them.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

