# Decision Explanation Examples & Audit Traces

This document provides concrete, reproducible examples demonstrating DecisionFlow's explainability, deterministic rule evaluation, state transitions, and cryptographic audit chaining as required by the ScoreMe Hackathon assignment.

All examples can be tested directly via the React Decision Studio UI (Quick Presets) or executed via REST API calls.

---

## Example 1: Standard Vendor Onboarding (Clean Approval)

### 1.1 Input Payload (`POST /api/requests`)
```json
{
  "workflowId": "vendor-approval",
  "idempotencyKey": "req-vendor-clean-001",
  "data": {
    "vendorName": "Northwind Supplies Ltd",
    "annualSpend": 150000,
    "riskScore": 19,
    "blacklisted": false,
    "documentsComplete": true
  },
  "simulation": "ok"
}
```

### 1.2 Step-by-Step Rule Evaluation Trace
Every rule is evaluated in sequence. Even non-matching rules are logged to provide a full negative proof ledger:

| Attempt | Stage | Rule ID | Fact Evaluated | Operator | Expected | Actual | Matched? | Outcome / Reason |
|:---:|:---|:---:|:---|:---:|:---:|:---:|:---:|:---|
| 1 | `screening` | `VEN-01` | `blacklisted` | `eq` | `true` | `false` | **No** | Condition not met |
| 1 | `screening` | `VEN-02` | `documentsComplete` | `eq` | `false` | `true` | **No** | Condition not met |
| 1 | `verification` | — | Compliance Service | — | — | `SIM-VENDOR-APPROVAL-1` | **Yes** | Provider returned HTTP 200 (OK) |
| 1 | `limits` | `VEN-03` | `riskScore` | `gte` | `70` | `19` | **No** | Condition not met |
| 1 | `limits` | `VEN-04` | `annualSpend` | `gt` | `500000` | `150000` | **No** | Condition not met |

### 1.3 Output Verdict
- **Status:** `APPROVED`
- **Matched Rule:** `null` (Clean automated pass through default policy)
- **Decision Reason:** `"Screening, verification and limits passed."`
- **Attempts Consumed:** `1 / 3`

### 1.4 Cryptographic Audit Trail
Each event links to the preceding event's SHA-256 hash, anchored at `GENESIS_HASH`:
```text
Event 0 [REQUEST_RECEIVED]:
  prevHash : 0000000000000000000000000000000000000000000000000000000000000000
  hash     : a1f8b29... (null -> RECEIVED | actor: api)
Event 1 [ATTEMPT_STARTED]:
  prevHash : a1f8b29...
  hash     : e47c9d1... (RECEIVED -> PROCESSING | actor: system | attempt: 1)
Event 2 [DECISION_RECORDED]:
  prevHash : e47c9d1...
  hash     : 8b02fc4... (PROCESSING -> APPROVED | actor: system | attempt: 1)
```

---

## Example 2: Immediate Exclusion Short-Circuit (Zero Wasted Calls)

### 2.1 Input Payload
```json
{
  "workflowId": "vendor-approval",
  "idempotencyKey": "req-vendor-blacklist-002",
  "data": {
    "vendorName": "Sanctioned Trading Corp",
    "annualSpend": 80000,
    "riskScore": 25,
    "blacklisted": true,
    "documentsComplete": true
  },
  "simulation": "always-fail"
}
```

### 2.2 Rule Trace & Short-Circuit Proof
`VEN-01` matches immediately in Stage 1 (`screening`). The engine halts execution before reaching the `verification` dependency stage, ensuring zero wasted external API calls:

```text
Attempt 1 | Stage: screening | Rule: VEN-01 (blacklisted eq true) -> MATCHED!
Stage 2 (verification) -> SKIPPED (short-circuit on terminal outcome)
Stage 3 (limits)       -> SKIPPED
```

### 2.3 Output Verdict
- **Status:** `REJECTED`
- **Matched Rule:** `VEN-01`
- **Decision Reason:** `"Vendor is on the exclusion list."`
- **External Dependency Calls:** `0` (Zero egress cost / zero latency)

---

## Example 3: Manual Review Escalation & Human Sign-Off

### 3.1 Input Payload (High Spend)
```json
{
  "workflowId": "vendor-approval",
  "idempotencyKey": "req-vendor-highspend-003",
  "data": {
    "vendorName": "Global Industrial Machinery",
    "annualSpend": 650000,
    "riskScore": 22,
    "blacklisted": false,
    "documentsComplete": true
  }
}
```

### 3.2 Evaluation Result
- Stage 1 (`screening`): Passed
- Stage 2 (`verification`): Passed
- Stage 3 (`limits`): `VEN-04` triggers because `annualSpend` (₹650,000) > threshold (₹500,000).
- **Status:** `MANUAL_REVIEW`
- **Reason:** `"Annual spend requires a second approval."`

### 3.3 Human Review Resolution (`POST /api/requests/:id/review`)
An authorized reviewer inspects the decision trace in the Decision Explorer and submits sign-off:
```json
{
  "decision": "APPROVED",
  "reason": "Executive procurement board approved high spend on 2026-11-13."
}
```
*Note: The reviewer identity is automatically derived from the authenticated JWT token (`Bob Reviewer` with role `REVIEWER`). Unauthenticated callers receive 401; users with role `VIEWER` receive 403 Forbidden.*

### 3.4 Final State & Audit Entry
- **Final Status:** `APPROVED`
- **Audit Event Appended:**
  ```json
  {
    "type": "MANUAL_REVIEW_COMPLETED",
    "from": "MANUAL_REVIEW",
    "to": "APPROVED",
    "actor": "Bob Reviewer",
    "detail": { "reason": "Executive procurement board approved high spend on 2026-11-13." }
  }
  ```

---

## Example 4: Transient Dependency Flap & Exponential Backoff

### 4.1 Input Payload (Transient 503 Flap)
```json
{
  "workflowId": "vendor-approval",
  "idempotencyKey": "req-vendor-flap-004",
  "data": {
    "vendorName": "Pacific Maritime",
    "annualSpend": 120000,
    "riskScore": 18,
    "blacklisted": false,
    "documentsComplete": true
  },
  "simulation": "fail-once"
}
```

### 4.2 Lifecycle Progression
1. **Attempt 1:** The simulated compliance verification returns 503 (`TEMPORARY_FAILURE`).
   - Status transitions to `RETRY_PENDING`.
   - Engine calculates exponential backoff: `nextRetryAt = now + 1000ms`.
2. **Premature Retry Attempt:** Calling `POST /api/requests/:id/retry` before 1 second elapses:
   - Rejected with **HTTP 429 (`RETRY_TOO_EARLY`)**:
   - `"Retry is not eligible until 2026-11-13T12:22:05Z (1s remaining)"`
3. **Eligible Retry Attempt:** Calling retry after 1.2 seconds:
   - Worker claims the record atomically (`findOneAndUpdate`).
   - Attempt 2 runs verification -> returns `OK` (`SIM-VENDOR-APPROVAL-2`).
   - Status resolves to `APPROVED` on attempt 2.

---

## Example 5: Insurance Claim Processing (Fraud Risk Escalation)

### 5.1 Input Payload
```json
{
  "workflowId": "claim-processing",
  "idempotencyKey": "req-claim-fraud-005",
  "data": {
    "claimReference": "CLM-2026-888",
    "claimAmount": 35000,
    "policyActive": true,
    "documentsComplete": true,
    "fraudScore": 75
  }
}
```

### 5.2 Evaluation Outcome
- Stage 1 (`eligibility`): `policyActive === true`, `documentsComplete === true` -> Passed.
- Stage 2 (`verification`): External policy verification adapter -> Passed.
- Stage 3 (`claim-limits`):
  - `CLM-03`: `fraudScore >= 60`. Fact is `75`. **Condition matched!**
- **Status:** `MANUAL_REVIEW`
- **Matched Rule:** `CLM-03`
- **Reason:** `"Fraud score requires an investigator."`

---

## Example 6: Policy Version Change & Immutability Guarantee

1. **Record Created under Policy v1:**
   - Threshold for `VEN-04` is ₹500,000.
   - Request with `annualSpend: 350000` is **`APPROVED`**.
   - Entire policy snapshot is saved immutably inside the MongoDB document (`policySnapshot.version: 1`).
2. **Policy Administrator Updates Policy to v2:**
   - Lowers `VEN-04` threshold to ₹250,000 and bumps version to 2.
3. **Fresh Intake Request under Policy v2:**
   - Request with `annualSpend: 350000` now triggers `VEN-04` -> **`MANUAL_REVIEW`**.
4. **Historical Record Inspection:**
   - The original v1 record fetched from the database still displays **`APPROVED`**, pinned to its v1 snapshot and trace. Historical decisions are never silently re-evaluated or altered by future policy bumps.
