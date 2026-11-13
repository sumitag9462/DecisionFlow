# Engineering Review & Defect Fixes

This document records the defects identified during the engineering audit, their root causes, the minimal reliable fixes applied, and the corresponding regression tests.

---

## 1. Summary of defects and resolutions

| Issue | File(s) | Problem | Root Cause | Fix Applied | Regression Test |
|---|---|---|---|---|---|
| **Bug 1: Idempotency Replay After Policy Update** | `backend/src/services/decisionService.js` | Replaying an existing request after a policy schema version update failed with HTTP 400 | `validateData(policy, data)` was executed before checking for an existing record by idempotency key | Check `repo.findByKey` before schema validation; if matching hash, return replay; if changed hash, return 409; only validate new requests | `tests/core.node.test.js`: "idempotency replay succeeds after policy adds a required field"; `tests/integration/mongo.integration.test.js`: Test 14 |
| **Bug 2: Worker Crash on Final Allowed Attempt** | `backend/src/services/decisionService.js`<br>`backend/src/persistence/MongoRepository.js`<br>`backend/tests/FakeRepository.js` | Worker crashed on final allowed attempt left document permanently stuck in `PROCESSING` | Guard `attempts >= maxAttempts` threw `409 RETRY_LIMIT` before checking if lease had expired on a crashed worker | Added atomic `forceFailExpiredFinal()` method and CAS handler in `process()` to transition crashed final attempts to `FAILED` with `CRASH_RECOVERY` audit event | `tests/core.node.test.js`: "final-attempt worker crash recovers to FAILED on lease expiry" & "repeated recovery on final-attempt crash does not duplicate events"; `tests/integration/mongo.integration.test.js`: Test 13 |
| **Gap 1: Missing Real MongoDB Integration Tests** | `backend/tests/integration/mongo.integration.test.js`<br>`backend/package.json` | Tests previously ran exclusively against an in-memory test double; real MongoDB indexes, atomic CAS and race conditions were unverified | No live MongoDB test suite configured | Created 16-scenario Jest integration suite running against live MongoDB test database `decisionflow_integration_test`; added `npm run test:integration` script | `backend/tests/integration/mongo.integration.test.js` (16 passed / 16 total) |
| **Gap 2: MongoDB Local Startup Failure on macOS** | `backend/server.js`<br>`README.md` | Homebrew service failed with exit code 62 due to version mismatch (mongod 8.0 linked against 8.3 data directory) | `brew services start` attempted to run mismatched binary; `server.js` lacked actionable startup diagnostics | Linked `mongodb-community@8.3.3`, started daemon via mongod.conf, enhanced `server.js` startup error message with explicit command guidance | Live backend startup and health check verified |
| **Security 1: Authentication & RBAC Privilege Spoofing** | `backend/src/auth/authService.js`<br>`backend/src/http/createApp.js`<br>`frontend/src/services/api.js` | Unauthenticated callers could bypass RBAC or forge reviewer identity using client-supplied headers or body | `X-Demo-Role` header allowed client to declare its own role; `review` endpoint accepted client `reviewer` body | Removed `X-Demo-Role` completely; implemented strict RFC 7519 HMAC-SHA256 JWT auth with HS256 algorithm enforcement; reviewer derived strictly from `req.user.name` | `tests/http.jest.test.js`: "RBAC rejects review by VIEWER role with 403 Forbidden" and "manual reviewer decision leaves an audit event" |
| **Security 2: Prototype Pollution & What-If Type Safety** | `backend/src/services/decisionService.js`<br>`frontend/src/pages/WhatIfSimulator.jsx` | What-If simulation did not defend against prototype pollution (`__proto__`, `constructor`) or invalid threshold types | Overrides applied without checking property ownership or field type compatibility | Added own-property defense against `__proto__`, `constructor`, `prototype`; validated threshold types against policy schema; enforced `validatePolicy()` on clone | `tests/core.node.test.js`: "what-if simulation rejects prototype pollution and invalid overrides"; `tests/http.jest.test.js`: "what-if simulation rejects invalid threshold types with 400" |
| **Reliability 1: Exponential Backoff Window Enforcement** | `backend/src/services/decisionService.js`<br>`backend/src/persistence/MongoRepository.js` | Premature retries during backoff window were permitted without delay | `process()` did not check `nextRetryAt` on `RETRY_PENDING` records | Enforced `nextRetryAt` guard throwing HTTP 429 (`RETRY_TOO_EARLY`) with remaining seconds; added `{ $lte: new Date() }` filter in `repo.claim()` | `tests/core.node.test.js`: "fails once, persists retry state, then succeeds"; `tests/http.jest.test.js`: "transient external failure can be retried through REST"; `mongo.integration.test.js`: Test 11 |
| **Integrity 1: Cryptographic Audit Hash Chain Verification** | `backend/src/services/decisionService.js`<br>`frontend/src/pages/DecisionExplorer.jsx` | Audit verification skipped missing hashes and lacked chronological order enforcement | Verification loop allowed undefined `hash`/`prevHash` to pass as valid | Enforced fail-closed verification: validates 64-hex SHA-256 strings, genesis link, timestamp monotonicity, and event payload hash; legacy records classified as `UNVERIFIABLE_LEGACY` | `tests/core.node.test.js`: "audit hash chain verifies genuine records and detects tampering" and "audit verification identifies legacy unhashed records as UNVERIFIABLE_LEGACY" |
| **Data 1: Decision Explorer Full Document Hydration** | `frontend/src/App.jsx`<br>`frontend/src/pages/DecisionExplorer.jsx` | Selecting a request from history table showed empty trace and audit ledger | `MongoRepository.list()` projects only summary fields for efficiency; frontend inspected summary object without fetching full document | Updated `handleInspect` to call `api.getRequest(id)` to load full document with rule trace and audit history | Verified in frontend build and manual inspection |
| **Data 2: Server-Side Pagination & Threshold Alignment** | `backend/src/persistence/MongoRepository.js`<br>`frontend/src/pages/RequestHistory.jsx`<br>`frontend/src/pages/WhatIfSimulator.jsx` | Table loaded all records into memory; claim thresholds in frontend UI were mismatched with policy JSON | Frontend used in-memory filtering; simulator defaulted to 40/50k instead of 60/100k from `claim-processing.json` | Wired server-side pagination (`?paginated=true&limit=25&page=X`); synchronized claim thresholds (`fraudScore >= 60`, `claimAmount > 100,000`) | Verified live via curl and browser build |

---

## 2. Detailed Technical Breakdown

### Bug 1: Idempotency Replay Across Policy Versions

**Symptoms:**  
A client submits a vendor onboarding request under policy v1. Later, a policy administrator publishes policy v2 which introduces an additional mandatory field (`taxId`). If the client subsequently replays the original request using its original idempotency key and identical v1 payload, the API previously returned `400 INVALID_INPUT: taxId is required`.

**Root Cause:**  
In `decisionService.js submit()`, `validateData(policy, data)` was called immediately at the top of the function using the currently loaded active policy. The duplicate-key detection happened only when `repo.create()` threw MongoDB error code `11000`. Consequently, an existing valid record could never be returned because the validation step threw before reaching the database.

**Fix Applied:**  
1. Added a pre-validation lookup: `const preCheck = await repo.findByKey(workflowId, normalizedKey)`.
2. If `preCheck` exists:
   - If `preCheck.payloadHash === payloadHash`: return `{ request: preCheck, replayed: true }` without re-validating against the new schema.
   - If `preCheck.payloadHash !== payloadHash`: throw `409 IDEMPOTENCY_CONFLICT`.
3. If no existing record is found, execute `validateData(policy, data)` against the active policy.
4. If two concurrent new submissions race past `findByKey`, MongoDB's compound unique index guarantees only one insert succeeds; the loser catches error code `11000` and safely returns the winner's record.

---

### Bug 2: Worker Crash Recovery on Final Allowed Attempt

**Symptoms:**  
When an external dependency failed repeatedly, a request reached its maximum configured attempts (e.g. attempt 3 of 3). A worker claimed attempt 3, setting `status: 'PROCESSING'` and `leaseUntil = now + 90s`. If the worker crashed (power outage, unhandled signal, network cutoff) before calling `finish()`, the record remained stuck in `PROCESSING`. When an operator attempted to retry or recover the record after the 90-second lease expired, the service threw `409 RETRY_LIMIT: Maximum attempts reached`, leaving the document in `PROCESSING` forever.

**Root Cause:**  
`decisionService.js process()` contained:
```javascript
if (current.attempts >= current.policySnapshot.maxAttempts) {
  throw new AppError(409, 'RETRY_LIMIT', 'Maximum attempts reached');
}
```
This guard executed unconditionally before checking whether the current status was `PROCESSING` with an expired lease.

**Fix Applied:**  
1. Added atomic repository method `forceFailExpiredFinal(record, event)` in `MongoRepository.js` and `FakeRepository.js` using compare-and-set:
   ```javascript
   const filter = {
     _id: record.id,
     status: 'PROCESSING',
     attempts: record.attempts,
     leaseUntil: { $lte: new Date() }
   };
   ```
2. Before the retry limit guard in `process()`, added detection:
   ```javascript
   if (current.status === 'PROCESSING' &&
       new Date(current.leaseUntil) <= new Date() &&
       current.attempts >= current.policySnapshot.maxAttempts) {
     const recoveryEvent = audit('CRASH_RECOVERY', 'PROCESSING', 'FAILED',
       { attempt: current.attempts, reason: 'Worker crashed on final attempt; lease expired without a result.' });
     return await repo.forceFailExpiredFinal(current, recoveryEvent);
   }
   ```
3. Once transitioned to `FAILED`, subsequent retries are safely rejected by the terminal status guard (`409 NOT_RETRIABLE`) without duplicate audit events.

---

### Security 1: Authentication & Privilege Hardening

**Symptoms:**  
The client could pass `X-Demo-Role: ADMIN` in request headers to bypass role checks, or supply `reviewer: "Alice"` in the JSON body to forge audit trail attribution.

**Root Cause:**  
`authService.js` inspected `req.get('X-Demo-Role')` before evaluating the JWT, allowing client-controlled privilege elevation. Route handlers in `createApp.js` read `req.body.reviewer` directly.

**Fix Applied:**  
1. Completely removed reading `X-Demo-Role` across all backend services and frontend API client.
2. Verified signed HMAC-SHA256 JWT tokens using Node.js native `crypto.createHmac`.
3. Validated token header strictly: `decodedHeader.alg === 'HS256' && decodedHeader.typ === 'JWT'`.
4. Password verification uses Node.js native `crypto.scryptSync`.
5. Mounted `requireRole('REVIEWER', 'ADMIN')` middleware on manual review endpoints.
6. Derived `reviewer` strictly from server-side JWT context (`req.user.name`).

---

### Reliability 1: Exponential Backoff Window Enforcement

**Symptoms:**  
When an external dependency failed with 503, the engine calculated `nextRetryAt` with exponential backoff (e.g., +1s, +2s, +4s). However, calling `POST /api/requests/:id/retry` immediately after failure bypassed the backoff window and consumed retry attempts instantly.

**Root Cause:**  
Neither `process()` nor `repo.claim()` enforced `nextRetryAt <= new Date()`.

**Fix Applied:**  
1. In `decisionService.js process()`:
   ```javascript
   if (current.status === 'RETRY_PENDING' && current.nextRetryAt && new Date(current.nextRetryAt) > new Date()) {
     if (explicitRetry) {
       const remainingSeconds = Math.ceil((new Date(current.nextRetryAt).getTime() - Date.now()) / 1000);
       throw new AppError(429, 'RETRY_TOO_EARLY', `Retry is not eligible until ${current.nextRetryAt} (${remainingSeconds}s remaining)`);
     }
     return current;
   }
   ```
2. In `MongoRepository.js claim()`:
   ```javascript
   if (record.status === 'RETRY_PENDING') {
     filter.$or = [
       { nextRetryAt: null },
       { nextRetryAt: { $exists: false } },
       { nextRetryAt: { $lte: new Date() } }
     ];
   }
   ```
3. Added `expireBackoff(id)` to allow controlled time-travel in automated tests.
