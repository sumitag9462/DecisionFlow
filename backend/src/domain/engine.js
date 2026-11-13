const { compare } = require('./validation');
const { DependencyError } = require('./errors');

// Every rule checked goes into the trace, including non-matches.
async function runWorkflow({ policy, data, simulation, attempt, verify }) {
  const trace = [];
  for (const stage of policy.stages) {
    if (stage.type === 'rules') {
      for (const rule of stage.rules) {
        const actual = data[rule.field];
        const matched = compare(actual, rule.operator, rule.value);
        trace.push({
          attempt, stageId: stage.id, stageName: stage.name, kind: 'rule',
          ruleId: rule.id, field: rule.field, operator: rule.operator,
          actual, expected: rule.value, matched,
          reason: matched ? rule.reason : 'Condition not met'
        });
        if (matched) {
          return { status: rule.outcome, reason: rule.reason, matchedRule: rule.id, trace };
        }
      }
    } else if (stage.type === 'dependency') {
      try {
        const result = await verify({ policy, data, simulation, attempt });
        trace.push({ attempt, stageId: stage.id, stageName: stage.name,
          kind: 'dependency', outcome: 'OK', reference: result.reference });
      } catch (err) {
        if (!(err instanceof DependencyError)) throw err;
        trace.push({ attempt, stageId: stage.id, stageName: stage.name,
          kind: 'dependency', outcome: 'TEMPORARY_FAILURE', reason: err.message });
        const exhausted = attempt >= policy.maxAttempts;
        return {
          status: exhausted ? 'FAILED' : 'RETRY_PENDING',
          reason: exhausted ? 'Verification failed after all attempts.' : 'Verification unavailable. A retry is needed.',
          matchedRule: null,
          trace,
          retryDelayMs: exhausted ? null : Math.min(30000, 1000 * (2 ** (attempt - 1)))
        };
      }
    }
  }
  return { status: policy.defaultOutcome, reason: policy.defaultReason,
    matchedRule: null, trace };
}

// Replaces a network dependency in this exercise. Its failure modes are explicit test inputs.
async function simulatedVerification({ policy, simulation = 'ok', attempt }) {
  if (simulation === 'always-fail' || (simulation === 'fail-once' && attempt === 1)) {
    throw new DependencyError('Compliance service returned 503');
  }
  return { reference: `SIM-${policy.id.toUpperCase()}-${attempt}` };
}

module.exports = { runWorkflow, simulatedVerification };
