---
name: security-engineering
description: Evidence-based application security review and secure design using OWASP ASVS, OWASP Cheat Sheet Series, threat modeling, dependency risk, secrets review, and Semgrep. Use for security architecture, code review, vulnerability triage, and remediation planning.
license: CC-BY-SA-4.0 references; local workflow text MIT-style permissive use
compatibility: Requires network access for current OWASP material; Semgrep MCP or CLI is optional.
---

# Security Engineering

Use a defensive, evidence-first workflow. Never claim a vulnerability without a concrete source location, data flow, configuration, reproducible test, or scanner finding.

## Workflow

1. Establish scope, assets, trust boundaries, attacker capabilities, sensitive data, and deployment assumptions.
2. Identify languages, frameworks, authentication/session model, authorization points, persistence, queues, uploads, outbound requests, deserialization, cryptography, secrets, CI/CD, and infrastructure.
3. Build a compact threat model using STRIDE where useful. Rank risks by exploitability, impact, exposure, and confidence.
4. Map important controls to a pinned OWASP ASVS version and level. Use OWASP Top 10 only as a taxonomy, not as a complete standard.
5. Consult the current OWASP Cheat Sheet Series for implementation guidance instead of relying on memory.
6. Run Semgrep when code is available. Treat scanner output as leads requiring source verification; report false positives explicitly.
7. Check dependency manifests, lock files, secret exposure, insecure defaults, logging of sensitive data, SSRF, injection, path traversal, unsafe deserialization, broken access control, race conditions, and supply-chain risks.
8. Propose minimally disruptive remediations, tests, compensating controls, and rollout/monitoring steps.

## Authoritative references

- OWASP ASVS: https://github.com/OWASP/ASVS
- OWASP Cheat Sheet Series: https://github.com/OWASP/CheatSheetSeries
- OWASP Top 10: https://github.com/OWASP/Top10
- OWASP Threat Dragon: https://github.com/OWASP/threat-dragon
- Semgrep rules and docs: https://semgrep.dev/docs/

## MCP/CLI

Prefer the `semgrep` MCP server through the `mcp` proxy. Search/describe tools before calling them. If MCP is unavailable, use the installed `semgrep-mcp`/Semgrep CLI through bash only after checking `--help`.

## Output

- Scope and assumptions
- Threat model / attack surface
- Critical findings, then high/medium/low findings
- Exact evidence with file and line references
- Exploit scenario and impact
- Remediation and verification test
- Residual risk and uncertainty
