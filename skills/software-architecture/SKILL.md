---
name: software-architecture
description: Technology-neutral software architecture workflow covering requirements, constraints, quality attributes, boundaries, data ownership, integration, reliability, security, operations, evolutionary design, and ADRs. Use for system design and architecture review.
license: MIT
---

# Software Architecture

Use the installed `cloud-solution-architect` skill as a pattern catalog, but remain vendor-neutral unless the project is explicitly Azure-based.

## Workflow

1. Capture functional scope, actors, constraints, existing estate, team topology, compliance, budget, and delivery timeline.
2. Quantify quality attributes: availability/SLO, latency percentiles, throughput, durability, RTO/RPO, consistency, security, privacy, operability, portability, and cost.
3. Draw the system context and container boundaries. Identify trust boundaries, data ownership, synchronous and asynchronous integrations, external dependencies, and failure domains.
4. Select the simplest architecture that satisfies measured requirements. Do not default to microservices, event sourcing, CQRS, Kubernetes, or multi-region deployment.
5. Analyze tradeoffs under failure: partial outages, retries, duplicate messages, stale reads, hot partitions, dependency latency, deploy rollback, schema evolution, and disaster recovery.
6. Address observability, release strategy, migration, capacity, cost, security, and organizational ownership.
7. Record consequential choices as Architecture Decision Records with context, alternatives, decision, consequences, and revisit triggers.
8. Produce incremental implementation stages and identify reversible versus irreversible decisions.

## Evidence and MCP

- Use Context7 for current technology documentation.
- Use GitHub tooling only when configured by the user; do not require it for local repositories.
- Use Semgrep/security review for architecture-sensitive implementation risks.

## Output

- Assumptions and open questions
- Context/container/data-flow view
- Recommended design
- Alternatives and tradeoff matrix
- Failure modes and mitigations
- Security and privacy boundaries
- Deployment, operations, migration, and cost
- ADR list and validation plan
