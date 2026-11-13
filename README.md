# DecisionFlow

A configurable, resilient workflow decision platform built with React, Express, and MongoDB.

Developed for the **ScoreMe Placement Drive Hackathon**, DecisionFlow processes high-stakes financial approvals (e.g., vendor onboarding and insurance claims) through a deterministic, auditable, and highly resilient rule engine.

---

## Key Highlights

- **Pure MERN Stack:** Node.js, Express, MongoDB Community 8.3, Mongoose, React 18, Vite. Zero external runtimes (no Python, Docker, Redis, Kafka, or heavy microservices).
- **Generic Configurable Engine:** Both vendor approvals and insurance claims run through the exact same engine. Stages and rules are loaded dynamically from declarative JSON policies.
- **Strict Idempotency & Concurrency:** Protected by a MongoDB unique compound index `(workflowId, idempotencyKey)` and atomic compare-and-swap state transitions. 20 parallel duplicate requests yield exactly 1 database document and 19 cached replays.
- **Tamper-Evident Cryptographic Audit Chain:** Every state transition is cryptographically chained via SHA-256 hashes (`prevHash` + `hash`) with a genesis anchor (`GENESIS_HASH`). Tampered records are detected immediately.
- **Non-Destructive What-If Policy Simulator:** Allows business operators to test prospective rule thresholds (e.g. lowering spend limits) in-memory, observing side-by-side outcome shifts with a **Zero-Mutation Guarantee** on production MongoDB.
- **Certified Decision Evidence Packet:** Exports a tamper-evident, RFC-compliant JSON decision packet including SHA-256 input fingerprints, evaluated rule traces, and cryptographic audit proofs.
- **Zero-Dependency Native Authentication & RBAC:** Native RFC 7519 JWT generation via Node.js `crypto.createHmac`, constant-time signature verification (`crypto.timingSafeEqual`), and password hashing via `crypto.scryptSync`. Features `ADMIN`, `REVIEWER`, and `VIEWER` roles with strict route guards and explicit login modal UI.
- **61 Passing Automated Tests:** 28 core Node.js domain tests, 17 Jest/Supertest HTTP integration tests, and 16 real MongoDB integration tests (fail-closed, 0 skipped).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, Vite, Plain CSS | 7-view Enterprise Decision Studio |
| **Backend API** | Node.js, Express.js | REST API, correlation IDs, security headers |
| **Security & Auth** | Native Node.js `crypto` | Zero-dependency JWT, scrypt hashing, timing-safe RBAC |
| **Database** | MongoDB Community 8.3, Mongoose | Atomic CAS updates, compound unique indexes |
| **Testing** | Node test runner, Jest, Supertest | 61 tests (Unit, HTTP, and Real MongoDB Integration) |

---

## Local Setup

### 1. Prerequisites
- Node.js 18+ (verified on Node 22/26)
- npm 9+
- MongoDB Community 8.x

### 2. Start MongoDB
On macOS (Homebrew MongoDB Community):
```bash
mongod --config /opt/homebrew/etc/mongod.conf
```
*Note: Ensure `mongod` is listening on `127.0.0.1:27017`.*

### 3. Start Backend API
Open a terminal in `backend/`:
```bash
cd backend
npm install
node server.js
```
The server will start on `http://127.0.0.1:3001` and automatically ensure unique indexes exist before accepting requests.

### 4. Start Frontend Studio
Open another terminal in `frontend/`:
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** in your browser. The Vite dev server proxies `/api` calls directly to the Express backend on port 3001.

---

## Running the Automated Test Suites

From the `backend/` directory:

```bash
# 1. Run Core Domain Unit Tests (Node built-in test runner, in-memory repository)
npm run test:core

# 2. Run All Jest Suites (Express HTTP API + Real MongoDB Integration)
npm test

# 3. Run Real MongoDB Integration Tests Only (Against mongodb://127.0.0.1:27017)
npm run test:integration
```

From the `frontend/` directory:
```bash
# Verify Frontend Production Build
npm run build
```

---

## REST API Reference

| Method | Endpoint | Description | Auth / Role |
|---|---|---|---|
| `GET` | `/api/health` | Service health, uptime, and correlation ID | Public |
| `POST` | `/api/auth/login` | Native scrypt authentication (returns JWT) | Public |
| `GET` | `/api/auth/me` | Current authenticated user profile & demo accounts | Public / Optional Bearer |
| `GET` | `/api/metrics` | Real-time aggregate engine metrics & status breakdown | Bearer JWT (All Roles) |
| `POST` | `/api/simulate` | Non-destructive What-If policy impact simulation | Bearer JWT (All Roles) |
| `GET` | `/api/workflows` | List all loaded JSON workflow policies | Public |
| `GET` | `/api/workflows/:id` | Retrieve specific workflow policy definition | Public |
| `GET` | `/api/requests` | List requests (supports `?limit=`, `?page=`, `?status=`) | Bearer JWT (All Roles) |
| `POST` | `/api/requests` | Submit request (enforces schema & idempotency key) | Bearer JWT (All Roles) |
| `GET` | `/api/requests/:id` | Get single request with rule trace and audit ledger | Bearer JWT (All Roles) |
| `POST` | `/api/requests/:id/retry` | Retry pending or lease-expired request | Admin / Reviewer |
| `POST` | `/api/requests/:id/review` | Manual approval/rejection with auditable reason | Admin / Reviewer (403 for Viewer) |
| `GET` | `/api/requests/:id/evidence` | Export certified tamper-evident decision packet | Bearer JWT (All Roles) |
| `GET` | `/api/requests/:id/verify-audit`| Verify cryptographic SHA-256 audit chain integrity | Bearer JWT (All Roles) |

---

## Demo Accounts & RBAC

For evaluation and testing convenience, DecisionFlow includes 3 pre-seeded demo users (authenticated via `POST /api/auth/login` with signed HMAC-SHA256 JWT Bearer tokens; the frontend UI features an explicit Login Modal with quick-fill presets and custom inputs):

| User | Role | Permissions | Password |
|---|---|---|---|
| `admin@decisionflow.io` | **ADMIN** | Full access: submit, retry, review, simulate, export | `Admin@123` |
| `reviewer@decisionflow.io` | **REVIEWER** | Manual review, approval/rejection, retry | `Reviewer@123` |
| `viewer@decisionflow.io` | **VIEWER** | Read-only inspection; blocked from manual reviews (HTTP 403) | `Viewer@123` |

---

## Architecture & Edge-Case Engineering

Detailed engineering documentation is located in the `docs/` directory:
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Comprehensive system architecture, stage pipeline, and concurrency models.
- [TRADEOFFS.md](docs/TRADEOFFS.md) — Defended engineering trade-offs (e.g., MongoDB CAS vs Kafka/Redis, in-memory What-If simulation, zero-dependency auth).
- [REVIEW_FIXES.md](docs/REVIEW_FIXES.md) — Technical post-mortem of resolved edge cases (Schema bump replay order, final-attempt worker crash recovery).
- [TEST_RESULTS.md](docs/TEST_RESULTS.md) — Full automated test execution evidence (61 passing tests).
- [DECISION_EXAMPLES.md](docs/DECISION_EXAMPLES.md) — Concrete decision explanation examples with rule traces and audit chains.
- [SCOREME_EVALUATION_MAPPING.md](docs/SCOREME_EVALUATION_MAPPING.md) — 1:1 mapping against the official 100-mark ScoreMe hackathon criteria.
- [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — Step-by-step 3-minute evaluator presentation script.
