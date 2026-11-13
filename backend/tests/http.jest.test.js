const request = require('supertest');
const { createApp } = require('../src/http/createApp');
const { createDecisionService } = require('../src/services/decisionService');
const { loadPolicies } = require('../src/config/loadPolicies');
const { createToken, DEMO_USERS } = require('../src/auth/authService');
const { FakeRepository } = require('./FakeRepository');

const adminToken = createToken(DEMO_USERS[0]);
const reviewerToken = createToken(DEMO_USERS[1]);
const viewerToken = createToken(DEMO_USERS[2]);

const vendor = {
  vendorName: 'Northwind Supplies', annualSpend: 150000, riskScore: 19,
  blacklisted: false, documentsComplete: true
};

function fixture() {
  const repo = new FakeRepository();
  const service = createDecisionService({ repo, policies: loadPolicies() });
  return { repo, app: createApp(service) };
}

test('health and workflow metadata are publicly readable without auth', async () => {
  const { app } = fixture();
  const health = await request(app).get('/api/health');
  expect(health.status).toBe(200);
  expect(health.body.status).toBe('ok');
  const config = await request(app).get('/api/workflows');
  expect(config.body).toHaveLength(2);
});

test('unauthenticated access to protected routes returns 401 UNAUTHORIZED', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/requests');
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('UNAUTHORIZED');

  const metricRes = await request(app).get('/api/metrics');
  expect(metricRes.status).toBe(401);

  const simRes = await request(app).post('/api/simulate').send({
    workflowId: 'vendor-approval',
    data: vendor
  });
  expect(simRes.status).toBe(401);
});

test('invalid or expired token returns 401', async () => {
  const { app } = fixture();
  const badTokenRes = await request(app).get('/api/requests')
    .set('Authorization', 'Bearer invalid.token.value');
  expect(badTokenRes.status).toBe(401);

  const expiredToken = createToken(DEMO_USERS[0], -60); // expired 60s ago
  const expiredRes = await request(app).get('/api/requests')
    .set('Authorization', `Bearer ${expiredToken}`);
  expect(expiredRes.status).toBe(401);
  expect(expiredRes.body.error).toBe('TOKEN_EXPIRED');
});

test('submits a request and returns a detailed trace', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', 'http-vendor-123')
    .send({ workflowId: 'vendor-approval', data: vendor });
  expect(res.status).toBe(201);
  expect(res.body.replayed).toBe(false);
  expect(res.body.request.status).toBe('APPROVED');
  expect(res.body.request.trace.some(t => t.ruleId === 'VEN-04')).toBe(true);
  const fetched = await request(app).get(`/api/requests/${res.body.request.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(fetched.status).toBe(200);
  expect(fetched.body.audit).toHaveLength(3);
});

test('replaying the same idempotency key returns 200, not a second decision', async () => {
  const { app, repo } = fixture();
  const body = { workflowId: 'vendor-approval', idempotencyKey: 'http-duplicate-123', data: vendor };
  const first = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  const second = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  expect(first.status).toBe(201);
  expect(second.status).toBe(200);
  expect(second.body.replayed).toBe(true);
  expect(repo.rows.size).toBe(1);
});

test('same key with changed input returns a conflict', async () => {
  const { app } = fixture();
  const body = { workflowId: 'vendor-approval', idempotencyKey: 'http-conflict-123', data: vendor };
  await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...body, data: { ...vendor, riskScore: 35 } });
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('IDEMPOTENCY_CONFLICT');
});

test('invalid input returns structured field errors', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval', idempotencyKey: 'http-invalid-123', data: { ...vendor, annualSpend: -5 }
    });
  expect(res.status).toBe(400);
  expect(res.body.details[0]).toMatch(/annualSpend/);
});

test('transient external failure can be retried through REST', async () => {
  const { app, repo } = fixture();
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ workflowId: 'vendor-approval', idempotencyKey: 'http-retry-123', data: vendor, simulation: 'fail-once' });
  expect(res.body.request.status).toBe('RETRY_PENDING');

  // Premature retry before backoff window expires returns 429
  const early = await request(app).post(`/api/requests/${res.body.request.id}/retry`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(early.status).toBe(429);
  expect(early.body.error).toBe('RETRY_TOO_EARLY');

  // Expire backoff to simulate waiting until nextRetryAt
  repo.expireBackoff(res.body.request.id);
  const retried = await request(app).post(`/api/requests/${res.body.request.id}/retry`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(retried.status).toBe(200);
  expect(retried.body.status).toBe('APPROVED');
  expect(retried.body.attempts).toBe(2);
});

test('manual reviewer decision leaves an audit event', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ workflowId: 'vendor-approval', idempotencyKey: 'http-review-123', data: { ...vendor, documentsComplete: false } });

  // Unauthenticated review attempt returns 401
  const unauth = await request(app).post(`/api/requests/${res.body.request.id}/review`)
    .send({ decision: 'REJECTED', reason: 'Documents still missing' });
  expect(unauth.status).toBe(401);

  // Authenticate as reviewer via login endpoint
  const loginRes = await request(app).post('/api/auth/login').send({
    email: 'reviewer@decisionflow.io',
    password: 'Reviewer@123'
  });
  const token = loginRes.body.token;

  const review = await request(app).post(`/api/requests/${res.body.request.id}/review`)
    .set('Authorization', `Bearer ${token}`)
    .send({ decision: 'REJECTED', reason: 'Documents still missing' });
  expect(review.status).toBe(200);
  expect(review.body.status).toBe('REJECTED');
  expect(review.body.audit.at(-1).type).toBe('MANUAL_REVIEW_COMPLETED');
  expect(review.body.audit.at(-1).actor).toBe('Bob Reviewer');
});

test('bad request ID returns 400', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/requests/abc')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('INVALID_ID');
});

test('security headers and correlation ID are set on all responses', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['x-request-id']).toBeDefined();
});

test('auth endpoints allow demo login and retrieve current profile', async () => {
  const { app } = fixture();
  const loginRes = await request(app).post('/api/auth/login').send({
    email: 'admin@decisionflow.io',
    password: 'Admin@123'
  });
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.token).toBeDefined();
  expect(loginRes.body.user.role).toBe('ADMIN');

  const meRes = await request(app).get('/api/auth/me')
    .set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(meRes.status).toBe(200);
  expect(meRes.body.user.email).toBe('admin@decisionflow.io');
  expect(meRes.body.demoAccounts).toHaveLength(3);
});

test('RBAC rejects review by VIEWER role with 403 Forbidden', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval',
      idempotencyKey: 'http-rbac-review-123',
      data: { ...vendor, documentsComplete: false }
    });
  expect(res.status).toBe(201);

  // Authenticate as VIEWER
  const viewerLogin = await request(app).post('/api/auth/login').send({
    email: 'viewer@decisionflow.io',
    password: 'Viewer@123'
  });
  expect(viewerLogin.status).toBe(200);

  // Attempt review as VIEWER using Bearer token -> 403
  const review = await request(app).post(`/api/requests/${res.body.request.id}/review`)
    .set('Authorization', `Bearer ${viewerLogin.body.token}`)
    .send({ decision: 'APPROVED', reason: 'Attempted viewer override' });
  expect(review.status).toBe(403);
  expect(review.body.error).toBe('FORBIDDEN');

  // Attempt retry as VIEWER -> 403
  const retryRes = await request(app).post(`/api/requests/${res.body.request.id}/retry`)
    .set('Authorization', `Bearer ${viewerLogin.body.token}`);
  expect(retryRes.status).toBe(403);
  expect(retryRes.body.error).toBe('FORBIDDEN');
});

test('what-if simulation rejects invalid threshold types with 400', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/simulate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval',
      data: vendor,
      proposedThresholds: { 'VEN-04': 'invalid-string' }
    });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('INVALID_OVERRIDE');
});

test('metrics endpoint aggregates operational numbers', async () => {
  const { app } = fixture();
  await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval',
      idempotencyKey: 'http-metric-001',
      data: vendor
    });
  const res = await request(app).get('/api/metrics')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  expect(res.body.approved).toBe(1);
});

test('what-if simulation endpoint returns comparison without mutating data', async () => {
  const { app, repo } = fixture();
  const initialCount = repo.rows.size;

  const res = await request(app).post('/api/simulate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval',
      data: vendor,
      proposedThresholds: { 'VEN-04': 50000 }
    });
  expect(res.status).toBe(200);
  expect(res.body.simulated).toBe(true);
  expect(res.body.baseline.status).toBe('APPROVED');
  expect(res.body.simulation.status).toBe('MANUAL_REVIEW');
  expect(repo.rows.size).toBe(initialCount);
});

test('evidence and audit verification endpoints produce certified payloads', async () => {
  const { app } = fixture();
  const created = await request(app).post('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      workflowId: 'vendor-approval',
      idempotencyKey: 'http-evidence-001',
      data: vendor
    });
  const id = created.body.request.id;

  const evidenceRes = await request(app).get(`/api/requests/${id}/evidence`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(evidenceRes.status).toBe(200);
  expect(evidenceRes.body.certificateId).toMatch(/^EVID-/);
  expect(evidenceRes.body.integrity.auditChainIntact).toBe(true);

  const verifyRes = await request(app).get(`/api/requests/${id}/verify-audit`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(verifyRes.status).toBe(200);
  expect(verifyRes.body.integrity.valid).toBe(true);
  expect(verifyRes.body.integrity.count).toBe(3);
});
