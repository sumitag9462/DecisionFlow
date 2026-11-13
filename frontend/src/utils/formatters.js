export const badgeNames = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  MANUAL_REVIEW: 'Manual Review',
  RETRY_PENDING: 'Retry Pending',
  FAILED: 'Failed',
  PROCESSING: 'Processing',
  RECEIVED: 'Received'
};

export function formatCurrency(amount) {
  if (typeof amount !== 'number') return '—';
  return '₹' + amount.toLocaleString('en-IN');
}

export function formatValue(val) {
  if (typeof val === 'number') {
    return val.toLocaleString('en-IN');
  }
  if (typeof val === 'boolean') {
    return val ? 'Yes' : 'No';
  }
  return String(val ?? '—');
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return isoString;
  }
}

export function formatShortDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

export function getFieldLabel(name) {
  const map = {
    vendorName: 'Vendor Name',
    annualSpend: 'Annual Spend (INR)',
    riskScore: 'Risk Score (0–100)',
    blacklisted: 'Blacklisted Entity',
    documentsComplete: 'Documents Complete',
    claimReference: 'Claim Reference',
    claimAmount: 'Claim Amount (INR)',
    policyActive: 'Policy Active',
    fraudScore: 'Fraud Score (0–100)'
  };
  return map[name] || name.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase());
}

export function generateKey(prefix = 'df') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

