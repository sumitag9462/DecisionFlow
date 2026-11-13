# Evaluator Presentation & Demo Script (3–5 Minutes)

### Opening (30 Seconds)
"DecisionFlow is a configurable workflow decision platform built with React, Express, and MongoDB for the ScoreMe Placement Hackathon. Instead of hardcoding separate logic for vendor approvals and insurance claims, both workflows execute on the exact same generic rule engine driven by declarative JSON configuration. I focused specifically on enterprise reliability: zero-duplication concurrency, cryptographic audit chaining, non-destructive policy simulation, and distributed edge-case recovery."

---

### Step 1: Clean Decision & Visual Stage Tracker (45 Seconds)
1. Open the UI at `http://localhost:5173`.
2. Under **Decision Studio**, select **Vendor approval** → Click the preset **Standard Approval** → Click **Run Decision Engine**.
3. Point out:
   - **Verdict:** `APPROVED` in 1 attempt.
   - **Visual Stage Pipeline:** Show the 4 sequential stage pills: `1. Initial Screening (PASSED)` → `2. Compliance Service (PASSED)` → `3. Risk and Spend Limits (PASSED)`.
   - **Rule Trace:** Every evaluated expression is logged with actual vs expected values.
   - **Cryptographic Audit Trail:** Show that each event carries a `prevHash` and a `hash` starting from the SHA-256 genesis anchor.
   - Click **🛡️ Verify Audit Hash Chain** → Observe: `✅ Ledger Intact: 3 audit events chained via SHA-256 genesis hashes`.

---

### Step 2: RBAC & Manual Exception Review (45 Seconds)
1. Select preset **Manual Review (Spend)** (`annualSpend: 650000`) → Click **Run Decision Engine**.
2. Result is routed to `MANUAL_REVIEW` due to rule `VEN-04`.
3. In the topbar role dropdown, switch to **Charlie Viewer (VIEWER)**.
4. Show that the review action buttons are locked with an alert: `🔒 Read-Only Mode: Current role VIEWER does not have permission to review requests`.
5. Switch role back to **Bob Reviewer (REVIEWER)**.
6. Enter reviewer reason: `Audited financial statements and signed offline waiver` → Click **Approve Request**.
7. Status immediately updates to `APPROVED` with `MANUAL_REVIEW_COMPLETED` appended to the hash chain.

---

### Step 3: What-If Policy Impact Simulator (45 Seconds)
1. Switch to the **🧪 What-If Simulator** tab.
2. Select **Vendor Approval**.
3. Explain: *"Suppose management wants to lower the annual spend review threshold from ₹500,000 to ₹250,000."*
4. Drag the **Rule VEN-04: Annual Spend Ceiling** slider down to **₹250,000**.
5. Set test payload annual spend to **₹300,000**.
6. Click **Execute What-If Comparison**.
7. Point out:
   - **Baseline Card:** `APPROVED` under Active v1.
   - **Simulated Card:** `MANUAL_REVIEW` under Proposed v1.sim.
   - **Diff Banner:** `⚠️ Policy Impact Shift Detected: Outcome shifted from APPROVED to MANUAL_REVIEW`.
   - **Zero-Mutation Sandbox:** Highlight that zero records were written to MongoDB during this simulation.

---

### Step 4: Distributed Fault Recovery & Reliability Lab (45 Seconds)
1. Switch to the **🔬 Reliability & Fault Lab** tab.
2. Click **Run Transient Flap Test**:
   - Console logs the initial 503 downstream provider timeout (`RETRY_PENDING`).
   - Automatically triggers the retry worker, transitioning cleanly to `APPROVED` (Attempt 2).
3. Click **Run 20-Worker Race**:
   - Fires 20 simultaneous HTTP POST requests with identical idempotency keys.
   - Console confirms: `Created=1, Replayed=19, Unique MongoDB IDs=1`.
   - Zero duplication guaranteed by MongoDB compound unique index.

---

### Step 5: Certified Evidence Packet Export (30 Seconds)
1. Switch back to **Decision Studio**.
2. Click **📜 Download Certified Evidence (.json)**.
3. Open the downloaded JSON:
   - Highlight `certificateId`, `issuer`, SHA-256 `payloadFingerprint`, `auditChainIntact: true`, frozen `policySnapshot`, and complete evaluation trace.

---

### Concluding Summary (30 Seconds)
"DecisionFlow demonstrates that a pure MERN architecture without heavy orchestration libraries can achieve high-grade financial correctness. It is backed by **56 passing automated tests**: 26 Node core tests, 14 Jest HTTP tests, and 16 real MongoDB integration tests. It handles edge cases like worker crashes on final attempts and schema evolution replays safely."

---

### Questions Worth Preparing For

- **Q: Why check for idempotency before schema validation?**  
  *A: If a policy adds a new required field in v2, an existing v1 request wouldn't have it. Checking `findByKey` first guarantees that historical submissions can still be replayed without failing validation.*

- **Q: What happens if a worker crashes on its final allowed retry?**  
  *A: When the lease expires, attempts are already at maxAttempts. DecisionFlow's `forceFailExpiredFinal` atomically transitions the record to `FAILED` with a `CRASH_RECOVERY` audit event.*

- **Q: Why use native Node.js crypto for JWT and auth instead of npm packages?**  
  *A: Zero supply-chain attack surfaces, no dependency bloat, and defensible mastery of RFC 7519 standards and HMAC SHA-256 algorithms.*
