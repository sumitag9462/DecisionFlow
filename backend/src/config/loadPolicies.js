const fs = require('node:fs');
const path = require('node:path');
const { validatePolicy } = require('../domain/validation');

function loadPolicies(directory = path.join(__dirname, '../../config')) {
  const policies = new Map();
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.json') && !name.includes('.example.'));
  for (const file of files) {
    const policy = validatePolicy(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
    if (policies.has(policy.id)) throw new Error(`Duplicate workflow ${policy.id}`);
    policies.set(policy.id, policy);
  }
  if (!policies.size) throw new Error('No workflow definitions found');
  return policies;
}

module.exports = { loadPolicies };
