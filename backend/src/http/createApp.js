const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const { AppError } = require('../domain/errors');
const { authenticate, login, requireRole, requireAuth, DEMO_USERS } = require('../auth/authService');

function createApp(service, { origin = 'http://localhost:5173' } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Security Headers & Request Correlation ID
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Request-ID');
    const reqId = req.get('X-Request-ID') || crypto.randomUUID();
    res.setHeader('X-Request-ID', reqId);
    req.id = reqId;
    next();
  });

  app.use(cors({ origin }));
  app.use(express.json({ limit: '64kb' }));
  app.use(authenticate);

  function route(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  }
  function assertId(id) {
    if (!/^[a-f\d]{24}$/i.test(id)) throw new AppError(400, 'INVALID_ID', 'Expected a MongoDB request ID');
  }

  // Health Check
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok',
    service: 'decisionflow',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));

  // Auth & RBAC Endpoints
  app.post('/api/auth/login', route(async (req, res) => {
    const { email, password } = req.body || {};
    const result = login(email, password);
    res.json(result);
  }));

  app.get('/api/auth/me', route(async (req, res) => {
    res.json({
      user: req.user || null,
      demoAccounts: DEMO_USERS.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role
      }))
    });
  }));

  // Metrics Aggregation
  app.get('/api/metrics', requireAuth, route(async (_req, res) => {
    const metrics = await service.getMetrics();
    res.json(metrics);
  }));

  // What-If Policy Simulation (Non-destructive)
  app.post('/api/simulate', requireAuth, route(async (req, res) => {
    const { workflowId, data, proposedThresholds, simulation } = req.body || {};
    const result = await service.simulate({ workflowId, data, proposedThresholds, simulation });
    res.json(result);
  }));

  // Workflow Definitions (Public schema discovery)
  app.get('/api/workflows', route(async (_req, res) => res.json(service.listPolicies())));
  app.get('/api/workflows/:id', route(async (req, res) => res.json(service.getPolicy(req.params.id))));

  // Request Management (Authenticated)
  app.get('/api/requests', requireAuth, route(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const page = Math.max(1, Number(req.query.page) || 1);
    const status = req.query.status || undefined;
    const workflowId = req.query.workflowId || undefined;

    const [items, total] = await Promise.all([
      service.list({ limit, page, status, workflowId }),
      service.count({ status, workflowId })
    ]);

    res.setHeader('X-Total-Count', String(total));

    if (req.query.paginated === 'true') {
      return res.json({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      });
    }
    // Return array directly for backward compatibility
    res.json(items);
  }));

  app.get('/api/requests/:id', requireAuth, route(async (req, res) => {
    assertId(req.params.id);
    const record = await service.get(req.params.id);
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    res.json(record);
  }));

  // Evidence Packet Export (Authenticated)
  app.get('/api/requests/:id/evidence', requireAuth, route(async (req, res) => {
    assertId(req.params.id);
    const evidence = await service.getEvidence(req.params.id);
    res.json(evidence);
  }));

  // Audit Integrity Chain Verification (Authenticated)
  app.get('/api/requests/:id/verify-audit', requireAuth, route(async (req, res) => {
    assertId(req.params.id);
    const record = await service.get(req.params.id);
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    const integrity = service.verifyAuditChain(record);
    res.json({ id: record.id, integrity });
  }));

  app.post('/api/requests', requireAuth, route(async (req, res) => {
    const body = req.body || {};
    const { request, replayed } = await service.submit({
      workflowId: body.workflowId,
      data: body.data,
      simulation: body.simulation,
      idempotencyKey: req.get('Idempotency-Key') || body.idempotencyKey
    });
    res.status(replayed ? 200 : 201).json({ replayed, request });
  }));

  app.post('/api/requests/:id/retry', requireRole('ADMIN', 'REVIEWER'), route(async (req, res) => {
    assertId(req.params.id);
    res.json(await service.retry(req.params.id));
  }));

  app.post('/api/requests/:id/review', requireRole('REVIEWER', 'ADMIN'), route(async (req, res) => {
    assertId(req.params.id);
    const reviewer = req.user.name;
    const decision = req.body?.decision;
    const reason = req.body?.reason;
    res.json(await service.review(req.params.id, { decision, reason, reviewer }));
  }));

  app.use((_req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'Endpoint not found')));

  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'BAD_JSON', message: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'BODY_TOO_LARGE', message: 'Request body exceeds the 64 KB limit' });
    }
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) console.error('[decisionflow]', err);
    return res.status(status).json({
      error: err instanceof AppError ? err.code : 'INTERNAL_ERROR',
      message: status >= 500 ? 'Unable to process the request. Check server logs.' : err.message,
      ...(err instanceof AppError && err.details ? { details: err.details } : {})
    });
  });

  return app;
}

module.exports = { createApp };
