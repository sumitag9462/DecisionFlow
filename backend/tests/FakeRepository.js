// In-memory repository used only by tests. The application always persists to MongoDB.
function clone(value) { return structuredClone(value); }
class FakeRepository {
  constructor() {
    this.rows = new Map();
    this.keys = new Map();
    this.serial = 0;
    this.failNextFinish = false;
  }
  async create(input) {
    const key = `${input.workflowId}:${input.idempotencyKey}`;
    if (this.keys.has(key)) {
      const err = new Error('Duplicate idempotency key');
      err.code = 11000;
      throw err;
    }
    const id = (++this.serial).toString(16).padStart(24, '0');
    const now = new Date().toISOString();
    const row = { ...clone(input), id, createdAt: now, updatedAt: now };
    this.rows.set(id, row);
    this.keys.set(key, id);
    return clone(row);
  }
  async findByKey(workflowId, key) {
    const id = this.keys.get(`${workflowId}:${key}`);
    return id ? this.get(id) : null;
  }
  async get(id) { return this.rows.has(id) ? clone(this.rows.get(id)) : null; }
  async list(options = 25) {
    let limit = 25;
    let skip = 0;
    const filter = {};
    if (typeof options === 'number') {
      limit = Math.min(100, Math.max(1, Number(options) || 25));
    } else if (options && typeof options === 'object') {
      limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
      if (options.page) {
        const page = Math.max(1, Number(options.page) || 1);
        skip = (page - 1) * limit;
      } else if (options.skip) {
        skip = Math.max(0, Number(options.skip) || 0);
      }
      if (options.status) filter.status = options.status;
      if (options.workflowId) filter.workflowId = options.workflowId;
    }
    const all = Array.from(this.rows.values()).reverse().filter(row => {
      if (filter.status && row.status !== filter.status) return false;
      if (filter.workflowId && row.workflowId !== filter.workflowId) return false;
      return true;
    });
    return all.slice(skip, skip + limit).map(clone);
  }
  async count(filter = {}) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (filter.status && row.status !== filter.status) continue;
      if (filter.workflowId && row.workflowId !== filter.workflowId) continue;
      count++;
    }
    return count;
  }
  async getMetrics() {
    let approved = 0, rejected = 0, manualReview = 0, retryPending = 0, failed = 0, processing = 0, totalAttempts = 0;
    const workflows = {};
    for (const row of this.rows.values()) {
      if (row.status === 'APPROVED') approved++;
      else if (row.status === 'REJECTED') rejected++;
      else if (row.status === 'MANUAL_REVIEW') manualReview++;
      else if (row.status === 'RETRY_PENDING') retryPending++;
      else if (row.status === 'FAILED') failed++;
      else if (row.status === 'PROCESSING') processing++;
      totalAttempts += (row.attempts || 0);
      workflows[row.workflowId] = (workflows[row.workflowId] || 0) + 1;
    }
    const total = this.rows.size;
    return {
      total, approved, rejected, manualReview, retryPending, failed, processing,
      avgAttempts: total ? Number((totalAttempts / total).toFixed(2)) : 0,
      workflows,
      uptimeSeconds: Math.floor(process.uptime())
    };
  }
  async claim(record, event) {
    const row = this.rows.get(record.id);
    if (!row || row.status !== record.status || row.attempts !== record.attempts) return null;
    if (row.status === 'PROCESSING' && new Date(row.leaseUntil) > new Date()) return null;
    if (row.status === 'RETRY_PENDING' && row.nextRetryAt && new Date(row.nextRetryAt) > new Date()) return null;
    row.status = 'PROCESSING';
    row.attempts += 1;
    row.leaseUntil = new Date(Date.now() + 90000).toISOString();
    row.nextRetryAt = null;
    row.audit.push(clone(event));
    row.updatedAt = new Date().toISOString();
    return clone(row);
  }
  async finish(record, result) {
    if (this.failNextFinish) {
      this.failNextFinish = false;
      throw new Error('Simulated MongoDB write interruption');
    }
    const row = this.rows.get(record.id);
    if (!row || row.status !== 'PROCESSING' || row.attempts !== record.attempts) return null;
    row.status = result.status;
    row.reason = result.reason;
    row.matchedRule = result.matchedRule;
    row.leaseUntil = null;
    row.nextRetryAt = result.nextRetryAt;
    row.trace.push(...clone(result.trace));
    row.audit.push(clone(result.event));
    row.updatedAt = new Date().toISOString();
    return clone(row);
  }
  async review(id, result) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'MANUAL_REVIEW') return null;
    row.status = result.decision;
    row.reason = result.reason;
    row.audit.push(clone(result.event));
    row.updatedAt = new Date().toISOString();
    return clone(row);
  }
  expireLease(id) {
    const row = this.rows.get(id);
    row.leaseUntil = new Date(0).toISOString();
  }
  expireBackoff(id) {
    const row = this.rows.get(id);
    if (row) row.nextRetryAt = new Date(0).toISOString();
  }
  async forceFailExpiredFinal(record, event) {
    const row = this.rows.get(record.id);
    if (!row || row.status !== 'PROCESSING' || row.attempts !== record.attempts) return null;
    if (new Date(row.leaseUntil) > new Date()) return null; // lease still active — guard
    row.status = 'FAILED';
    row.reason = 'Worker crashed on final attempt; lease expired without a result.';
    row.leaseUntil = null;
    row.audit.push(clone(event));
    row.updatedAt = new Date().toISOString();
    return clone(row);
  }
}
module.exports = { FakeRepository };
