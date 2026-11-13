# Architecture Notes

**Project:** DecisionFlow — ScoreMe Configurable Workflow Decision Platform  
**Stack:** React 18 / Express / MongoDB Community 8.3 & Mongoose  
**Scope:** Generic multi-stage workflow engine running vendor approvals and insurance claim decisions with cryptographic auditability, idempotency, and What-If simulation.

---

## 1. Boundaries and Scope

The engine evaluates structured facts against versioned, declarative workflow definitions. It does not collect documents, decide whether a real individual is eligible, call an actual compliance API, or trigger an actual bank payment. These are outside the scope of this hackathon submission.

Each incoming request must provide a workflow ID, an idempotency key (via `Idempotency-Key` header or JSON body) and JSON input fields conforming to that workflow's schema. Amounts are expressed in INR. Risk and fraud scores are supplied as demo input facts; a real system must derive or verify them server-side rather than trusting a client-provided score. The API creates a record, attempts to process it, and returns the current status with an explanatory reason and rule evaluation trace. A request can be approved, rejected, routed to review, or marked for retry. A failing dependency eventually exhausts its retry budget and transitions to failed.

---

## 2. Components and Data Flow

```text
React 18 Studio (Vite on :5173)
      |
      | REST /api (Vite reverse proxy with X-Request-ID & Bearer JWT Authorization)
      v
Express Route Handlers (:3001) <--- Declarative JSON Policies (loaded on startup)
      |
      +---> Auth & RBAC Middleware (Zero-dependency RFC 7519 JWT & scrypt)
      |
      v
Decision Service (Idempotency hashing, leasing, state machine, audit chaining, simulation)
      |                                       |
      v                                       v
Rule Engine (Pure, no eval, short-circuits)  Simulated Verification Adapter (503 / recovery)
      |                                       |
      +-------------------+-------------------+
                          |
                          v
                    Mongo Repository (Atomic CAS updates, getMetrics, indexes)
                          |
                          v
                MongoDB `workflow_requests`
                (Record + Policy Snapshot + Trace + Hash-Chained Audit Ledger)
```

- `validation.js`: Schema validation and strict allowlist of comparison operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`). Rejects unknown fields to prevent mass assignment.
- `engine.js`: Executes stages in order, evaluates rules, records every single comparison (matched and non-matched) into the trace, and short-circuits on terminal outcomes.
- `authService.js`: Zero-dependency native Node.js RFC 7519 JWT implementation, scrypt password hashing, and RBAC middleware (`ADMIN`, `REVIEWER`, `VIEWER`).
- `decisionService.js`: Manages request intake, idempotency key hashing, replay detection, worker leasing, crash recovery, SHA-256 audit chaining, and What-If policy simulation.
- `MongoRepository.js`: Implements atomic compare-and-set updates using `findOneAndUpdate` so state transitions and audit events are committed in the same database write.
- `createApp.js`: Express application factory with body size limits, CORS configuration, hex ObjectId validation, correlation IDs, security headers, and sanitized error responses.
- `frontend/`: Single-page React 18 dashboard featuring 6 studio tabs: Overview & Metrics, Decision Studio, What-If Simulator, Request History & Search, Policy Inspector & Diff, and Reliability Lab.

---

## 3. State Model

```text
               REQUEST_RECEIVED
                      |
                      v
                   RECEIVED
                      |
                      v (ATTEMPT_STARTED, lease=90s)
               +-> PROCESSING -----------------------------------+
               |    /   |   \                                    |
               |   /    |    \                                   |
               |  /     |     \                                  |
               | v      v      v                                 v (CRASH_RECOVERY)
      APPROVED  REJECTED  MANUAL_REVIEW                   FAILED (attempt limit
                             |      |                     or crashed final attempt)
                             |      |                            ^
                             v      v                            |
                         APPROVED  REJECTED                      |
                             |                                   |
                             +-----------------------------------+
                             |
                   RETRY_PENDING (dependency failure)
                             |
                             +-----------------------------------+
```

- `RECEIVED`: Request document created and persisted in MongoDB with a unique compound index on `(workflowId, idempotencyKey)`.
- `PROCESSING`: Worker holds a 90-second lease (`leaseUntil`). If a worker crashes before recording a result, the lease expires and allows explicit recovery.
- `APPROVED` / `REJECTED`: Terminal states decided by business rules or manual review. Cannot be retried or re-reviewed.
- `MANUAL_REVIEW`: Exceptions (e.g. high spend, high fraud score, missing documents) route here. Resolvable only via `POST /api/requests/:id/review` with reviewer identity, role authorization, and auditable justification.
- `RETRY_PENDING`: Transient dependency failure occurred with attempts remaining. Stores exponential backoff timestamp (`nextRetryAt`).
- `FAILED`: Set when dependency attempts reach `maxAttempts`, or when a worker crashes on the final allowed attempt and its lease expires.

---

## 4. Configuration Model

Each workflow is defined in a declarative JSON file under `backend/config/`:

- `id`, `name`, `version`, `description`, `maxAttempts`
- `fields`: Schema definition specifying type (`string`, `number`, `boolean`), required flag, min/max bounds, and string lengths.
- `stages`: Ordered array of stages:
  - `rules`: Ordered conditions with operator, comparison value, outcome, and explanatory reason.
  - `dependency`: Calls external verification adapter (simulated with deterministic test doubles).
- `defaultOutcome` and `defaultReason`: Terminal outcome when all stages pass without a match.

Example rule definition:

```json
{
  "id": "VEN-04",
  "field": "annualSpend",
  "operator": "gt",
  "value": 500000,
  "outcome": "MANUAL_REVIEW",
  "reason": "Annual spend requires a second approval."
}
```

Rules use no `eval()` or dynamic code. The engine only executes allowlisted operators. When a request is created, the full policy definition is frozen into `policySnapshot`. If a threshold is modified tomorrow, existing requests remain explainable under the exact rules that decided them.

---

## 5. Atomicity and Idempotency

### Ingestion Idempotency
- Uniqueness is enforced by MongoDB via a compound unique index: `{ workflowId: 1, idempotencyKey: 1 }`.
- A SHA-256 fingerprint is computed from canonicalized, key-sorted input data and simulation mode.
- Replaying the exact same payload returns HTTP `200 OK` with `replayed: true` and the original record.
- Reusing an existing key with altered payload returns HTTP `409 IDEMPOTENCY_CONFLICT`.
- **Policy Evolution Replay Guarantee:** The idempotency lookup occurs before validating against the current policy. An older request submitted under version 1 can be safely replayed even if version 2 adds new mandatory fields. Genuinely new submissions are strictly validated against the active policy.

### State Transition Atomicity
- Transitions are committed via atomic MongoDB `findOneAndUpdate` operations using compare-and-set filters:
  - `claim`: Filters by `{ _id, status, attempts }` (plus `leaseUntil <= now` if already processing). Sets `status = 'PROCESSING'`, increments `attempts`, and pushes `ATTEMPT_STARTED` audit entry in one write.
  - `finish`: Filters by `{ _id, status: 'PROCESSING', attempts }`. Sets final status, reason, trace, and `DECISION_RECORDED` audit entry in one write.
  - `review`: Filters by `{ _id, status: 'MANUAL_REVIEW' }`. Sets decision and `MANUAL_REVIEW_COMPLETED` audit entry in one write.
- A terminal status cannot be committed without its corresponding audit record.

---

## 6. Failure Handling and Recovery

- **Transient Dependency Failure:** Throws typed `DependencyError`. The engine records a temporary failure in the trace, increments attempt count, calculates exponential backoff (`Math.min(30000, 1000 * 2^(attempt-1))`), and transitions to `RETRY_PENDING`.
- **Exhausted Attempts:** When `attempt >= policy.maxAttempts`, the request transitions to `FAILED`. Further retries return `409 NOT_RETRIABLE`.
- **Crashed Worker Recovery:** A worker that crashes during processing leaves `leaseUntil = now + 90s`. Once expired:
  - If attempts remain: An explicit retry reclaims the lease (`recoveredLease: true`), increments attempt, and re-executes.
  - If on the final allowed attempt: The service atomically transitions the record to `FAILED` with a `CRASH_RECOVERY` audit event via `forceFailExpiredFinal()`. Repeated retries return `409 NOT_RETRIABLE` without duplicate events.

---

## 7. Tamper-Evident Cryptographic Audit Hash Chaining

To ensure institutional compliance and prevent stealth database manipulation:
1. Every audit event contains a `prevHash` and a `hash`.
2. The initial event anchors to `GENESIS_HASH` (`0000000000000000000000000000000000000000000000000000000000000000`).
3. Subsequent event hashes are computed via SHA-256 over:
   `prevHash:at:type:from:to:actor:JSON.stringify(stable(detail))`
4. `verifyAuditChain(record)` iterates over the sequence. If an attacker modifies an event payload or backdates a timestamp in MongoDB, the hash mismatch is detected and pinpointed to the exact event index.

---

## 8. Non-Destructive What-If Policy Simulation

Financial institutions frequently need to evaluate the impact of policy changes (e.g. lowering spend limits from ₹500k to ₹250k) before deploying them.
1. `service.simulate({ workflowId, data, proposedThresholds })` clones the active policy in memory.
2. It executes a baseline evaluation against the active policy.
3. It applies proposed threshold overrides to the in-memory clone.
4. It executes a simulation run through the pure engine and returns a structured diff (`outcomeChanged`, `originalOutcome`, `simulatedOutcome`, `summary`).
5. **Zero-Mutation Guarantee:** No documents are written to MongoDB.

---

## 9. Zero-Dependency Native Authentication & RBAC

Rather than adding external npm dependencies (`jsonwebtoken`, `bcryptjs`) which introduce supply-chain attack surfaces, DecisionFlow implements:
1. **RFC 7519 JWT:** Built using Node.js native `crypto.createHmac('sha256', secret)`.
2. **Password Hashing:** Implemented using Node.js native `crypto.scryptSync(password, salt, 32)`.
3. **Roles & Guards:**
   - `ADMIN`: Full system permissions.
   - `REVIEWER`: Authorized to resolve `MANUAL_REVIEW` requests and trigger retries.
   - `VIEWER`: Read-only access. Attempting a review returns `403 Forbidden`.

---

## 10. Certified Decision Evidence Packet

The `/api/requests/:id/evidence` endpoint compiles a self-contained, tamper-evident cryptographic decision packet:
- `certificateId`: Unique certificate ID with timestamp nonce.
- `issuer`: DecisionFlow Enterprise Engine signature.
- `integrity`: Contains input `payloadFingerprint`, audit chain validation status, and head audit hash.
- `decision`: Final status, attempts, matched rule, and decision timestamp.
- `policySnapshot`: Pinned workflow configuration under which the decision was evaluated.
- `ruleTrace`: Complete step-by-step evaluation trace.
- `auditHistory`: Cryptographically chained event timeline.
