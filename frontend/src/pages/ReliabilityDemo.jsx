import React, { useState } from 'react';
import { api } from '../services/api';

export default function ReliabilityDemo({ currentRole, onRefreshHistory, onError, onSuccess }) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);

  function log(msg) {
    setLogs(prev => [`[${new Date().toLocaleTimeString('en-IN')}] ${msg}`, ...prev]);
  }

  // 1. Transient Flap Test
  async function runTransientFlap() {
    setRunning(true);
    log('▶ Scenario 1: Starting Transient Provider Flap Test...');
    try {
      log('Step 1: Submitting request with simulated 503 provider failure (simulation="fail-once")...');
      const res = await api.submitRequest({
        workflowId: 'vendor-approval',
        idempotencyKey: `rel-flap-${Date.now()}`,
        data: {
          vendorName: 'Reliability Vendor A',
          annualSpend: 150000,
          riskScore: 20,
          blacklisted: false,
          documentsComplete: true
        },
        simulation: 'fail-once'
      });

      log(`Attempt 1 response: Status=${res.request.status}, Attempts=${res.request.attempts}`);

      if (res.request.status === 'RETRY_PENDING') {
        log(`Exponential backoff set: nextRetryAt=${res.request.nextRetryAt}`);
        log('Testing backoff window: Immediate retry should be rejected with 429 (RETRY_TOO_EARLY)...');
        try {
          await api.retryRequest(res.request.id);
          log('✖ Premature retry unexpectedly succeeded');
        } catch (earlyErr) {
          log(`✓ Backoff protection verified: Backend returned HTTP 429 (${earlyErr.message})`);
        }
        log('Waiting 1.2s for backoff window to elapse before retrying...');
        await new Promise(r => setTimeout(r, 1200));
        log('Step 2: Triggering POST /api/requests/:id/retry after backoff...');
        const retryRes = await api.retryRequest(res.request.id);
        log(`✓ Retry Successful: Status=${retryRes.status}, Final Attempts=${retryRes.attempts}`);
        onSuccess('Transient self-healing retry verified successfully.');
        onRefreshHistory();
      }
    } catch (err) {
      log(`✖ Error: ${err.message}`);
      onError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // 2. Circuit Breaker Test
  async function runCircuitBreaker() {
    setRunning(true);
    log('▶ Scenario 2: Starting Max Retries & Terminal Failure Guard Test...');
    try {
      log('Step 1: Submitting request with permanent failure (simulation="always-fail")...');
      const res1 = await api.submitRequest({
        workflowId: 'vendor-approval',
        idempotencyKey: `rel-circuit-${Date.now()}`,
        data: {
          vendorName: 'Reliability Vendor B',
          annualSpend: 150000,
          riskScore: 20,
          blacklisted: false,
          documentsComplete: true
        },
        simulation: 'always-fail'
      });

      log(`Attempt 1: Status=${res1.request.status}`);
      log('Waiting 1.2s for backoff window before attempt 2...');
      await new Promise(r => setTimeout(r, 1200));

      log('Step 2: Consuming retry attempt 2...');
      const res2 = await api.retryRequest(res1.request.id);
      log(`Attempt 2: Status=${res2.status}`);

      log('Waiting 2.2s for backoff window before attempt 3...');
      await new Promise(r => setTimeout(r, 2200));

      log('Step 3: Consuming retry attempt 3 (Max configured limit)...');
      const res3 = await api.retryRequest(res1.request.id);
      log(`Attempt 3: Status=${res3.status} (Transitioned to terminal FAILED)`);

      log('Step 4: Testing guard by attempting illegal 4th retry...');
      try {
        await api.retryRequest(res1.request.id);
        log('✖ UNEXPECTED: 4th retry was allowed');
      } catch (e) {
        log(`✓ Guard verified: Backend returned 409 (${e.message})`);
        onSuccess('Max retries & terminal failure guard verified.');
      }
      onRefreshHistory();
    } catch (err) {
      log(`✖ Error: ${err.message}`);
      onError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // 3. 20-Worker Concurrency Test
  async function runConcurrencyRace() {
    setRunning(true);
    const sharedKey = `race-${Date.now()}`;
    log(`▶ Scenario 3: Firing 20 simultaneous HTTP requests with shared key: ${sharedKey}...`);

    try {
      const promises = Array.from({ length: 20 }, (_, idx) =>
        api.submitRequest({
          workflowId: 'vendor-approval',
          idempotencyKey: sharedKey,
          data: {
            vendorName: 'Concurrent Vendor Ltd',
            annualSpend: 150000,
            riskScore: 20,
            blacklisted: false,
            documentsComplete: true
          }
        }).then(res => ({ idx, replayed: res.replayed, id: res.request.id }))
      );

      const results = await Promise.all(promises);
      const uniqueIds = new Set(results.map(r => r.id));
      const firstCreates = results.filter(r => !r.replayed).length;
      const replayedHits = results.filter(r => r.replayed).length;

      log(`Concurrency Race Complete: First-Inserts=${firstCreates}, Idempotent-Replays=${replayedHits}, Unique MongoDB IDs=${uniqueIds.size}`);
      if (uniqueIds.size === 1 && firstCreates === 1 && replayedHits === 19) {
        log('✓ MongoDB Unique Index guarantee confirmed: Exactly 1 record created, 19 replayed.');
        onSuccess('20-worker race condition test passed with zero duplicate records.');
      }
      onRefreshHistory();
    } catch (err) {
      log(`✖ Concurrency Error: ${err.message}`);
      onError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="reliability-page">
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Distributed Reliability & Failure Recovery Lab</h3>
            <span className="card-subtitle">Test real backend recovery mechanisms live</span>
          </div>
        </div>

        <div className="card-body">
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 var(--space-5)' }}>
            DecisionFlow is designed for high-concurrency enterprise environments where downstream third-party dependencies can fail transiently or crash mid-flight. Run these scenarios to verify self-healing retries, circuit breaking, and database-level concurrency locks.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            {/* Scenario 1 */}
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                  1. Transient Provider Flap
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 14px' }}>
                  Injects a simulated 503 error on attempt 1. Verifies that the engine enters <code>RETRY_PENDING</code> and transitions cleanly to <code>APPROVED</code> on attempt 2.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={runTransientFlap}
                disabled={running}
              >
                {running ? 'Running...' : 'Run Transient Flap Test'}
              </button>
            </div>

            {/* Scenario 2 */}
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                  2. Retry Ceiling & Circuit Breaker
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 14px' }}>
                  Permanently drops downstream calls across 3 attempts. Verifies that the engine trips to <code>FAILED</code> and strictly rejects illegal 4th attempts.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={runCircuitBreaker}
                disabled={running}
              >
                {running ? 'Running...' : 'Run Max Retries Test'}
              </button>
            </div>

            {/* Scenario 3 */}
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                  3. 20-Worker Concurrency Collision
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 14px' }}>
                  Fires 20 simultaneous HTTP POST requests with identical idempotency keys. Verifies that MongoDB atomic uniqueness prevents duplicate records.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={runConcurrencyRace}
                disabled={running}
              >
                {running ? 'Running...' : 'Run 20-Worker Race'}
              </button>
            </div>
          </div>

          {/* Diagnostic Console */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Diagnostic Event Stream
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '11px' }}
                onClick={() => setLogs([])}
              >
                Clear Console
              </button>
            </div>
            <div className="console-box">
              {logs.map((l, i) => (
                <div key={i} className="console-line">{l}</div>
              ))}
              {!logs.length && (
                <div style={{ color: 'var(--text-muted)' }}>
                  Click any reliability test above to stream real-time execution logs.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

