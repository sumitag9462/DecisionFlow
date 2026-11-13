const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPolicies } = require('../src/config/loadPolicies');
const { validatePolicy, validateData } = require('../src/domain/validation');
const { createDecisionService } = require('../src/services/decisionService');
const { FakeRepository } = require('./FakeRepository');

const vendor = {
  vendorName: 'Northwind Supplies', annualSpend: 150000,
  riskScore: 19, blacklisted: false, documentsComplete: true
};
const claim = {
  claimReference: 'CLM-0007', claimAmount: 10000,
  policyActive: true, documentsComplete: true, fraudScore: 20
};
function fixture() {
  const repo = new FakeRepository();
  const policies = loadPolicies();
  return { repo, policies, service: createDecisionService({ repo, policies }) };
}
async function submit(service, overrides = {}) {
  return service.submit({ workflowId: 'vendor-approval', idempotencyKey: `vendor-${Math.random().toString(36).slice(2)}`,
    data: vendor, ...overrides });
}
async function throwsCode(fn, code) {
  await assert.rejects(fn, e => e.code === code);
}

test('loads two separate valid workflow definitions', () => {
  const policies = loadPolicies();
  assert.equal(policies.size, 2);
  assert.equal(validatePolicy(policies.get('vendor-approval')).id, 'vendor-approval');
});
test('approves vendor with no rule match', async () => {
  const { service } = fixture();
  const { request } = await submit(service);
  assert.equal(request.status, 'APPROVED');
  assert.equal(request.attempts, 1);
  assert.equal(request.trace.filter(x => x.kind === 'rule').length, 4);
});
test('rejects blacklisted vendor before external verification', async () => {
  const { service } = fixture();
  const { request } = await submit(service, { data: { ...vendor, blacklisted: true }, simulation: 'always-fail' });
  assert.equal(request.status, 'REJECTED');
  assert.equal(request.matchedRule, 'VEN-01');
  assert.equal(request.trace.filter(x => x.kind === 'dependency').length, 0);
});
test('routes missing vendor documents to manual review', async () => {
  const { service } = fixture();
  const { request } = await submit(service, { data: { ...vendor, documentsComplete: false } });
  assert.equal(request.status, 'MANUAL_REVIEW');
  assert.equal(request.matchedRule, 'VEN-02');
});
test('flags high annual spend for review', async () => {
  const { service } = fixture();
  const { request } = await submit(service, { data: { ...vendor, annualSpend: 600000 } });
  assert.equal(request.matchedRule, 'VEN-04');
});
test('claim workflow rejects inactive policy', async () => {
  const { service } = fixture();
  const result = await service.submit({ workflowId: 'claim-processing', idempotencyKey: 'claim-inactive-999',
    data: { ...claim, policyActive: false } });
  assert.equal(result.request.status, 'REJECTED');
  assert.equal(result.request.matchedRule, 'CLM-01');
});
test('claim workflow routes fraud risk to review', async () => {
  const { service } = fixture();
  const result = await service.submit({ workflowId: 'claim-processing', idempotencyKey: 'claim-highrisk-999',
    data: { ...claim, fraudScore: 88 } });
  assert.equal(result.request.status, 'MANUAL_REVIEW');
  assert.equal(result.request.matchedRule, 'CLM-03');
});
test('fails once, persists retry state, then succeeds', async () => {
  const { service, repo } = fixture();
  const first = (await submit(service, { simulation: 'fail-once' })).request;
  assert.equal(first.status, 'RETRY_PENDING');
  assert.equal(first.attempts, 1);
  assert.ok(first.nextRetryAt);

  // Premature retry before backoff window expires throws RETRY_TOO_EARLY (429)
  await throwsCode(() => service.retry(first.id), 'RETRY_TOO_EARLY');

  // Expire backoff to simulate waiting until nextRetryAt
  repo.expireBackoff(first.id);
  const next = await service.retry(first.id);
  assert.equal(next.status, 'APPROVED');
  assert.equal(next.attempts, 2);
  assert.equal(next.trace.filter(x => x.kind === 'dependency').length, 2);
});
test('permanent dependency failures stop after configured attempts', async () => {
  const { service, repo } = fixture();
  let row = (await submit(service, { simulation: 'always-fail' })).request;
  assert.equal(row.status, 'RETRY_PENDING');
  assert.equal(row.attempts, 1);

  repo.expireBackoff(row.id);
  row = await service.retry(row.id);
  assert.equal(row.status, 'RETRY_PENDING');
  assert.equal(row.attempts, 2);

  repo.expireBackoff(row.id);
  row = await service.retry(row.id);
  assert.equal(row.status, 'FAILED');
  assert.equal(row.attempts, 3);
  await throwsCode(() => service.retry(row.id), 'NOT_RETRIABLE');
});
test('identical idempotency key returns the original record without repeating work', async () => {
  const { service, repo } = fixture();
  const args = { workflowId: 'vendor-approval', idempotencyKey: 'same-key-123', data: vendor };
  const first = await service.submit(args);
  const second = await service.submit(args);
  assert.equal(second.replayed, true);
  assert.equal(second.request.id, first.request.id);
  assert.equal(repo.rows.size, 1);
  assert.equal(second.request.attempts, 1);
});
test('reused idempotency key with different payload is a conflict', async () => {
  const { service } = fixture();
  await submit(service, { idempotencyKey: 'conflict-key-123' });
  await throwsCode(() => submit(service, { idempotencyKey: 'conflict-key-123',
    data: { ...vendor, riskScore: 20 } }), 'IDEMPOTENCY_CONFLICT');
});
test('twenty parallel identical intakes create only one document', async () => {
  const { service, repo } = fixture();
  const args = { workflowId: 'vendor-approval', idempotencyKey: 'parallel-key-123', data: vendor };
  const batch = await Promise.all(Array.from({ length: 20 }, () => service.submit(args)));
  assert.equal(new Set(batch.map(item => item.request.id)).size, 1);
  assert.equal(repo.rows.size, 1);
  assert.equal(batch.filter(x => !x.replayed).length, 1);
});
test('manual reviewer can approve a request with an auditable reason', async () => {
  const { service } = fixture();
  const row = (await submit(service, { data: { ...vendor, documentsComplete: false } })).request;
  const reviewed = await service.review(row.id, { decision: 'APPROVED', reason: 'Documents supplied offline', reviewer: 'Reviewer 1' });
  assert.equal(reviewed.status, 'APPROVED');
  assert.equal(reviewed.audit.at(-1).actor, 'Reviewer 1');
  await throwsCode(() => service.review(row.id, { decision: 'REJECTED', reason: 'Second decision', reviewer: 'Reviewer 2' }), 'NOT_IN_REVIEW');
});
test('rejects invalid data, including fields absent from schema', async () => {
  const { service, policies } = fixture();
  await throwsCode(() => submit(service, { data: { ...vendor, unexpected: 'x' } }), 'INVALID_INPUT');
  assert.throws(() => validateData(policies.get('vendor-approval'), { ...vendor, riskScore: 102 }));
});
test('rule edit affects new requests, not old version-pinned requests', async () => {
  const { service, policies } = fixture();
  const data = { ...vendor, annualSpend: 350000 };
  const before = (await submit(service, { data, idempotencyKey: 'policy-before-001' })).request;
  assert.equal(before.status, 'APPROVED');
  const edited = structuredClone(policies.get('vendor-approval'));
  edited.version = 2;
  edited.stages.find(x => x.id === 'limits').rules.find(x => x.id === 'VEN-04').value = 250000;
  validatePolicy(edited);
  policies.set('vendor-approval', edited);
  const after = (await submit(service, { data, idempotencyKey: 'policy-after-002' })).request;
  assert.equal(after.status, 'MANUAL_REVIEW');
  assert.equal(before.policyVersion, 1);
  assert.equal(after.policyVersion, 2);
  assert.equal(before.policySnapshot.version, 1);
});
test('lease expiry allows manual recovery of a crashed worker', async () => {
  const { service, repo } = fixture();
  repo.failNextFinish = true;
  const args = { workflowId: 'vendor-approval', idempotencyKey: 'write-error-123', data: vendor };
  await assert.rejects(() => service.submit(args), /write interruption/);
  const stuck = await repo.findByKey('vendor-approval', 'write-error-123');
  assert.equal(stuck.status, 'PROCESSING');
  assert.equal(stuck.audit.some(x => x.type === 'DECISION_RECORDED'), false);
  await throwsCode(() => service.retry(stuck.id), 'IN_PROGRESS');
  repo.expireLease(stuck.id);
  const recovered = await service.retry(stuck.id);
  assert.equal(recovered.status, 'APPROVED');
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.audit.some(x => x.detail.recoveredLease === true), true);
});
test('one actor wins a concurrent retry claim', async () => {
  const { service, repo } = fixture();
  const initial = (await submit(service, { simulation: 'fail-once' })).request;
  repo.expireBackoff(initial.id);
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => service.retry(initial.id)));
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await service.get(initial.id)).attempts, 2);
});
test('audit events have accurate state transitions and rule references', async () => {
  const { service } = fixture();
  const row = (await submit(service)).request;
  assert.deepEqual(row.audit.map(a => `${a.from}->${a.to}`), ['null->RECEIVED', 'RECEIVED->PROCESSING', 'PROCESSING->APPROVED']);
  assert.ok(row.trace.every(x => x.attempt === 1));
});
test('same key can be used for independent workflows', async () => {
  const { service } = fixture();
  const vendorRes = await submit(service, { idempotencyKey: 'shared-key-001' });
  const claimRes = await service.submit({ workflowId: 'claim-processing', idempotencyKey: 'shared-key-001', data: claim });
  assert.notEqual(vendorRes.request.id, claimRes.request.id);
  assert.equal(claimRes.request.status, 'APPROVED');
});

// ── Regression: Bug 1 — idempotency replay after policy adds a required field ──
test('idempotency replay succeeds after policy adds a required field', async () => {
  const { service, policies } = fixture();
  // Submit under v1 (fields: vendorName, annualSpend, riskScore, blacklisted, documentsComplete)
  const args = { workflowId: 'vendor-approval', idempotencyKey: 'replay-policy-change-001', data: vendor };
  const first = await service.submit(args);
  assert.equal(first.replayed, false);

  // Upgrade policy to v2: add a new required field "complianceTier"
  const v2 = structuredClone(policies.get('vendor-approval'));
  v2.version = 2;
  v2.fields.complianceTier = { type: 'string', required: true, minLength: 1 };
  policies.set('vendor-approval', v2);

  // Replay the ORIGINAL payload (without complianceTier) — must succeed as a replay
  const second = await service.submit(args);
  assert.equal(second.replayed, true, 'should be a replay, not a 400 validation error');
  assert.equal(second.request.id, first.request.id, 'must return the original record');
  assert.equal(second.request.policyVersion, 1, 'must carry the original v1 snapshot');
});

// ── Regression: Bug 2 — worker crash on the final allowed attempt ──
test('final-attempt worker crash recovers to FAILED on lease expiry', async () => {
  const { service, repo } = fixture();

  // Get to 2 retries consumed (attempts=2, RETRY_PENDING), then trigger a crash on attempt 3
  let row = (await submit(service, { simulation: 'always-fail', idempotencyKey: 'crash-final-001' })).request;
  assert.equal(row.attempts, 1);
  repo.expireBackoff(row.id);
  row = await service.retry(row.id);             // attempt 2 → RETRY_PENDING
  assert.equal(row.attempts, 2);

  // Arm the simulated crash for the next finish() call, then process attempt 3
  repo.expireBackoff(row.id);
  repo.failNextFinish = true;
  await assert.rejects(() => service.retry(row.id), /write interruption/);

  const stuck = await repo.get(row.id);
  assert.equal(stuck.status, 'PROCESSING', 'must be stuck in PROCESSING');
  assert.equal(stuck.attempts, 3, 'attempts must be at maxAttempts');

  // Expire the lease to allow recovery
  repo.expireLease(stuck.id);

  // retry() must recover the record to FAILED rather than throwing RETRY_LIMIT
  const recovered = await service.retry(stuck.id);
  assert.equal(recovered.status, 'FAILED', 'must recover to FAILED');
  assert.ok(
    recovered.audit.some(e => e.type === 'CRASH_RECOVERY'),
    'audit must contain a CRASH_RECOVERY event'
  );
});

test('repeated recovery on final-attempt crash does not duplicate events', async () => {
  const { service, repo } = fixture();

  // Drive to crash on final attempt (same setup as above)
  let row = (await submit(service, { simulation: 'always-fail', idempotencyKey: 'crash-final-002' })).request;
  repo.expireBackoff(row.id);
  row = await service.retry(row.id);
  repo.expireBackoff(row.id);
  repo.failNextFinish = true;
  await assert.rejects(() => service.retry(row.id), /write interruption/);
  const stuck = await repo.get(row.id);
  repo.expireLease(stuck.id);

  // First recovery
  const recovered = await service.retry(stuck.id);
  assert.equal(recovered.status, 'FAILED');

  // Second call must throw NOT_RETRIABLE, not create a duplicate event
  await throwsCode(() => service.retry(recovered.id), 'NOT_RETRIABLE');
  const after = await repo.get(recovered.id);
  assert.equal(after.audit.filter(e => e.type === 'CRASH_RECOVERY').length, 1,
    'CRASH_RECOVERY must appear exactly once');
});

// ── Standout Feature: What-If Policy Simulation ──
test('what-if simulation runs non-destructively without persisting to database', async () => {
  const { service, repo } = fixture();
  const initialCount = repo.rows.size;

  // Baseline has annualSpend: 150000 -> APPROVED
  // Simulate with lower threshold for VEN-04 (annualSpend > 100000)
  const result = await service.simulate({
    workflowId: 'vendor-approval',
    data: vendor,
    proposedThresholds: { 'VEN-04': 100000 }
  });

  assert.equal(result.workflowId, 'vendor-approval');
  assert.equal(result.baseline.status, 'APPROVED');
  assert.equal(result.simulation.status, 'MANUAL_REVIEW');
  assert.equal(result.simulation.matchedRule, 'VEN-04');
  assert.equal(result.simulation.appliedOverrides.length, 1);
  assert.equal(result.simulation.appliedOverrides[0].ruleId, 'VEN-04');
  assert.equal(result.diff.outcomeChanged, true);

  // Verify non-destructive guarantee: zero records created in repo
  assert.equal(repo.rows.size, initialCount, 'simulation must not write to repository');
});

// ── Standout Feature: Audit Hash Chaining & Tamper Detection ──
test('audit hash chain verifies genuine records and detects tampering', async () => {
  const { service } = fixture();
  const { request } = await submit(service);

  // Genuine record verification
  const verification = service.verifyAuditChain(request);
  assert.equal(verification.valid, true);
  assert.equal(verification.count, 3);
  assert.ok(verification.headHash);

  // Tamper with an event in the audit trail
  const tampered = structuredClone(request);
  tampered.audit[1].detail = { tampered: true }; // modify detail without updating hash
  const tamperedResult = service.verifyAuditChain(tampered);
  assert.equal(tamperedResult.valid, false);
  assert.equal(tamperedResult.brokenAtIndex, 1);
  assert.equal(tamperedResult.reason, 'Tampered event payload detected');
});

// ── Standout Feature: Certified Evidence Packet ──
test('evidence packet contains certified payload, trace, policy snapshot, and audit chain', async () => {
  const { service } = fixture();
  const { request } = await submit(service);

  const evidence = await service.getEvidence(request.id);
  assert.equal(evidence.decision.id, request.id);
  assert.equal(evidence.decision.status, 'APPROVED');
  assert.ok(evidence.certifiedAt);
  assert.ok(evidence.integrity.payloadFingerprint);
  assert.equal(evidence.integrity.auditChainIntact, true);
  assert.equal(evidence.policySnapshot.id, 'vendor-approval');
  assert.ok(Array.isArray(evidence.ruleTrace));
  assert.ok(Array.isArray(evidence.auditHistory));
});

// ── Standout Feature: Real-Time Operational Metrics ──
test('metrics aggregation computes status distribution and averages', async () => {
  const { service } = fixture();
  await submit(service); // APPROVED
  await submit(service, { data: { ...vendor, blacklisted: true }, simulation: 'always-fail' }); // REJECTED
  await submit(service, { data: { ...vendor, documentsComplete: false } }); // MANUAL_REVIEW

  const metrics = await service.getMetrics();
  assert.equal(metrics.total, 3);
  assert.equal(metrics.approved, 1);
  assert.equal(metrics.rejected, 1);
  assert.equal(metrics.manualReview, 1);
  assert.ok(typeof metrics.uptimeSeconds === 'number');
});

// ── Security Regression: What-If Validation & Prototype Pollution Defense ──
test('what-if simulation rejects prototype pollution and invalid overrides', async () => {
  const { service } = fixture();

  // Prototype pollution attempt
  await throwsCode(() => service.simulate({
    workflowId: 'vendor-approval',
    data: vendor,
    proposedThresholds: JSON.parse('{"__proto__": {"admin": true}}')
  }), 'INVALID_INPUT');

  // Unknown rule or threshold key
  await throwsCode(() => service.simulate({
    workflowId: 'vendor-approval',
    data: vendor,
    proposedThresholds: { 'NON_EXISTENT_RULE': 500 }
  }), 'INVALID_OVERRIDE');

  // Incompatible type: string given for numeric rule
  await throwsCode(() => service.simulate({
    workflowId: 'vendor-approval',
    data: vendor,
    proposedThresholds: { 'VEN-04': 'not-a-number' }
  }), 'INVALID_OVERRIDE');
});

// ── Cryptographic Audit Chain: Legacy Record Classification ──
test('audit verification identifies legacy unhashed records as UNVERIFIABLE_LEGACY', async () => {
  const { service } = fixture();
  const legacyRecord = {
    id: 'legacy-001',
    audit: [
      { at: '2025-01-01T00:00:00.000Z', type: 'REQUEST_RECEIVED', from: null, to: 'RECEIVED', actor: 'api', detail: {} }
    ]
  };
  const result = service.verifyAuditChain(legacyRecord);
  assert.equal(result.valid, false);
  assert.equal(result.status, 'UNVERIFIABLE_LEGACY');
  assert.equal(result.count, 1);
});
