import React from 'react';
import { badgeNames } from '../utils/formatters';

export default function StatusBadge({ status }) {
  if (!status) return null;
  const normalized = status.toLowerCase().replaceAll('_', '-');
  const label = badgeNames[status] || status;

  return (
    <span className={`badge badge-${normalized}`}>
      {label}
    </span>
  );
}

