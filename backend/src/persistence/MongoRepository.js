const RequestModel = require('./RequestModel');

function plain(value) {
  if (!value) return null;
  const row = value.toObject ? value.toObject() : value;
  const { _id, __v, ...rest } = row;
  return { id: String(_id), ...rest };
}

class MongoRepository {
  async create(input) {
    const row = await RequestModel.create(input);
    return plain(row);
  }

  async findByKey(workflowId, idempotencyKey) {
    return plain(await RequestModel.findOne({ workflowId, idempotencyKey }).lean());
  }

  async get(id) {
    return plain(await RequestModel.findById(id).lean());
  }

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
    const rows = await RequestModel.find(filter)
      .select('workflowId policyVersion status attempts reason idempotencyKey matchedRule createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    return rows.map(plain);
  }

  async count(options = {}) {
    const filter = {};
    if (options.status) filter.status = options.status;
    if (options.workflowId) filter.workflowId = options.workflowId;
    return RequestModel.countDocuments(filter);
  }

  async getMetrics() {
    const aggregate = await RequestModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
          manualReview: { $sum: { $cond: [{ $eq: ['$status', 'MANUAL_REVIEW'] }, 1, 0] } },
          retryPending: { $sum: { $cond: [{ $eq: ['$status', 'RETRY_PENDING'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ['$status', 'PROCESSING'] }, 1, 0] } },
          totalAttempts: { $sum: '$attempts' }
        }
      }
    ]);
    const summary = aggregate[0] || {
      total: 0, approved: 0, rejected: 0, manualReview: 0,
      retryPending: 0, failed: 0, processing: 0, totalAttempts: 0
    };
    const workflowBreakdown = await RequestModel.aggregate([
      { $group: { _id: '$workflowId', count: { $sum: 1 } } }
    ]);
    return {
      total: summary.total,
      approved: summary.approved,
      rejected: summary.rejected,
      manualReview: summary.manualReview,
      retryPending: summary.retryPending,
      failed: summary.failed,
      processing: summary.processing,
      avgAttempts: summary.total ? Number((summary.totalAttempts / summary.total).toFixed(2)) : 0,
      workflows: Object.fromEntries(workflowBreakdown.map(w => [w._id, w.count])),
      uptimeSeconds: Math.floor(process.uptime())
    };
  }

  async claim(record, event) {
    const filter = { _id: record.id, status: record.status, attempts: record.attempts };
    if (record.status === 'PROCESSING') filter.leaseUntil = { $lte: new Date() };
    if (record.status === 'RETRY_PENDING') {
      filter.$or = [
        { nextRetryAt: null },
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: { $lte: new Date() } }
      ];
    }
    const updated = await RequestModel.findOneAndUpdate(filter, {
      $set: { status: 'PROCESSING', leaseUntil: new Date(Date.now() + 90000), nextRetryAt: null },
      $inc: { attempts: 1 },
      $push: { audit: event }
    }, { new: true }).lean();
    return plain(updated);
  }

  async expireBackoff(id) {
    await RequestModel.findByIdAndUpdate(id, { $set: { nextRetryAt: new Date(0) } });
  }

  async finish(record, result) {
    const updated = await RequestModel.findOneAndUpdate(
      { _id: record.id, status: 'PROCESSING', attempts: record.attempts },
      {
        $set: { status: result.status, reason: result.reason, matchedRule: result.matchedRule,
          leaseUntil: null, nextRetryAt: result.nextRetryAt ? new Date(result.nextRetryAt) : null },
        $push: { trace: { $each: result.trace }, audit: result.event }
      }, { new: true }
    ).lean();
    return plain(updated);
  }

  async review(id, result) {
    const updated = await RequestModel.findOneAndUpdate(
      { _id: id, status: 'MANUAL_REVIEW' },
      { $set: { status: result.decision, reason: result.reason },
        $push: { audit: result.event } },
      { new: true }
    ).lean();
    return plain(updated);
  }

  // Atomically transitions a PROCESSING record to FAILED only when the lease
  // is expired and the attempt counter matches — guards against double-recovery.
  async forceFailExpiredFinal(record, event) {
    const updated = await RequestModel.findOneAndUpdate(
      {
        _id: record.id,
        status: 'PROCESSING',
        attempts: record.attempts,
        leaseUntil: { $lte: new Date() }
      },
      {
        $set: { status: 'FAILED', leaseUntil: null,
          reason: 'Worker crashed on final attempt; lease expired without a result.' },
        $push: { audit: event }
      },
      { new: true }
    ).lean();
    return plain(updated);
  }
}

module.exports = { MongoRepository };