---
name: backend-engineering
description: Production backend engineering workflow for APIs, services, databases, queues, reliability, performance, observability, migrations, and testing. Use when designing, implementing, debugging, or reviewing server-side systems.
license: MIT
---

# Backend Engineering

## Workflow

1. Discover the repository's actual language, framework, conventions, build system, tests, migrations, and operational environment before proposing changes.
2. Define contracts first: request/response schemas, error model, authentication, authorization, idempotency, pagination, compatibility, and rate limits.
3. Trace data ownership and transaction boundaries. Identify consistency requirements, concurrency hazards, retry behavior, duplicate delivery, and failure recovery.
4. Design for bounded resources: deadlines, cancellation, connection pools, backpressure, queue limits, payload limits, streaming, and graceful shutdown.
5. Preserve observability: structured logs without secrets, metrics, traces, correlation IDs, health/readiness checks, and actionable errors.
6. For Postgres work, load `supabase-postgres-best-practices`; validate indexes and query plans rather than guessing.
7. Use Context7 for current framework/library documentation when local code or installed docs are insufficient.
8. Add tests at the cheapest reliable layer: unit tests for logic, integration tests for persistence/contracts, and end-to-end tests only for critical flows.
9. Make migrations backward compatible and include rollback/roll-forward strategy.

## MCP

- `context7`: current library/framework documentation.
- `semgrep`: defensive static analysis after implementation.
- `openalex`/academic servers are not relevant unless the backend implements scholarly workflows.

Access MCP through the `mcp` proxy; search and describe the required tool before calling it.

## Quality bar

- No hidden global state or unbounded work.
- Authentication is not authorization; enforce object/action-level authorization server-side.
- Retries require idempotency and jittered backoff.
- Never log credentials, tokens, raw personal data, or full payment data.
- Explain tradeoffs and operational consequences.
