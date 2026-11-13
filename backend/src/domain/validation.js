const { AppError } = require('./errors');

const SUPPORTED_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']);
const OUTCOMES = new Set(['APPROVED', 'REJECTED', 'MANUAL_REVIEW']);

function validatePolicy(policy) {
  if (!policy || typeof policy.id !== 'string' || !Number.isInteger(policy.version) || policy.version < 1) {
    throw new Error('Workflow must have an id and a positive integer version');
  }
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10) {
    throw new Error(`Invalid maxAttempts in ${policy.id}`);
  }
  if (!policy.fields || !Array.isArray(policy.stages) || !policy.stages.length) {
    throw new Error(`Missing fields/stages in ${policy.id}`);
  }
  const stageIds = new Set();
  const ruleIds = new Set();
  for (const [field, schema] of Object.entries(policy.fields)) {
    if (!['string', 'number', 'boolean'].includes(schema.type)) {
      throw new Error(`${policy.id}: unsupported field type for ${field}`);
    }
  }
  for (const stage of policy.stages) {
    if (stageIds.has(stage.id)) throw new Error(`${policy.id}: duplicate stage ${stage.id}`);
    stageIds.add(stage.id);
    if (!['rules', 'dependency'].includes(stage.type)) throw new Error(`Unknown stage type ${stage.type}`);
    if (stage.type === 'rules') {
      if (!Array.isArray(stage.rules)) throw new Error(`Stage ${stage.id} is missing rules`);
      for (const rule of stage.rules) {
        if (ruleIds.has(rule.id)) throw new Error(`${policy.id}: duplicate rule ${rule.id}`);
        ruleIds.add(rule.id);
        if (!Object.hasOwn(policy.fields, rule.field) || !SUPPORTED_OPERATORS.has(rule.operator) || !OUTCOMES.has(rule.outcome)) {
          throw new Error(`${policy.id}: invalid rule ${rule.id}`);
        }
        const fieldType = policy.fields[rule.field].type;
        if (rule.operator === 'in' && (!Array.isArray(rule.value) || !rule.value.every(x => typeof x === fieldType))) {
          throw new Error(`Rule ${rule.id} requires an array of ${fieldType} values`);
        }
        if (rule.operator !== 'in' && (typeof rule.value !== fieldType ||
          (fieldType === 'number' && !Number.isFinite(rule.value)))) {
          throw new Error(`Rule ${rule.id} has an incompatible comparison value`);
        }
        if (!['eq', 'neq', 'in'].includes(rule.operator) && fieldType !== 'number') {
          throw new Error(`Rule ${rule.id} compares a non-numeric field`);
        }
      }
    }
  }
  if (!OUTCOMES.has(policy.defaultOutcome)) throw new Error(`Invalid default outcome in ${policy.id}`);
  return policy;
}

function validateData(policy, data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError(400, 'INVALID_INPUT', 'data must be a JSON object');
  }
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(policy.fields, key)) errors.push(`Unknown field: ${key}`);
  }
  for (const [key, schema] of Object.entries(policy.fields)) {
    const value = data[key];
    if (value === undefined || value === null || value === '') {
      if (schema.required) errors.push(`${key} is required`);
      continue;
    }
    if (typeof value !== schema.type || (schema.type === 'number' && !Number.isFinite(value))) {
      errors.push(`${key} must be a ${schema.type}`);
      continue;
    }
    if (schema.type === 'string' && schema.minLength && value.trim().length < schema.minLength) {
      errors.push(`${key} must be at least ${schema.minLength} characters`);
    }
    if (schema.type === 'number' && (schema.min !== undefined && value < schema.min || schema.max !== undefined && value > schema.max)) {
      errors.push(`${key} is outside the allowed range`);
    }
  }
  if (errors.length) throw new AppError(400, 'INVALID_INPUT', 'Request validation failed', errors);
  return data;
}

function compare(actual, operator, expected) {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'in': return expected.includes(actual);
    default: throw new Error(`Unsupported operator: ${operator}`);
  }
}

module.exports = { validatePolicy, validateData, compare };
