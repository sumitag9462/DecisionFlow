# Submission Checklist — DecisionFlow MERN

Before submitting the repository for the ScoreMe Hackathon, verify each item:

- [x] **MongoDB running:** MongoDB Community Server (v8.x) running locally on port 27017 or MongoDB Atlas connection configured.
- [x] **Backend dependencies installed:** `cd backend && npm install`.
- [x] **Core unit test suite passing:** `cd backend && npm run test:core` (28/28 tests passing).
- [x] **HTTP API test suite passing:** `cd backend && npm test` (17/17 tests passing).
- [x] **Real MongoDB integration test suite passing:** `cd backend && npm run test:integration` (16/16 tests passing against real mongod, fail-closed, 0 skipped).
- [x] **Total automated tests passing:** 61/61 tests passing across 3 test suites.
- [x] **Frontend production build:** `cd frontend && npm install && npm run build` (builds cleanly without errors or warnings, 36 modules).
- [x] **All edge cases & bug fixes verified:**
  - Idempotency replay works across policy schema version bumps.
  - Crashed worker on final attempt recovers safely to `FAILED` with audit entry.
  - Premature retry during exponential backoff window rejected with HTTP 429 (`RETRY_TOO_EARLY`).
  - What-If simulator defends against prototype pollution (`__proto__`, `constructor`) and type mismatches with HTTP 400.
  - Audit verification fails closed on missing/malformed hashes, detects tampering, and flags legacy unhashed records as `UNVERIFIABLE_LEGACY`.
- [x] **Security & Authentication fixes verified:**
  - `X-Demo-Role` header completely removed; privilege spoofing eliminated.
  - Zero-dependency RFC 7519 HMAC-SHA256 JWT tokens with strict algorithm header check (`HS256`, `typ: JWT`).
  - Passwords hashed using Node.js `crypto.scryptSync`.
  - Manual review route protected by `requireRole('REVIEWER', 'ADMIN')`; VIEWER blocked with HTTP 403.
  - Reviewer signature strictly derived from verified server-side JWT context (`req.user.name`), ignoring client request body.
  - No `.env` or database credentials committed (`.gitignore` verified).
  - JSON body limit enforced at 64 KB, security headers (`nosniff`, `DENY`, `1; mode=block`, `X-Request-ID`).
  - 500 error stack traces suppressed from client API responses.
- [x] **Clean startup:** Backend boots cleanly (`node server.js`) and logs MongoDB readiness.
- [x] **Interactive UI flows verified:**
  - Vendor standard approval (`APPROVED`)
  - Vendor exclusion check (`REJECTED`)
  - Vendor spend limit review (`MANUAL_REVIEW`) and resolution
  - Dependency failure (`fail-once` -> `RETRY_PENDING`) and successful retry
  - Idempotent replay (`replayed: true`)
  - Conflicting payload with existing key (`409 IDEMPOTENCY_CONFLICT`)
  - Insurance claim eligibility and synchronized fraud/claim thresholds (CLM-03 >= 60, CLM-04 > 100,000)
  - Decision Explorer fetches complete record on inspection (`trace`, `audit`, `policySnapshot`)
  - Request History features server-side pagination (`?paginated=true&limit=25&page=X`)
- [x] **Documentation up to date:**
  - `README.md`: Verified commands, architecture summary, and trade-offs.
  - `docs/ARCHITECTURE.md`: Up to date with final state machine, atomicity guarantees, and cryptographic chaining.
  - `docs/TRADEOFFS.md`: Explains database and idempotency design choices.
  - `docs/TEST_RESULTS.md`: Contains verified counts from actual test executions (59 passing tests).
  - `docs/REVIEW_FIXES.md`: Detailed engineering audit log of all fixes and tests.
- [ ] **Final step:** Push repository to a public GitHub repository (ask user for explicit permission first).
- [ ] **Email submission:** Send email to `it@scoreme.in` with the subject:
  `assignment_mnnit_scoreme_<rollno>` (replace `<rollno>` with your actual roll number in lowercase).
