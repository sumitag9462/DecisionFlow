# Trade-Offs and Architectural Defense

Engineering decisions in DecisionFlow were made deliberately to prioritize correctness, maintainability, determinism, and student defensibility under evaluation.

---

## 1. Why MongoDB instead of SQL?

The decision record has variable fields and variable-length evaluation traces across different workflows. MongoDB documents make it straightforward to persist the immutable policy snapshot, input data, rule trace, and append-only audit trail together. More importantly, MongoDB conditional updates allow state transitions and audit logging to be committed in a single atomic database write. PostgreSQL with JSONB would be the appropriate alternative if cross-table relational constraints or distributed multi-record ACID transactions were required.

---

## 2. Why one document for the decision, trace, and audit?

In distributed systems, updating state in one table/collection and writing an audit event in another introduces a dual-write failure mode (e.g. status updates to `APPROVED`, but the audit insert fails). By embedding `trace` and `audit` within the same document, a single atomic `findOneAndUpdate` commits both or neither.

**Trade-off acknowledged:** Document size grows with each attempt and audit event. While well within MongoDB's 16 MB BSON document limit for typical lifecycles (< 100 KB), a high-frequency system processing hundreds of events per request would stream historical events to an append-only log (e.g. Kafka or an indexed audit collection).

---

## 3. What if two requests arrive with the same key at the exact same millisecond?

A pre-insert `findOne` query is fundamentally susceptible to a Time-of-Check to Time-of-Use (TOCTOU) race condition. In DecisionFlow, atomicity is enforced at the database level by a unique compound index on `(workflowId, idempotencyKey)`. The second parallel insert fails with MongoDB error code `11000` (Duplicate Key). The losing worker catches `11000`, reads the winning record, and compares input payload hashes:
- If the payload matches: returns the winner's record with `200 OK` and `replayed: true`.
- If the payload differs: returns `409 IDEMPOTENCY_CONFLICT`.

Verified via automated test: 20 simultaneous intake requests yield exactly 1 insert and 19 cached replays.

---

## 4. Why check for idempotency replay before schema validation?

When a policy is upgraded (e.g. from version 1 to version 2) with a new mandatory field, an existing request created under version 1 might not contain that new field. If schema validation runs before the idempotency lookup, replaying the original request would fail with `400 INVALID_INPUT`, violating idempotency semantics. By checking `findByKey` first:
- An identical replay returns the stored version 1 record with `200 OK` and `replayed: true`.
- An altered payload returns `409 IDEMPOTENCY_CONFLICT`.
- Genuinely new submissions proceed to strict validation against the active version 2 schema.
- Concurrent initial submissions are still safely arbitrated by the compound unique index and `11000` catch block.

---

## 5. What happens if a worker crashes on its final allowed attempt?

If a worker crashes while processing attempt 3 of 3, the document is left in `status: 'PROCESSING'`. Once its 90-second lease expires, normal retries cannot run because the attempt budget is exhausted (`attempts >= maxAttempts`). Rather than leaving the document permanently orphaned in `PROCESSING`, the recovery logic detects this exact condition (`status === 'PROCESSING' && leaseUntil <= now && attempts >= maxAttempts`) and atomically transitions the record to `FAILED` with an auditable `CRASH_RECOVERY` event. Repeated recovery requests cannot duplicate this transition.

---

## 6. What if two users click retry at the exact same moment?

The repository uses an atomic compare-and-set update filtered by the last observed status and attempt count (`attempts: record.attempts`). Only one worker advances the attempt counter and acquires the 90-second lease. The second worker fails the filter and receives `409 IN_PROGRESS` (or `409 NOT_RETRIABLE` if terminal). Arbitration is enforced at the database layer, not merely in Node.js process memory.

---

## 7. Why zero-dependency native authentication instead of `jsonwebtoken` and `bcrypt`?

Rather than pulling in external npm dependencies that introduce prototype pollution vulnerabilities, dependency bloat, and supply-chain attack vectors:
- **JWT:** Implemented via standard Node.js `node:crypto` using `crypto.createHmac('sha256', secret)` according to RFC 7519.
- **Password Hashing:** Implemented via Node.js built-in `crypto.scryptSync(password, salt, 32)`, providing cryptographic key derivation without native C++ compilation bindings.
- **Interview Defense:** Demonstrates a fundamental understanding of cryptographic tokens, HMAC signatures, and salt hashing over framework abstractions.

---

## 8. Why in-memory What-If simulation instead of test database records?

Writing "test" or "draft" records with a flag (e.g. `isSimulation: true`) into production databases introduces serious risks:
- Clutters indexes and risks polluting analytical aggregates and reporting queries.
- Potential data leakage across tenants.
- Slower latency due to disk I/O.

DecisionFlow's simulator clones the policy definition in memory, applies proposed threshold overrides, and runs the pure `runWorkflow` engine in-memory. This provides a mathematical **Zero-Mutation Guarantee**—production MongoDB is never touched.

---

## 9. Why MongoDB CAS leases instead of Redis distributed locks (Redlock)?

Adding Redis would introduce a second stateful infrastructure component, operational failure points, split-brain cluster synchronization edge cases, and additional port requirements. MongoDB's atomic `findOneAndUpdate` with lease timestamps (`leaseUntil`) provides resilient distributed leasing with zero extra infrastructure.

---

## 10. Why `npm audit fix --force` was intentionally rejected?

Running `npm audit` reports 6 low-severity prototype poisoning vulnerabilities in Jest's transitive dependency `deepmerge`. Running `npm audit fix --force` would downgrade Jest from v29 to v25.1.0, breaking the test runner. Since Jest is strictly a development tool (`devDependencies`) and never runs in production runtime, downgrading core testing infrastructure to eliminate a low-severity dev-time alert is an engineering anti-pattern. This is documented and defended.

---

## 11. Known Future Production Scope

Deliberate scope boundaries retained for student defensibility:
- **Background Job Queue:** Retries are currently triggered via API calls; a high-volume production system would integrate a persistent queue (e.g. BullMQ / SQS) with automatic jittered exponential backoff.
- **External Provider Outbound Idempotency:** The simulated verification adapter is read-only. In a real banking payment gateway, outbound HTTP requests must pass their own upstream idempotency keys to prevent double-charging on network dropouts.
