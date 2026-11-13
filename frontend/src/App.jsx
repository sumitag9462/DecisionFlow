import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoginModal from './components/LoginModal';
import Overview from './pages/Overview';
import NewRequest from './pages/NewRequest';
import RequestHistory from './pages/RequestHistory';
import DecisionExplorer from './pages/DecisionExplorer';
import WorkflowPolicies from './pages/WorkflowPolicies';
import WhatIfSimulator from './pages/WhatIfSimulator';
import ReliabilityDemo from './pages/ReliabilityDemo';
import { api, setAuthToken, getAuthToken } from './services/api';

const pageMeta = {
  overview: {
    title: 'Overview Dashboard',
    description: 'System-wide request metrics, workflow summaries, and recent activity'
  },
  'new-request': {
    title: 'New Intake Request',
    description: 'Submit an approval request with schema validation and idempotency protection'
  },
  history: {
    title: 'Request History',
    description: 'Complete lifecycle operations ledger with workflow and status filtering'
  },
  explorer: {
    title: 'Decision Explorer',
    description: 'Step-by-step rule evaluation traces, stage pipeline, and cryptographic audit proofs'
  },
  policies: {
    title: 'Workflow Policies',
    description: 'Declarative JSON policy specifications, evaluation rules, and version diff'
  },
  simulator: {
    title: 'What-If Policy Simulator',
    description: 'In-memory threshold adjustment and side-by-side outcome comparison'
  },
  reliability: {
    title: 'Reliability Demo',
    description: 'Interactive test bench for transient failure recovery and concurrent replay races'
  }
};

export default function App() {
  const [activePage, setActivePage] = useState('overview');
  const [connected, setConnected] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Authenticated User Session
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('decisionflow_user');
      const savedToken = localStorage.getItem('decisionflow_token');
      if (savedUser && savedToken) {
        setAuthToken(savedToken);
        return JSON.parse(savedUser);
      }
    } catch (_) {}
    return null;
  });

  // Global Data
  const [workflows, setWorkflows] = useState([]);
  const [requests, setRequests] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [lastSubmittedResult, setLastSubmittedResult] = useState(null);
  const [simulationResult, setSimulationResult] = useState(null);
  const [auditIntegrity, setAuditIntegrity] = useState(null);

  // Global UI State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Initial Authentication & Data Fetch
  const refreshAllData = useCallback(async () => {
    try {
      // Restore token to API service if present in storage
      const savedToken = localStorage.getItem('decisionflow_token');
      if (savedToken && !api.getAuthToken) {
        // will be loaded below
      }

      // Public health check and workflow policy definitions
      const [health, wfs] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getWorkflows().catch(() => [])
      ]);

      if (health?.status === 'ok') setConnected(true);
      else setConnected(false);

      if (Array.isArray(wfs)) setWorkflows(wfs);

      // Authenticated data fetch (only if user is logged in)
      if (currentUser) {
        const [reqs, mets] = await Promise.all([
          api.getRequests({ limit: 50 }).catch(err => {
            if (err.status === 401) handleLogout();
            return [];
          }),
          api.getMetrics().catch(() => null)
        ]);

        const items = Array.isArray(reqs) ? reqs : (reqs?.items || []);
        setRequests(items);
        setMetrics(mets);
      } else {
        setRequests([]);
        setMetrics(null);
      }
    } catch (err) {
      setConnected(false);
      setErrorMsg(`API connection error: ${err.message}`);
    }
  }, [currentUser]);

  useEffect(() => {
    const token = localStorage.getItem('decisionflow_token');
    if (token) {
      setAuthToken(token);
    }
    refreshAllData();
  }, [refreshAllData]);

  function handleLoginSuccess(user) {
    setCurrentUser(user);
    try {
      localStorage.setItem('decisionflow_user', JSON.stringify(user));
      localStorage.setItem('decisionflow_token', api.getAuthToken());
    } catch (_) {}
    setSuccessMsg(`Welcome, ${user.name}! Authenticated with role ${user.role}.`);
    setIsLoginModalOpen(false);
  }

  function handleLogout() {
    api.logout();
    setCurrentUser(null);
    try {
      localStorage.removeItem('decisionflow_user');
      localStorage.removeItem('decisionflow_token');
    } catch (_) {}
    setRequests([]);
    setMetrics(null);
    setSelectedRequest(null);
    setSuccessMsg('You have been signed out.');
  }

  // Navigate to Decision Explorer and fetch complete record (with trace & audit)
  async function handleInspect(record) {
    if (!record) return;
    setSelectedRequest(record);
    setAuditIntegrity(null);
    setActivePage('explorer');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const fullDoc = await api.getRequest(record.id);
      if (fullDoc) setSelectedRequest(fullDoc);
    } catch (err) {
      console.warn('Could not load complete request details:', err);
    }
  }

  // Handle New Request Submit
  async function handleSubmitRequest(payload) {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await api.submitRequest(payload);
      const doc = res.request;
      setLastSubmittedResult({ ...doc, replayed: res.replayed });
      setSelectedRequest(doc);
      setAuditIntegrity(null);
      setSuccessMsg(
        res.replayed
          ? `Idempotent replay: original request #${doc.id.slice(0, 8)} returned without running checks again.`
          : `Request #${doc.id.slice(0, 8)} evaluated successfully with status ${doc.status}.`
      );
      await refreshAllData();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Retry
  async function handleRetry(requestId) {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const updated = await api.retryRequest(requestId);
      setSelectedRequest(updated);
      setSuccessMsg(`Retry completed: Request is now ${updated.status} on attempt ${updated.attempts}.`);
      await refreshAllData();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Manual Review
  async function handleReview(requestId, decision, reviewer, reason) {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const updated = await api.reviewRequest(requestId, { decision, reviewer, reason });
      setSelectedRequest(updated);
      setSuccessMsg(`Review recorded: Decision resolved to ${updated.status} by ${reviewer || currentUser?.name}.`);
      await refreshAllData();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle What-If Simulation
  async function handleSimulate(payload) {
    setLoading(true);
    setErrorMsg('');
    try {
      const result = await api.simulate(payload);
      setSimulationResult(result);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Audit Integrity Check
  async function handleVerifyAudit(requestId) {
    setLoading(true);
    setErrorMsg('');
    try {
      const result = await api.verifyAudit(requestId);
      setAuditIntegrity(result.integrity);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Evidence Export
  async function handleDownloadEvidence(requestId) {
    try {
      const evidence = await api.getEvidence(requestId);
      const json = JSON.stringify(evidence, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `decision-evidence-${requestId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setSuccessMsg(`Evidence certificate ${evidence.certificateId} downloaded successfully.`);
    } catch (err) {
      setErrorMsg(err.message);
    }
  }

  const currentMeta = pageMeta[activePage] || pageMeta.overview;
  const currentRole = currentUser?.role || 'VIEWER';

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        onNavigate={page => {
          setActivePage(page);
          setErrorMsg('');
          setSuccessMsg('');
        }}
      />

      {/* Main Area */}
      <div className="app-main">
        <Header
          title={currentMeta.title}
          description={currentMeta.description}
          connected={connected}
          currentUser={currentUser}
          onOpenLogin={() => setIsLoginModalOpen(true)}
          onLogout={handleLogout}
        />

        <main className="page-container">
          {/* Global Alert Banners */}
          {errorMsg && (
            <div className="alert alert-error" role="alert">
              <div>
                <strong>Error: </strong>
                <span>{errorMsg}</span>
              </div>
              <button type="button" className="alert-dismiss" onClick={() => setErrorMsg('')}>×</button>
            </div>
          )}

          {successMsg && (
            <div className="alert alert-success" role="status">
              <div>
                <strong>Success: </strong>
                <span>{successMsg}</span>
              </div>
              <button type="button" className="alert-dismiss" onClick={() => setSuccessMsg('')}>×</button>
            </div>
          )}

          {/* Unauthenticated State Gate for Protected Views */}
          {!currentUser && activePage !== 'policies' ? (
            <div className="card" style={{ maxWidth: '580px', margin: '40px auto', textAlign: 'center', padding: 'var(--space-6)' }}>
              <div style={{ fontSize: '40px', marginBottom: 'var(--space-3)' }}>🔐</div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                Authentication Required
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: 'var(--space-5)' }}>
                The <strong>{currentMeta.title}</strong> is protected by RFC 7519 JWT and Role-Based Access Control.
                Please sign in with one of the predefined demo accounts (Admin, Reviewer, or Viewer) to explore and interact with the decision engine.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsLoginModalOpen(true)}
                >
                  Sign In with Demo Account
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setActivePage('policies')}
                >
                  View Public Policies
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active Protected View */}
              {activePage === 'overview' && (
                <Overview
                  metrics={metrics}
                  workflows={workflows}
                  recentRequests={requests.slice(0, 8)}
                  onInspect={handleInspect}
                  onNavigate={setActivePage}
                  onRefresh={refreshAllData}
                  loading={loading}
                />
              )}

              {activePage === 'new-request' && (
                <NewRequest
                  workflows={workflows}
                  onSubmit={handleSubmitRequest}
                  onInspect={handleInspect}
                  loading={loading}
                  lastResult={lastSubmittedResult}
                />
              )}

              {activePage === 'history' && (
                <RequestHistory
                  requests={requests}
                  workflows={workflows}
                  onInspect={handleInspect}
                  onRefresh={refreshAllData}
                  loading={loading}
                />
              )}

              {activePage === 'explorer' && (
                <DecisionExplorer
                  request={selectedRequest}
                  allRequests={requests}
                  currentRole={currentRole}
                  onSelectRequest={handleInspect}
                  onRetry={handleRetry}
                  onReview={handleReview}
                  onVerifyAudit={handleVerifyAudit}
                  onDownloadEvidence={handleDownloadEvidence}
                  auditIntegrity={auditIntegrity}
                  loading={loading}
                />
              )}

              {activePage === 'policies' && (
                <WorkflowPolicies workflows={workflows} />
              )}

              {activePage === 'simulator' && (
                <WhatIfSimulator
                  workflows={workflows}
                  onSimulate={handleSimulate}
                  simulationResult={simulationResult}
                  loading={loading}
                />
              )}

              {activePage === 'reliability' && (
                <ReliabilityDemo
                  currentRole={currentRole}
                  onRefreshHistory={refreshAllData}
                  onError={setErrorMsg}
                  onSuccess={setSuccessMsg}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Explicit Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        canClose={true}
      />
    </div>
  );
}
