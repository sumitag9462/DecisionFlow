let currentToken = null;

export function setAuthToken(token) {
  currentToken = token;
}

export function getAuthToken() {
  return currentToken;
}

export async function apiRequest(path, { method = 'GET', body, token, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const effectiveToken = token !== undefined ? token : currentToken;
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }

  const options = {
    method,
    headers,
    signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  };

  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    throw new Error(`Network failure: unable to connect to DecisionFlow API. Check that backend server is running on port 3001. (${err.message})`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned non-JSON response with HTTP ${res.status}.`);
  }

  if (!res.ok) {
    const details = data.details?.length ? ` (${data.details.join('; ')})` : '';
    const errorMsg = `${data.message || `HTTP ${res.status}`}${details}`;
    const err = new Error(errorMsg);
    err.code = data.error || 'API_ERROR';
    err.status = res.status;
    err.details = data.details;
    throw err;
  }

  return data;
}

export const api = {
  login: async (email, password) => {
    const res = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    if (res?.token) {
      setAuthToken(res.token);
    }
    return res;
  },
  logout: () => {
    setAuthToken(null);
  },
  getHealth: () => apiRequest('/health'),
  getWorkflows: () => apiRequest('/workflows'),
  getWorkflow: id => apiRequest(`/workflows/${id}`),
  getRequests: (params = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', params.limit);
    if (params.page) query.set('page', params.page);
    if (params.paginated) query.set('paginated', 'true');
    if (params.status && params.status !== 'ALL') query.set('status', params.status);
    if (params.workflowId && params.workflowId !== 'ALL') query.set('workflowId', params.workflowId);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return apiRequest(`/requests${qs}`);
  },
  getRequest: id => apiRequest(`/requests/${id}`),
  submitRequest: payload => apiRequest('/requests', { method: 'POST', body: payload }),
  retryRequest: id => apiRequest(`/requests/${id}/retry`, { method: 'POST' }),
  reviewRequest: (id, reviewData) => apiRequest(`/requests/${id}/review`, { method: 'POST', body: reviewData }),
  getMetrics: () => apiRequest('/metrics'),
  simulate: payload => apiRequest('/simulate', { method: 'POST', body: payload }),
  getEvidence: id => apiRequest(`/requests/${id}/evidence`),
  verifyAudit: id => apiRequest(`/requests/${id}/verify-audit`),
  getAuthMe: () => apiRequest('/auth/me')
};

