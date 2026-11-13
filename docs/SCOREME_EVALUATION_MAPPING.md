# ScoreMe Hackathon — Technical Evaluation Mapping

This document provides a direct, transparent mapping between the official **ScoreMe Hackathon Evaluation Criteria** and the concrete implementation in **DecisionFlow**.

---

## Evaluation Scorecard & Evidence Index

| Category | Weight | Key Technical Implementation in DecisionFlow | Primary Code / Doc References |
|---|:---:|---|---|
| **1. Problem Structuring** | **20 Marks** | • Clear architectural boundaries: Domain logic (`engine.js`, `validation.js`), application service (`decisionService.js`), persistence layer (`MongoRepository.js`), transport (`createApp.js`), and frontend studio (`frontend/src/`).<br>• Separation of concerns: Pure functional rule evaluation without side-effects; zero database calls inside the decision engine. | • `backend/src/domain/engine.js`<br>• `backend/src/services/decisionService.js`<br>• `docs/ARCHITECTURE.md` |
| **2. Architecture Quality** | **20 Marks** | • Generic multi-stage workflow pipeline supporting heterogeneous use cases (Vendor Approval, Insurance Claims) via declarative configuration.<br>• Low coupling: Storage-agnostic repository interface (`MongoRepository` for production, `FakeRepository` for unit tests).<br>• Zero-dependency native authentication & RBAC (RFC 7519 JWT + scrypt). | • `backend/src/config/loadPolicies.js`<br>• `backend/src/auth/authService.js`<br>• `backend/src/persistence/MongoRepository.js` |
| **3. Engineering Robustness** | **20 Marks** | • **Strict Idempotency:** Compound unique index `(workflowId, idempotencyKey)` arbitrates parallel races; duplicate payload returns cached replay; altered payload returns 409 conflict.<br>• **Atomic Compare-and-Set:** `findOneAndUpdate` guarantees status transition and audit ledger commit in a single database write.<br>• **Worker Leasing & Crash Recovery:** 90-second leases allow safe reclaim; crashed workers on final attempt recover safely to `FAILED`.<br>• **Exponential Backoff:** Premature retries rejected with HTTP 429 (`RETRY_TOO_EARLY`). | • `backend/src/persistence/MongoRepository.js`<br>• `backend/src/services/decisionService.js`<br>• `backend/tests/integration/mongo.integration.test.js` (Tests 5, 7, 8, 11, 13) |
| **4. Configurability & Maintainability** | **15 Marks** | • Declarative JSON policies define schemas, stages, operators, and rules without code modifications.<br>• **Immutable Policy Snapshots:** Each record stores an exact copy of its policy version at creation time, ensuring historical decisions survive future policy bumps.<br>• Replay across schema bumps: Replaying a v1 record after a v2 schema update succeeds without validation failure. | • `backend/config/vendor-approval.json`<br>• `backend/config/claim-processing.json`<br>• `docs/REVIEW_FIXES.md` (Bug 1 Breakdown) |
| **5. Explainability & Auditability** | **10 Marks** | • **Full Negative Proof Rule Trace:** Every rule evaluated (matched and non-matched) is recorded with field name, operator, expected threshold, and actual input fact.<br>• **Cryptographic Audit Hash Chain:** Every state change is chained using SHA-256 hashes (`prevHash` + `hash`), anchored at `GENESIS_HASH`. Tampering is detected automatically.<br>• **Exportable Decision Evidence:** RFC-compliant JSON certificate export with input payload fingerprint. | • `backend/src/services/decisionService.js` (`verifyAuditChain`, `getEvidence`)<br>• `docs/DECISION_EXAMPLES.md`<br>• `frontend/src/pages/DecisionExplorer.jsx` |
| **6. Testing Depth** | **10 Marks** | • **59 Total Automated Tests (0 Failures, 0 Skipped, Fail-Closed):**<br>&nbsp;&nbsp;- 28 Core Domain Tests (`node:test`)<br>&nbsp;&nbsp;- 15 HTTP Integration Tests (Jest + Supertest)<br>&nbsp;&nbsp;- 16 Real MongoDB Integration Tests (against live `mongod` on port 27017)<br>• Edge cases covered: 20-worker intake race, 10-worker retry claim, lease expiration recovery, final attempt crash, prototype pollution, schema version bumps. | • `backend/tests/core.node.test.js`<br>• `backend/tests/http.jest.test.js`<br>• `backend/tests/integration/mongo.integration.test.js`<br>• `docs/TEST_RESULTS.md` |
| **7. Trade-off Defence** | **5 Marks** | • Fully defended architectural choices:<br>&nbsp;&nbsp;1. MongoDB Document Embedding vs Relational Dual-Write<br>&nbsp;&nbsp;2. MongoDB Atomic CAS Leases vs Redis (Redlock)<br>&nbsp;&nbsp;3. Native Node `crypto` vs External npm JWT/Bcrypt<br>&nbsp;&nbsp;4. In-Memory What-If Simulation vs Test Database Records<br>&nbsp;&nbsp;5. Rejection of `npm audit fix --force` (preserving Jest v29 over downgrading to v25) | • `docs/TRADEOFFS.md`<br>• `docs/RESUME_ALIGNMENT.md` |

---

## Deliverables Checklist Alignment

- [x] **Working runnable implementation with README:** Complete, verified on Node 22/26 and MongoDB 8.3 (`README.md`).
- [x] **Architecture document:** Comprehensive explanation of system design, state machine, data flow, trade-offs, and assumptions (`docs/ARCHITECTURE.md`).
- [x] **Configuration model:** JSON workflow specifications demonstrating dynamic fields, stages, operators, and rules (`backend/config/`).
- [x] **API interface:** Express REST API with security headers, correlation IDs, plus a React 18 6-view Decision Studio UI (`frontend/`).
- [x] **Test coverage:** 59 passing tests covering happy path, invalid input, duplicate requests, dependency failure, retry flow, and rule change scenarios (`docs/TEST_RESULTS.md`).
- [x] **Decision explanation examples:** Detailed input, rules triggered, output, and audit reasoning examples (`docs/DECISION_EXAMPLES.md`).
- [x] **Constraints satisfied:** Tolerates requirement changes, simulates external dependency (503 flap), supports strict idempotency, full cryptographic audit logs, configurable without code rewrites, and documents scaling considerations.

