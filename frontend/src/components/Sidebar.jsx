import React from 'react';

const navItems = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'new-request', label: 'New Request', icon: '⚡' },
  { id: 'history', label: 'Request History', icon: '📋' },
  { id: 'explorer', label: 'Decision Explorer', icon: '🔍' },
  { id: 'policies', label: 'Workflow Policies', icon: '⚙️' },
  { id: 'simulator', label: 'What-If Simulator', icon: '🧪' },
  { id: 'reliability', label: 'Reliability Demo', icon: '🛡️' }
];

export default function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">DF</div>
        <div className="brand-title">
          <strong>DecisionFlow</strong>
          <span>MERN Workflow Engine</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`nav-link ${activePage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-link-icon">{item.icon}</span>
            <span className="nav-link-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div>ScoreMe Placement Hackathon</div>
        <div>v2.0 · MongoDB 8.3 Community</div>
      </div>
    </aside>
  );
}

