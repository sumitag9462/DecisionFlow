import React, { useState, useEffect } from 'react';
import StatusBadge from '../components/StatusBadge';
import { getFieldLabel, generateKey } from '../utils/formatters';

const presets = {
  'vendor-approval': [
    {
      title: 'Standard Approval',
      note: 'All criteria satisfied (Spend <= 500k, Risk <= 30)',
      data: {
        vendorName: 'Northwind Supplies Ltd',
        annualSpend: 150000,
        riskScore: 19,
        blacklisted: false,
        documentsComplete: true
      },
      simulation: 'ok'
    },
    {
      title: 'Exclusion Rejected',
      note: 'Vendor appears on global blacklist (VEN-01)',
      data: {
        vendorName: 'Blacklisted Logistics Co',
        annualSpend: 80000,
        riskScore: 25,
        blacklisted: true,
        documentsComplete: true
      },
      simulation: 'always-fail' // Should short-circuit before dependency!
    },
    {
      title: 'Manual Review (Spend)',
      note: 'Annual spend ₹650k exceeds threshold (VEN-04)',
      data: {
        vendorName: 'Global Heavy Machinery',
        annualSpend: 650000,
        riskScore: 22,
        blacklisted: false,
        documentsComplete: true
      },
      simulation: 'ok'
    },
    {
      title: 'Provider Timeout (503)',
      note: 'Simulated 503 error on first attempt',
      data: {
        vendorName: 'Pacific Rim Exports',
        annualSpend: 120000,
        riskScore: 18,
        blacklisted: false,
        documentsComplete: true
      },
      simulation: 'fail-once'
    }
  ],
  'claim-processing': [
    {
      title: 'Standard Approval',
      note: 'Claim ₹25k within auto-approval threshold',
      data: {
        claimReference: 'CLM-2026-014',
        claimAmount: 25000,
        policyActive: true,
        documentsComplete: true,
        fraudScore: 15
      },
      simulation: 'ok'
    },
    {
      title: 'Policy Inactive',
      note: 'Expired or cancelled policy (CLM-01)',
      data: {
        claimReference: 'CLM-2026-099',
        claimAmount: 15000,
        policyActive: false,
        documentsComplete: true,
        fraudScore: 10
      },
      simulation: 'ok'
    },
    {
      title: 'Manual Review (Fraud)',
      note: 'Fraud score 75 exceeds threshold 60 (CLM-03)',
      data: {
        claimReference: 'CLM-2026-888',
        claimAmount: 30000,
        policyActive: true,
        documentsComplete: true,
        fraudScore: 75
      },
      simulation: 'ok'
    },
    {
      title: 'Provider Timeout (503)',
      note: 'Simulated 503 error on first attempt',
      data: {
        claimReference: 'CLM-2026-404',
        claimAmount: 20000,
        policyActive: true,
        documentsComplete: true,
        fraudScore: 12
      },
      simulation: 'fail-once'
    }
  ]
};

export default function NewRequest({
  workflows,
  onSubmit,
  onInspect,
  loading,
  lastResult
}) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('vendor-approval');
  const [formData, setFormData] = useState({});
  const [simulation, setSimulation] = useState('ok');
  const [idempotencyKey, setIdempotencyKey] = useState(generateKey);

  const activePolicy = workflows.find(w => w.id === selectedWorkflowId);

  // Initialize form data when workflow changes
  useEffect(() => {
    if (activePolicy?.fields) {
      const preset = presets[selectedWorkflowId]?.[0];
      if (preset) {
        setFormData({ ...preset.data });
        setSimulation(preset.simulation);
      } else {
        const initial = {};
        for (const [key, schema] of Object.entries(activePolicy.fields)) {
          if (schema.type === 'boolean') initial[key] = false;
          else if (schema.type === 'number') initial[key] = schema.min || 0;
          else initial[key] = '';
        }
        setFormData(initial);
      }
      setIdempotencyKey(generateKey());
    }
  }, [selectedWorkflowId, activePolicy]);

  function handlePreset(p) {
    setFormData({ ...p.data });
    setSimulation(p.simulation || 'ok');
    setIdempotencyKey(generateKey());
  }

  function handleFieldChange(name, type, val) {
    let value = val;
    if (type === 'number') {
      value = val === '' ? '' : Number(val);
    } else if (type === 'boolean') {
      value = val === 'true';
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      workflowId: selectedWorkflowId,
      idempotencyKey,
      data: formData,
      simulation
    });
  }

  return (
    <div className="new-request-page">
      <div className="two-col-grid">
        {/* Left Column: Input Form */}
        <div className="card">
          <div className="card-header">
            <h3>New Request Intake</h3>
            <span className="card-subtitle">Validated by JSON Policy</span>
          </div>

          <form onSubmit={handleSubmit} className="card-body">
            {/* Step 1: Select Workflow */}
            <div className="form-group">
              <label htmlFor="workflow-select" className="form-label">
                Target Workflow Policy <em>*</em>
              </label>
              <select
                id="workflow-select"
                className="form-select"
                value={selectedWorkflowId}
                onChange={e => setSelectedWorkflowId(e.target.value)}
              >
                {workflows.map(wf => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} (v{wf.version})
                  </option>
                ))}
              </select>
            </div>

            {/* Example Presets */}
            <div style={{ margin: 'var(--space-3) 0 var(--space-4)' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Quick Test Presets
              </span>
              <div className="examples-bar">
                {(presets[selectedWorkflowId] || []).map(p => (
                  <button
                    key={p.title}
                    type="button"
                    className="example-chip"
                    onClick={() => handlePreset(p)}
                  >
                    <strong>{p.title}</strong>
                    <span>{p.note}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Form Fields */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 'var(--space-3)' }}>
                Request Payload Fields
              </span>

              <div className="form-row">
                {Object.entries(activePolicy?.fields || {}).map(([name, schema]) => (
                  <div key={name} className="form-group">
                    <label htmlFor={`field-${name}`} className="form-label">
                      {getFieldLabel(name)}
                      {schema.required && <em> *</em>}
                    </label>

                    {schema.type === 'boolean' ? (
                      <select
                        id={`field-${name}`}
                        className="form-select"
                        value={String(formData[name] ?? false)}
                        onChange={e => handleFieldChange(name, 'boolean', e.target.value)}
                      >
                        <option value="false">No (False)</option>
                        <option value="true">Yes (True)</option>
                      </select>
                    ) : (
                      <input
                        id={`field-${name}`}
                        className="form-input"
                        type={schema.type === 'number' ? 'number' : 'text'}
                        min={schema.min}
                        max={schema.max}
                        step={schema.type === 'number' ? 'any' : undefined}
                        value={formData[name] ?? ''}
                        onChange={e => handleFieldChange(name, schema.type, e.target.value)}
                        required={schema.required}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Step 3: Verification Simulation Mode */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <div className="form-group">
                <label htmlFor="sim-select" className="form-label">
                  Verification Dependency (Simulation Mode)
                </label>
                <select
                  id="sim-select"
                  className="form-select"
                  value={simulation}
                  onChange={e => setSimulation(e.target.value)}
                >
                  <option value="ok">Service Available (200 OK)</option>
                  <option value="fail-once">Simulate 503 Transient Flap (Recovers on retry)</option>
                  <option value="always-fail">Simulate Downstream Outage (Always 503)</option>
                </select>
                <span className="form-hint">
                  Simulated external dependency adapter for deterministic test reproducibility.
                </span>
              </div>
            </div>

            {/* Step 4: Idempotency Key */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="idempotency-key" className="form-label">
                    Idempotency-Key Header
                  </label>
                  <button
                    type="button"
                    className="btn-link"
                    style={{ fontSize: '11px' }}
                    onClick={() => setIdempotencyKey(generateKey())}
                  >
                    Generate Fresh Key
                  </button>
                </div>
                <input
                  id="idempotency-key"
                  className="form-input mono-cell"
                  value={idempotencyKey}
                  onChange={e => setIdempotencyKey(e.target.value)}
                  required
                />
                <span className="form-hint">
                  Submitting with the same key returns the cached decision (200 OK) without repeating external work.
                </span>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px' }}
              disabled={loading || !activePolicy}
            >
              {loading ? 'Evaluating Rules...' : 'Run Decision Engine'}
            </button>
          </form>
        </div>

        {/* Right Column: Submission Result */}
        <div>
          {lastResult ? (
            <div className="card">
              <div className="card-header">
                <h3>Decision Result</h3>
                <StatusBadge status={lastResult.status} />
              </div>

              <div className="card-body">
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '14px', lineHeight: 1.4 }}>
                  {lastResult.reason}
                </div>

                {lastResult.replayed && (
                  <div className="alert alert-info" style={{ padding: '8px 12px', fontSize: '12px' }}>
                    <span>🔄 <b>Idempotent Replay:</b> Original record returned without re-executing checks.</span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px' }}>Workflow</span>
                    <strong>{lastResult.workflowId}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px' }}>Policy Version</span>
                    <strong>v{lastResult.policyVersion}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px' }}>Attempts</span>
                    <strong>{lastResult.attempts} / {lastResult.policySnapshot?.maxAttempts || 3}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px' }}>Triggered Rule</span>
                    <strong>{lastResult.matchedRule || 'None (Pass)'}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '12px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '11px', marginBottom: '2px' }}>Request ID</span>
                  <code className="mono-cell" style={{ wordBreak: 'break-all' }}>{lastResult.id}</code>
                </div>

                <div style={{ marginTop: '20px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => onInspect(lastResult)}
                  >
                    Open in Decision Explorer →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚡</div>
                <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', margin: '0 0 6px' }}>Ready to Process</h3>
                <p style={{ fontSize: '12px', maxWidth: '320px', margin: 'auto', lineHeight: 1.5 }}>
                  Choose a preset or fill out the form on the left, then click <b>Run Decision Engine</b>. The evaluated verdict will appear here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

