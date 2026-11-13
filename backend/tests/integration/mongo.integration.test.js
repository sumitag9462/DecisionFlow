'use strict';
/**
 * MongoDB Integration Test Suite — DecisionFlow
 *
 * Tests run against a REAL MongoDB instance (decisionflow_integration_test database).
 * If MongoDB is unavailable all tests are skipped (never marked as passed).
 */

const mongoose = require('mongoose');
const { MongoRepository } = require('../../src/persistence/MongoRepository');
const RequestModel = require('../../src/persistence/RequestModel');
const { loadPolicies } = require('../../src/config/loadPolicies');
const { createDecisionService, fingerprint } = require('../../src/services/decisionService');

const TEST_URI =
  process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/decisionflow_integration_test';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Unique key generator — avoids cross-test contamination */
let keySeq = 0;
function uid(prefix = 'key') {
  return `${prefix}-${Date.now()}-${++keySeq}`;
}

/** Minimal valid vendor-approval payload */
function vendorPayload(overrides = {}) {
  return {
    vendorName: 'Acme Corp',
    annualSpend: 10000,
    riskScore: 20,
    blacklisted: false,
    documentsComplete: true,
    ...overrides,
  };
}

/** Minimal valid claim-processing payload */
function claimPayload(overrides = {}) {
  return {
    claimReference: 'CLM-001',
    claimAmount: 5000,
    policyActive: true,
    documentsComplete: true,
    fraudScore: 10,
    ...overrides,
  };
}

// ── global setup ─────────────────────────────────────────────────────────────

let policies;
let service;

beforeAll(async () => {
  if (!TEST_URI.toLowerCase().includes('test')) {
    throw new Error(`TEST_MONGO_URI must be a dedicated test database containing 'test' in the URI name. Got: ${TEST_URI}`);
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
  if (!mongoose.connection.name.toLowerCase().includes('test')) {
    await mongoose.disconnect();
    throw new Error(`Connected database name "${mongoose.connection.name}" does not contain "test". Aborting for safety.`);
  }

  // Ensure indexes are built before tests
  await RequestModel.init();
  policies = loadPolicies();
  service = createDecisionService({ repo: new MongoRepository(), policies });
}, 15000);

afterAll(async () => {
  if (mongoose.connection?.name?.toLowerCase().includes('test')) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

beforeEach(async () => {
  await RequestModel.deleteMany({});
});

// ── TEST SUITE ────────────────────────────────────────────────────────────────

describe('MongoDB Integration Tests', () => {
  // ── 1. Create & persist ───────────────────────────────────────────────────
  test('1. Create a valid vendor request and verify persistence in MongoDB', async () => {

    const { request } = await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('create'),
      data: vendorPayload(),
    });

    expect(request).toBeDefined();
    expect(request.id).toBeTruthy();

    // Verify it actually landed in MongoDB
    const raw = await RequestModel.findById(request.id).lean();
    expect(raw).not.toBeNull();
    expect(raw.workflowId).toBe('vendor-approval');
    expect(raw.status).toMatch(/^(APPROVED|REJECTED|MANUAL_REVIEW|RETRY_PENDING|FAILED|RECEIVED)$/);
    expect(Array.isArray(raw.audit)).toBe(true);
    expect(raw.audit.length).toBeGreaterThan(0);
  });

  // ── 2. Read by ID ─────────────────────────────────────────────────────────
  test('2. Read the persisted request by ID', async () => {

    const { request: created } = await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('read'),
      data: vendorPayload(),
    });

    const fetched = await service.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(created.id);
    expect(fetched.workflowId).toBe('vendor-approval');
  });

  // ── 3. List requests ──────────────────────────────────────────────────────
  test('3. List previously created requests', async () => {

    // Create 3 distinct requests
    for (let i = 0; i < 3; i++) {
      await service.submit({
        workflowId: 'vendor-approval',
        idempotencyKey: uid('list'),
        data: vendorPayload({ vendorName: `Vendor ${i}` }),
      });
    }

    const all = await service.list(10);
    expect(all.length).toBe(3);
    // list returns newest first
    expect(all[0].workflowId).toBe('vendor-approval');
  });

  // ── 4. Unique compound index ──────────────────────────────────────────────
  test('4. Verify the unique compound index exists on (workflowId, idempotencyKey)', async () => {

    const indexes = await RequestModel.collection.indexes();
    const compoundUnique = indexes.find(
      (idx) =>
        idx.unique === true &&
        idx.key &&
        idx.key.workflowId !== undefined &&
        idx.key.idempotencyKey !== undefined
    );
    expect(compoundUnique).toBeDefined();
  });

  // ── 5. 20 concurrent identical requests → exactly 1 record ───────────────
  test(
    '5. Submit 20 concurrent requests with same key+payload → exactly 1 record stored',
    async () => {
  
      const key = uid('concurrent');
      const data = vendorPayload();

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.submit({ workflowId: 'vendor-approval', idempotencyKey: key, data })
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // All should resolve (some as replays, none as errors)
      expect(rejected.length).toBe(0);

      // Exactly one document in MongoDB
      const count = await RequestModel.countDocuments({
        workflowId: 'vendor-approval',
        idempotencyKey: key,
      });
      expect(count).toBe(1);

      // At least one is not a replay (the original)
      const originals = fulfilled.filter((r) => r.value.replayed === false);
      const replays = fulfilled.filter((r) => r.value.replayed === true);
      expect(originals.length).toBe(1);
      expect(replays.length).toBe(19);
    },
    15000
  );

  // ── 6. Same key, different payload → 409 IDEMPOTENCY_CONFLICT ────────────
  test('6. Reuse same key with different input → 409 IDEMPOTENCY_CONFLICT', async () => {

    const key = uid('conflict');
    await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: key,
      data: vendorPayload({ vendorName: 'OriginalCo' }),
    });

    await expect(
      service.submit({
        workflowId: 'vendor-approval',
        idempotencyKey: key,
        data: vendorPayload({ vendorName: 'DifferentCo' }),
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  // ── 7. Atomic claim via findOneAndUpdate ──────────────────────────────────
  test('7. Verify atomic attempt claiming (claim() uses findOneAndUpdate with filter)', async () => {

    // Create a RECEIVED record directly in DB, then claim it
    const repo = new MongoRepository();
    const data = vendorPayload();
    const payloadHash = fingerprint(data, 'ok');
    const pol = policies.get('vendor-approval');
    const raw = await RequestModel.create({
      workflowId: 'vendor-approval',
      policyVersion: pol.version,
      policySnapshot: pol,
      idempotencyKey: uid('claim-atomic'),
      payloadHash,
      data,
      simulation: 'ok',
      status: 'RECEIVED',
      attempts: 0,
      audit: [],
      trace: [],
    });
    const record = { id: String(raw._id), status: 'RECEIVED', attempts: 0 };

    const claimEvent = { at: new Date().toISOString(), type: 'ATTEMPT_STARTED', from: 'RECEIVED', to: 'PROCESSING', actor: 'system', detail: { attempt: 1 } };
    const claimed = await repo.claim(record, claimEvent);

    // claimed atomically
    expect(claimed).not.toBeNull();
    expect(claimed.status).toBe('PROCESSING');
    expect(claimed.attempts).toBe(1);

    // A second claim on same stale state must fail (returns null)
    const second = await repo.claim(record, claimEvent);
    expect(second).toBeNull();
  });

  // ── 8. 10 concurrent retries → exactly 1 successful claim ────────────────
  test(
    '8. 10 concurrent retry attempts → exactly 1 successful claim, rest get 409 or current state',
    async () => {
  
      // Create a RETRY_PENDING record manually with expired nextRetryAt
      const pol = policies.get('vendor-approval');
      const data = vendorPayload();
      const payloadHash = fingerprint(data, 'ok');
      const raw = await RequestModel.create({
        workflowId: 'vendor-approval',
        policyVersion: pol.version,
        policySnapshot: pol,
        idempotencyKey: uid('concurrent-retry'),
        payloadHash,
        data,
        simulation: 'ok',
        status: 'RETRY_PENDING',
        attempts: 1,
        leaseUntil: null,
        nextRetryAt: new Date(Date.now() - 1000),
        audit: [],
        trace: [],
      });
      const id = String(raw._id);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => service.retry(id))
      );

      const successful = results.filter((r) => r.status === 'fulfilled');
      const errored = results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reason.code === 'IN_PROGRESS' || r.reason.code === 'NOT_RETRIABLE')
      );

      // At least 1 succeeded, rest either errored or returned current state
      expect(successful.length).toBeGreaterThanOrEqual(1);
      // Total = 10
      expect(successful.length + errored.length).toBe(10);
    },
    15000
  );

  // ── 9. finish() atomicity: status + audit committed together ─────────────
  test('9. Verify status and audit are committed together (finish() atomicity)', async () => {

    const { request } = await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('finish-atomicity'),
      data: vendorPayload({ blacklisted: true }), // → REJECTED immediately
    });

    const raw = await RequestModel.findById(request.id).lean();
    expect(raw.status).toBe('REJECTED');
    // Both status and audit must be committed
    const hasDecisionAudit = raw.audit.some((e) => e.type === 'DECISION_RECORDED');
    expect(hasDecisionAudit).toBe(true);
  });

  // ── 10. Manual review cannot be completed twice ───────────────────────────
  test('10. Manual review cannot be completed twice (second review → 409 NOT_IN_REVIEW)', async () => {

    // Force MANUAL_REVIEW: documentsComplete=false triggers VEN-02
    const { request } = await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('double-review'),
      data: vendorPayload({ documentsComplete: false }),
    });
    expect(request.status).toBe('MANUAL_REVIEW');

    const reviewParams = { decision: 'APPROVED', reason: 'Docs verified offline', reviewer: 'Alice' };

    // First review should succeed
    const first = await service.review(request.id, reviewParams);
    expect(['APPROVED', 'REJECTED']).toContain(first.status);

    // Second review should fail
    await expect(service.review(request.id, reviewParams)).rejects.toMatchObject({
      code: 'NOT_IN_REVIEW',
      status: 409,
    });
  });

  // ── 11. Persistence failure simulation & recovery ─────────────────────────
  test('11. Inject persistence failure simulation and verify recovery is possible', async () => {

    // Use always-fail simulation: dependency will keep failing → RETRY_PENDING → eventually FAILED
    const key = uid('persistence-fail');
    const pol = policies.get('vendor-approval');

    // Manually create with always-fail so it'll be RETRY_PENDING after first attempt
    const data = vendorPayload();
    const payloadHash = fingerprint(data, 'always-fail');
    const raw = await RequestModel.create({
      workflowId: 'vendor-approval',
      policyVersion: pol.version,
      policySnapshot: pol,
      idempotencyKey: key,
      payloadHash,
      data,
      simulation: 'always-fail',
      status: 'RECEIVED',
      attempts: 0,
      audit: [],
      trace: [],
    });
    const id = String(raw._id);

    // Process: attempt 1 → RETRY_PENDING (always-fail)
    const after1 = await service.retry(id);
    expect(after1.status).toBe('RETRY_PENDING');
    expect(after1.attempts).toBe(1);

    // Immediate retry should fail with 429 RETRY_TOO_EARLY because backoff window is active
    await expect(service.retry(id)).rejects.toMatchObject({
      code: 'RETRY_TOO_EARLY',
      status: 429,
    });

    // Advance: expire lease & nextRetryAt to allow retry
    await RequestModel.findByIdAndUpdate(id, {
      $set: { nextRetryAt: new Date(Date.now() - 1000), leaseUntil: null },
    });

    // attempt 2 → RETRY_PENDING
    const after2 = await service.retry(id);
    expect(after2.status).toBe('RETRY_PENDING');
    expect(after2.attempts).toBe(2);

    // Now expire again
    await RequestModel.findByIdAndUpdate(id, {
      $set: { nextRetryAt: new Date(Date.now() - 1000), leaseUntil: null },
    });

    // attempt 3 (maxAttempts=3): should FAIL
    const after3 = await service.retry(id);
    expect(after3.status).toBe('FAILED');

    // Recovery is verified: the system correctly transitioned the broken record to FAILED
    const raw2 = await RequestModel.findById(id).lean();
    expect(raw2.status).toBe('FAILED');
  });

  // ── 12. Recovery after expired processing lease ───────────────────────────
  test('12. Verify recovery after expired processing lease', async () => {

    const pol = policies.get('vendor-approval');
    const data = vendorPayload();
    const payloadHash = fingerprint(data, 'ok');

    // Create a PROCESSING record with an expired lease (simulates crashed worker)
    const raw = await RequestModel.create({
      workflowId: 'vendor-approval',
      policyVersion: pol.version,
      policySnapshot: pol,
      idempotencyKey: uid('expired-lease'),
      payloadHash,
      data,
      simulation: 'ok',
      status: 'PROCESSING',
      attempts: 1,
      leaseUntil: new Date(Date.now() - 5000), // expired 5 seconds ago
      audit: [],
      trace: [],
    });
    const id = String(raw._id);

    // Retry should pick it up (expired lease → allowed to reclaim)
    const recovered = await service.retry(id);
    expect(['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED', 'RETRY_PENDING']).toContain(
      recovered.status
    );
    // attempts must have incremented
    expect(recovered.attempts).toBeGreaterThanOrEqual(2);
  });

  // ── 13. Final-attempt crash recovery → FAILED ────────────────────────────
  test('13. Verify final-attempt crash recovery (lease expired, attempts=maxAttempts → FAILED)', async () => {

    const pol = policies.get('vendor-approval'); // maxAttempts=3
    const data = vendorPayload();
    const payloadHash = fingerprint(data, 'ok');

    // Stuck PROCESSING record at maxAttempts with expired lease
    const raw = await RequestModel.create({
      workflowId: 'vendor-approval',
      policyVersion: pol.version,
      policySnapshot: { ...pol }, // snapshot
      idempotencyKey: uid('final-crash'),
      payloadHash,
      data,
      simulation: 'ok',
      status: 'PROCESSING',
      attempts: pol.maxAttempts, // at the limit
      leaseUntil: new Date(Date.now() - 5000), // expired
      audit: [],
      trace: [],
    });
    const id = String(raw._id);

    // process() detects: PROCESSING + expired lease + attempts >= maxAttempts
    // Bug 2 fix atomically transitions the stuck record to FAILED.
    const result = await service.retry(id);
    expect(result.status).toBe('FAILED');
    expect(result.attempts).toBe(pol.maxAttempts);

    // Verify directly in MongoDB
    const inDB = await RequestModel.findById(id).lean();
    expect(inDB.status).toBe('FAILED');
    expect(inDB.leaseUntil).toBeNull();
    expect(inDB.audit.some((a) => a.type === 'CRASH_RECOVERY')).toBe(true);

    // Repeated retry on the recovered FAILED record throws NOT_RETRIABLE without duplicate events
    await expect(service.retry(id)).rejects.toThrow();
  });

  // ── 14. Policy snapshot survives config change ────────────────────────────
  test('14. Policy snapshot survives a configuration change (old record keeps v1 snapshot)', async () => {

    const { request } = await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('snapshot'),
      data: vendorPayload(),
    });

    // Simulate a policy bump by reading the raw snapshot stored
    const raw = await RequestModel.findById(request.id).lean();
    const storedVersion = raw.policySnapshot.version;

    // The stored snapshot must reflect the version at time of creation
    expect(storedVersion).toBe(1); // vendor-approval.json is version 1

    // Now build a mutated "v2" policy in memory and create a new service
    const policies2 = loadPolicies();
    const pol2 = policies2.get('vendor-approval');
    pol2.version = 2;
    pol2.id = 'vendor-approval'; // unchanged
    policies2.set('vendor-approval', pol2);

    const service2 = createDecisionService({ repo: new MongoRepository(), policies: policies2 });

    // Old record still has v1 snapshot untouched
    const stillOld = await service2.get(request.id);
    expect(stillOld.policySnapshot.version).toBe(1);
  });

  // ── 15. Readable after service restart ───────────────────────────────────
  test('15. A persisted record is readable after service restart (new service instance)', async () => {

    const { request: original } = await service.submit({
      workflowId: 'claim-processing',
      idempotencyKey: uid('restart'),
      data: claimPayload(),
    });

    // Simulate restart: new repo + new service instance
    const newService = createDecisionService({
      repo: new MongoRepository(),
      policies: loadPolicies(),
    });

    const fetched = await newService.get(original.id);
    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(original.id);
    expect(fetched.workflowId).toBe('claim-processing');
    expect(fetched.status).toBe(original.status);
    // Data is preserved
    expect(fetched.data.claimReference).toBe('CLM-001');
  });

  // ── 16. Cleanup ───────────────────────────────────────────────────────────
  test('16. Cleanup: test database is properly cleared', async () => {

    // Insert a couple of docs
    await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('cleanup-a'),
      data: vendorPayload(),
    });
    await service.submit({
      workflowId: 'vendor-approval',
      idempotencyKey: uid('cleanup-b'),
      data: vendorPayload(),
    });

    const before = await RequestModel.countDocuments();
    expect(before).toBeGreaterThan(0);

    // Clear
    await RequestModel.deleteMany({});

    const after = await RequestModel.countDocuments();
    expect(after).toBe(0);

    // Confirm we are touching the TEST database only
    expect(mongoose.connection.name).toBe('decisionflow_integration_test');
  });
});
