import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Overview from './pages/Overview';
import NewRequest from './pages/NewRequest';
import RequestHistory from './pages/RequestHistory';
import DecisionExplorer from './pages/DecisionExplorer';
import WorkflowPolicies from './pages/WorkflowPolicies';
import WhatIfSimulator from './pages/WhatIfSimulator';
import ReliabilityDemo from './pages/ReliabilityDemo';
import { api } from './services/api';

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

const DEMO_CREDENTIALS = {
  ADMIN: { email: 'admin@decisionflow.io', password: 'Admin@123' },
  REVIEWER: { email: 'reviewer@decisionflow.io', password: 'Reviewer@123' },
  VIEWER: { email: 'viewer@decisionflow.io', password: 'Viewer@123' }
};

export default function App() {
  const [activePage, setActivePage] = useState('overview');
  const [currentRole, setCurrentRole] = useState('ADMIN');
  const [connected, setConnected] = useState(false);

  // Global Data
  const [workflows, setWorkflows] = useState([]);
  const [requests, setRequests] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [lastSubmittedResult, setLastSubmittedResult] = useState(null);
  const [simulationResult, setSimulationResult] = useState(null);
  const [auditIntegrity, setAuditIntegrity] = useState(null);

  // Global State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Initial Authentication & Data Fetch
  const refreshAllData = useCallback(async () => {
    try {
      const creds = DEMO_CREDENTIALS[currentRole] || DEMO_CREDENTIALS.ADMIN;
      await api.login(creds.email, creds.password);

      const [health, wfs, reqs, mets] = await Promise.all([
        api.getHealth(),
        api.getWorkflows(),
        api.getRequests({ limit: 50 }),
        api.getMetrics()
      ]);

      if (health?.status === 'ok') setConnected(true);
      if (Array.isArray(wfs)) setWorkflows(wfs);
      const items = Array.isArray(reqs) ? reqs : (reqs?.items || []);
      setRequests(items);
      setMetrics(mets);
    } catch (err) {
      setConnected(false);
      setErrorMsg(`API connection error: ${err.message}`);
    }
  }, [currentRole]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

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
      setSuccessMsg(`Review recorded: Decision resolved to ${updated.status} by ${reviewer}.`);
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

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar activePage={activePage} onNavigate={page => { setActivePage(page); setErrorMsg(''); setSuccessMsg(''); }} />

      {/* Main Area */}
      <div className="app-main">
        <Header
          title={currentMeta.title}
          description={currentMeta.description}
          connected={connected}
          currentRole={currentRole}
          onRoleChange={role => { setCurrentRole(role); setSuccessMsg(`Role switched to ${role}`); }}
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

          {/* Active View */}
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
        </main>
      </div>
    </div>
  );
}
