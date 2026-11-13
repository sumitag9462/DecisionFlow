const mongoose = require('mongoose');
const { Schema } = mongoose;

const RequestSchema = new Schema({
  workflowId: { type: String, required: true },
  policyVersion: { type: Number, required: true },
  policySnapshot: { type: Schema.Types.Mixed, required: true },
  idempotencyKey: { type: String, required: true },
  payloadHash: { type: String, required: true },
  data: { type: Schema.Types.Mixed, required: true },
  simulation: { type: String, default: 'ok' },
  status: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  reason: String,
  matchedRule: String,
  trace: { type: [Schema.Types.Mixed], default: [] },
  audit: { type: [Schema.Types.Mixed], default: [] },
  leaseUntil: Date,
  nextRetryAt: Date
}, { timestamps: true, minimize: false });

// Uniqueness is enforced by MongoDB, not by a preliminary API lookup.
RequestSchema.index({ workflowId: 1, idempotencyKey: 1 }, { unique: true });
RequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WorkflowRequest', RequestSchema);
