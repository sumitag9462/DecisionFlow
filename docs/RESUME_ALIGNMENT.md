# How this project fits my existing work

The assignment is a backend engineering exercise, so I used the tools I already know instead of adding a new framework for its own sake.

| Existing experience | Application in DecisionFlow |
| --- | --- |
| React / JavaScript | Request form, saved records, audit and rule-trace viewer |
| Node.js / Express / REST APIs | Request intake, retries, reviewer action and workflow metadata endpoints |
| MongoDB / Mongoose | Persisted decisions, versioned policy snapshot, compound unique index |
| Atomic MongoDB updates | Preventing two workers from claiming the same retry (similar concurrency concern to one-time links) |
| Jest / Supertest | Express API tests, plus dependency-free core tests |
| Postman | Importable request collection under `examples/` |

I did **not** add Gemini/AI-generated decisions. This is a rule-based system where every outcome should be deterministic and explainable. The prompt allows AI as a coding aid; it doesn't require AI inference in the product.

If asked to explain the contribution: "I separated the rules from execution, used MongoDB atomic updates for consistent state and audit history, and tested the failure/retry paths. I chose this design because the exercise rewards correctness under changing requirements more than a large feature set."
