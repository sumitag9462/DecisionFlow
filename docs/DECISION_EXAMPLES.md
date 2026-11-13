# Decision examples

These examples can be reproduced with the sample cards in the React UI. Fields not mentioned use the default example input.

| Scenario | Input changed | Rules matched | Decision | Reason |
| --- | --- | --- | --- | --- |
| Vendor approval | None | No terminal rule | `APPROVED` | Screening, verification and limits passed. |
| Vendor exclusion | `blacklisted: true` | `VEN-01` | `REJECTED` | Vendor is on the exclusion list. |
| Vendor documents missing | `documentsComplete: false` | `VEN-02` | `MANUAL_REVIEW` | Required documents are missing. |
| Vendor spend over limit | `annualSpend: 650000` | `VEN-04` | `MANUAL_REVIEW` | Annual spend requires a second approval. |
| Vendor provider timeout | `simulation: 'fail-once'` | Dependency stage fails | `RETRY_PENDING` then `APPROVED` after retry | External verification temporarily unavailable. |
| Claim inactive | `policyActive: false` | `CLM-01` | `REJECTED` | Policy is not active. |
| Claim high fraud score | `fraudScore: 75` | `CLM-03` | `MANUAL_REVIEW` | Fraud score requires an investigator. |
| Claim over limit | `claimAmount: 150000` | `CLM-04` | `MANUAL_REVIEW` | Claim exceeds auto-settlement limit. |
| Provider always down | `simulation: 'always-fail'` | Dependency fails 3 times | `FAILED` | Verification exhausted the retry budget. |

## Example: audit output for a successful approval

Events are stored with timestamps and actor details. The state changes are:

```text
REQUEST_RECEIVED    null       -> RECEIVED
ATTEMPT_STARTED     RECEIVED   -> PROCESSING
DECISION_RECORDED   PROCESSING -> APPROVED
```

The rule trace separately records all evaluated comparisons. For standard vendor approval, it includes:

```text
Attempt 1 | screening | VEN-01 | blacklisted       eq  true    | actual false  | not matched
Attempt 1 | screening | VEN-02 | documentsComplete eq  false   | actual true   | not matched
Attempt 1 | verification | simulated provider available       | OK
Attempt 1 | limits    | VEN-03 | riskScore         gte 70      | actual 19     | not matched
Attempt 1 | limits    | VEN-04 | annualSpend       gt  500000  | actual 150000 | not matched
Final: APPROVED | policy version 1 | attempts 1
```

## Rule-change example

Edit `VEN-04` from `500000` to `250000` and change config version from 1 to 2. A fresh vendor request with annual spend `350000` becomes `MANUAL_REVIEW` under version 2. Any saved version 1 request retains its old policy snapshot and decision trace.
