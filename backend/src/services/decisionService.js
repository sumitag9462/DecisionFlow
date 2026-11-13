const crypto = require('node:crypto');
const { AppError } = require('../domain/errors');
const { validateData, validatePolicy } = require('../domain/validation');
const { runWorkflow, simulatedVerification } = require('../domain/engine');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(data, simulation) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({ data, simulation }))).digest('hex');
}

function computeEventHash(prevHash, at, type, from, to, actor, detail) {
  const content = `${prevHash}:${at}:${type}:${from || 'null'}:${to}:${actor}:${JSON.stringify(stable(detail))}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

function audit(type, from, to, detail = {}, actor = 'system', prevHash = null) {
  const at = new Date().toISOString();
  const prior = prevHash || GENESIS_HASH;
  const hash = computeEventHash(prior, at, type, from, to, actor, detail);
  return { at, type, from, to, actor, detail, prevHash: prior, hash };
}

function verifyAuditChain(record) {
  if (!record || !Array.isArray(record.audit) || !record.audit.length) {
    return { status: 'EMPTY', valid: true, count: 0, headHash: null };
  }

  // Check if this record completely lacks cryptographic hashes (legacy records)
  const hasAnyHash = record.audit.some(event => event && (event.hash || event.prevHash));
  if (!hasAnyHash) {
    return {
      status: 'UNVERIFIABLE_LEGACY',
      valid: false,
      count: record.audit.length,
      headHash: null,
      reason: 'Record predates cryptographic audit hash chaining'
    };
  }

  const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

  for (let i = 0; i < record.audit.length; i++) {
    const event = record.audit[i];
    if (!event || typeof event !== 'object') {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: 'Invalid audit event structure' };
    }

    if (!event.hash || typeof event.hash !== 'string' || !HEX_64_REGEX.test(event.hash) ||
        !event.prevHash || typeof event.prevHash !== 'string' || !HEX_64_REGEX.test(event.prevHash)) {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: 'Missing or malformed hash in audit event' };
    }

    const expectedPrev = i === 0 ? GENESIS_HASH : record.audit[i - 1]?.hash;
    if (event.prevHash !== expectedPrev) {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: i === 0 ? 'Genesis previous hash mismatch' : 'Previous hash mismatch' };
    }

    if (!event.at || isNaN(new Date(event.at).getTime())) {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: 'Invalid audit event timestamp' };
    }

    if (i > 0 && new Date(event.at).getTime() < new Date(record.audit[i - 1].at).getTime()) {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: 'Non-chronological audit timestamp' };
    }

    const calculated = computeEventHash(event.prevHash, event.at, event.type, event.from, event.to, event.actor, event.detail);
    if (calculated !== event.hash) {
      return { status: 'INVALID', valid: false, brokenAtIndex: i, count: record.audit.length, reason: 'Tampered event payload detected' };
    }
  }

  const head = record.audit[record.audit.length - 1];
  return { status: 'VERIFIED', valid: true, count: record.audit.length, headHash: head.hash };
}

function createDecisionService({ repo, policies, verify = simulatedVerification }) {
  function getPolicy(id) {
    const policy = policies.get(id);
    if (!policy) throw new AppError(404, 'WORKFLOW_NOT_FOUND', `Unknown workflow: ${id}`);
    return policy;
  }

  async function process(id, { explicitRetry = false } = {}) {
    const current = await repo.get(id);
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    if (!['RECEIVED', 'RETRY_PENDING', 'PROCESSING'].includes(current.status)) {
      if (explicitRetry) throw new AppError(409, 'NOT_RETRIABLE', `Cannot retry a ${current.status} request`);
      return current;
    }
    if (current.status === 'PROCESSING' && new Date(current.leaseUntil) > new Date()) {
      if (explicitRetry) throw new AppError(409, 'IN_PROGRESS', 'Request is already being processed');
      return current;
    }
    if (current.status === 'RETRY_PENDING' && current.nextRetryAt && new Date(current.nextRetryAt) > new Date()) {
      if (explicitRetry) {
        const remainingMs = Math.max(0, new Date(current.nextRetryAt).getTime() - Date.now());
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        throw new AppError(
          429,
          'RETRY_TOO_EARLY',
          `Retry is not eligible until ${current.nextRetryAt} (${remainingSeconds}s remaining)`,
          [{ nextRetryAt: current.nextRetryAt, retryAfterSeconds: remainingSeconds }]
        );
      }
      return current;
    }
    // Bug 2 fix: If the worker crashed on the final allowed attempt and the lease
    // has since expired, the record would be stuck in PROCESSING forever because
    // the attempts >= maxAttempts guard below would throw before we can recover.
    // Detect this case and atomically transition to FAILED.
    if (current.status === 'PROCESSING' &&
        new Date(current.leaseUntil) <= new Date() &&
        current.attempts >= current.policySnapshot.maxAttempts) {
      const lastAudit = current.audit?.[current.audit.length - 1];
      const recoveryEvent = audit('CRASH_RECOVERY', 'PROCESSING', 'FAILED',
        { attempt: current.attempts, reason: 'Worker crashed on final attempt; lease expired without a result.' },
        explicitRetry ? 'operator' : 'system',
        lastAudit?.hash);
      const failed = await repo.forceFailExpiredFinal(current, recoveryEvent);
      if (!failed) throw new AppError(409, 'STATE_CHANGED', 'State changed during crash recovery');
      return failed;
    }
    if (current.attempts >= current.policySnapshot.maxAttempts) {
      throw new AppError(409, 'RETRY_LIMIT', 'Maximum attempts reached');
    }

    // Atomic compare-and-set: two concurrent retries cannot both claim the same request.
    const lastAudit = current.audit?.[current.audit.length - 1];
    const claimed = await repo.claim(current, audit('ATTEMPT_STARTED', current.status, 'PROCESSING',
      { attempt: current.attempts + 1, recoveredLease: current.status === 'PROCESSING' }, 'system', lastAudit?.hash));
    if (!claimed) {
      if (explicitRetry) throw new AppError(409, 'IN_PROGRESS', 'Another worker claimed this request');
      return repo.get(id);
    }

    const result = await runWorkflow({
      policy: claimed.policySnapshot, data: claimed.data,
      simulation: claimed.simulation, attempt: claimed.attempts, verify
    });
    const nextRetryAt = result.retryDelayMs ? new Date(Date.now() + result.retryDelayMs).toISOString() : null;
    const postClaimAudit = claimed.audit?.[claimed.audit.length - 1];
    const outcome = await repo.finish(claimed, {
      status: result.status, reason: result.reason, matchedRule: result.matchedRule,
      nextRetryAt, trace: result.trace,
      event: audit('DECISION_RECORDED', 'PROCESSING', result.status, {
        attempt: claimed.attempts, reason: result.reason, matchedRule: result.matchedRule,
        nextRetryAt
      }, 'system', postClaimAudit?.hash)
    });
    if (!outcome) throw new AppError(409, 'STATE_CHANGED', 'State changed while saving the result');
    return outcome;
  }

  async function submit({ workflowId, idempotencyKey, data, simulation = 'ok' }) {
    const policy = getPolicy(workflowId);
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 6 || idempotencyKey.length > 120) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Provide an idempotency key (6–120 characters)');
    }
    if (!['ok', 'fail-once', 'always-fail'].includes(simulation)) {
      throw new AppError(400, 'INVALID_SIMULATION', 'Invalid dependency simulation mode');
    }
    const normalizedKey = idempotencyKey.trim();
    const payloadHash = fingerprint(data, simulation);

    // Bug 1 fix: Check for an existing idempotency record BEFORE running
    // validateData against the CURRENT policy.  A replay of an older payload
    // that was valid under a previous policy version must succeed even when the
    // current policy has added new required fields that the original payload
    // doesn't satisfy.
    const preCheck = await repo.findByKey(workflowId, normalizedKey);
    if (preCheck) {
      if (preCheck.payloadHash !== payloadHash) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different request data');
      }
      return { request: preCheck, replayed: true };
    }

    // Only validate against the current policy for genuinely new requests.
    validateData(policy, data);
    const original = {
      workflowId, policyVersion: policy.version, policySnapshot: JSON.parse(JSON.stringify(policy)),
      idempotencyKey: normalizedKey, payloadHash, data, simulation,
      status: 'RECEIVED', attempts: 0, trace: [], decision: null,
      leaseUntil: null, nextRetryAt: null,
      audit: [audit('REQUEST_RECEIVED', null, 'RECEIVED', { policyVersion: policy.version }, 'api', GENESIS_HASH)]
    };
    let created;
    try {
      created = await repo.create(original);
    } catch (err) {
      if (err.code !== 11000) throw err;
      const existing = await repo.findByKey(workflowId, normalizedKey);
      if (!existing) throw new AppError(503, 'REPLAY_PENDING', 'Original request is still being saved. Retry shortly.');
      if (existing.payloadHash !== payloadHash) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different request data');
      }
      return { request: existing, replayed: true };
    }
    return { request: await process(created.id), replayed: false };
  }

  async function retry(id) {
    return process(id, { explicitRetry: true });
  }

  async function review(id, { decision, reason, reviewer }) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw new AppError(400, 'INVALID_DECISION', 'Review decision must be APPROVED or REJECTED');
    }
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) {
      throw new AppError(400, 'INVALID_REASON', 'Give a reason of 5–500 characters');
    }
    if (typeof reviewer !== 'string' || reviewer.trim().length < 2 || reviewer.length > 80) {
      throw new AppError(400, 'INVALID_REVIEWER', 'Reviewer name is required');
    }
    const current = await repo.get(id);
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    if (current.status !== 'MANUAL_REVIEW') {
      throw new AppError(409, 'NOT_IN_REVIEW', `Request is ${current.status}, not MANUAL_REVIEW`);
    }

    const lastAudit = current.audit?.[current.audit.length - 1];
    const event = audit('MANUAL_REVIEW_COMPLETED', 'MANUAL_REVIEW', decision,
      { reason: reason.trim() }, reviewer.trim(), lastAudit?.hash);

    const updated = await repo.review(id, {
      decision, reason: reason.trim(),
      event
    });
    if (!updated) {
      throw new AppError(409, 'STATE_CHANGED', 'Request state changed while applying review decision');
    }
    return updated;
  }

  // Standout Feature 2: What-If Policy Simulation (Non-destructive)
  async function simulate({ workflowId, data, proposedThresholds = {}, simulation = 'ok' }) {
    const policy = getPolicy(workflowId);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new AppError(400, 'INVALID_INPUT', 'data must be a JSON object');
    }
    if (!proposedThresholds || typeof proposedThresholds !== 'object' || Array.isArray(proposedThresholds)) {
      throw new AppError(400, 'INVALID_INPUT', 'proposedThresholds must be a JSON object');
    }

    // Prototype pollution & injection defense
    if (Object.hasOwn(proposedThresholds, '__proto__') ||
        Object.hasOwn(proposedThresholds, 'constructor') ||
        Object.hasOwn(proposedThresholds, 'prototype')) {
      throw new AppError(400, 'INVALID_INPUT', 'Forbidden property in thresholds');
    }
    for (const key of Object.getOwnPropertyNames(proposedThresholds)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new AppError(400, 'INVALID_INPUT', 'Forbidden property in thresholds');
      }
    }

    // 1. Baseline run on active policy
    validateData(policy, data);
    const baseline = await runWorkflow({
      policy, data, simulation, attempt: 1, verify
    });

    // 2. Clone policy and apply proposed overrides
    const clonedPolicy = JSON.parse(JSON.stringify(policy));
    const appliedOverrides = [];

    // Index all rules by id and field
    const ruleById = new Map();
    const ruleByField = new Map();
    for (const stage of clonedPolicy.stages) {
      if (stage.type === 'rules' && Array.isArray(stage.rules)) {
        for (const rule of stage.rules) {
          ruleById.set(rule.id, rule);
          ruleByField.set(rule.field, rule);
        }
      }
    }

    for (const [key, newVal] of Object.entries(proposedThresholds)) {
      const targetRule = ruleById.get(key) || ruleByField.get(key);
      if (!targetRule) {
        throw new AppError(400, 'INVALID_OVERRIDE', `Unknown rule or threshold key: ${key}`);
      }
      const fieldSchema = clonedPolicy.fields[targetRule.field];
      const expectedType = fieldSchema ? fieldSchema.type : typeof targetRule.value;

      if (targetRule.operator === 'in') {
        if (!Array.isArray(newVal) || !newVal.every(x => typeof x === expectedType)) {
          throw new AppError(400, 'INVALID_OVERRIDE', `Threshold for ${key} must be an array of ${expectedType} values`);
        }
      } else if (expectedType === 'number') {
        if (typeof newVal !== 'number' || !Number.isFinite(newVal)) {
          throw new AppError(400, 'INVALID_OVERRIDE', `Threshold for ${key} must be a finite number`);
        }
      } else if (expectedType === 'boolean') {
        if (typeof newVal !== 'boolean') {
          throw new AppError(400, 'INVALID_OVERRIDE', `Threshold for ${key} must be a boolean`);
        }
      } else if (typeof newVal !== 'string') {
        throw new AppError(400, 'INVALID_OVERRIDE', `Threshold for ${key} must be a string`);
      }

      const oldVal = targetRule.value;
      targetRule.value = newVal;
      appliedOverrides.push({
        ruleId: targetRule.id,
        field: targetRule.field,
        oldThreshold: oldVal,
        newThreshold: newVal
      });
    }

    // Validate the modified policy structure
    validatePolicy(clonedPolicy);

    // 3. Simulated run on modified policy
    const simulated = await runWorkflow({
      policy: clonedPolicy, data, simulation, attempt: 1, verify
    });

    return {
      simulated: true,
      workflowId,
      baseline: {
        policyVersion: policy.version,
        status: baseline.status,
        reason: baseline.reason,
        matchedRule: baseline.matchedRule,
        trace: baseline.trace
      },
      simulation: {
        policyVersion: clonedPolicy.version,
        appliedOverrides,
        status: simulated.status,
        reason: simulated.reason,
        matchedRule: simulated.matchedRule,
        trace: simulated.trace
      },
      diff: {
        outcomeChanged: baseline.status !== simulated.status,
        originalOutcome: baseline.status,
        simulatedOutcome: simulated.status,
        summary: baseline.status !== simulated.status
          ? `Outcome shifted from ${baseline.status} to ${simulated.status} under proposed policy.`
          : `Outcome remained unchanged (${baseline.status}) under proposed policy.`
      }
    };
  }

  // Standout Feature 1: Exportable Certified Decision Evidence
  async function getEvidence(id) {
    const record = await repo.get(id);
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    const auditCheck = verifyAuditChain(record);
    return {
      certifiedAt: new Date().toISOString(),
      certificateId: `EVID-${record.id}-${Date.now().toString(36).toUpperCase()}`,
      issuer: 'DecisionFlow Enterprise Engine v2.0 (ScoreMe)',
      integrity: {
        payloadFingerprint: record.payloadHash,
        auditChainIntact: auditCheck.valid,
        auditEventCount: record.audit.length,
        headAuditHash: auditCheck.headHash || null
      },
      decision: {
        id: record.id,
        workflowId: record.workflowId,
        policyVersion: record.policyVersion,
        status: record.status,
        reason: record.reason,
        matchedRule: record.matchedRule,
        attempts: record.attempts,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      },
      evaluatedData: record.data,
      policySnapshot: record.policySnapshot,
      ruleTrace: record.trace,
      auditHistory: record.audit
    };
  }

  async function getMetrics() {
    if (typeof repo.getMetrics === 'function') {
      return repo.getMetrics();
    }
    return { total: 0, uptimeSeconds: Math.floor(process.uptime()) };
  }

  return {
    submit, retry, review, process, getPolicy, simulate, getEvidence, getMetrics, verifyAuditChain,
    listPolicies: () => [...policies.values()],
    get: id => repo.get(id),
    list: options => repo.list(options),
    count: filter => repo.count ? repo.count(filter) : Promise.resolve(0)
  };
}

module.exports = { createDecisionService, fingerprint, verifyAuditChain, computeEventHash, GENESIS_HASH };
