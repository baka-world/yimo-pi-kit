# Experiment Matrix and Claim–Evidence Ledger

Use this template before committing significant compute, collecting results, or drafting a strong conclusion. It makes each experiment answer one question in the Defect → What → How → Why chain.

## 1. Experiment Matrix

```markdown
# Experiment Matrix

## Protocol identity
- PA-START artifact and verdict:
- Strongest direct predecessor / common protocol:
- Contribution classification: [replication | transfer | extension | combination | boundary correction | unresolved]
- Research question:
- Mother paper / baseline:
- Dataset/benchmark track: [official | derived/screened | internal | clean-room common]
- Frozen source/split/evaluator identities:
- Input visibility boundary:
- Model/training/retrieval/tool allowance:
- Primary metric and denominator:
- Secondary metrics:
- Repetitions/seeds or deterministic rationale:
- Budget limits:

| ID | Layer | Hypothesis / question | Baseline(s) | Intervention / control | Data/slice | Metric | Prediction before run | Decision rule | Required artifact |
|---|---|---|---|---|---|---|---|---|---|
| E0 | G1 | Can we reproduce the baseline? | paper baseline | reproduction | official split | paper metric | close/explainable | pass/revise G1 | logs + reproduction table |
| E1 | What | Does M improve the primary outcome? | B | B + M | full fixed split | primary metric | improvement | CI/effect decision | immutable run + scorer output |
| E2 | What/Why | Does improvement occur under defect condition P? | B | B + M | target slice P | slice metric | larger/relevant effect | predeclared slice test | slice table/curve |
| E3 | How | Is component A necessary? | B + M | B + M − A | same scope | primary + target metrics | effect decreases | ablation decision | ablation manifest |
| E4 | How | Is component B necessary? | B + M | B + M − B | same scope | primary + target metrics | effect decreases | ablation decision | ablation manifest |
| E5 | Why | Does predicted mechanism signature occur? | control | diagnostic intervention | mechanism slice | diagnostic metric | W | supports/weakens R | diagnostic plot/table |
| E6 | Boundary | Where does M fail or cost too much? | B | B + M | stress/budget domain | failure/cost | named boundary | report boundary | failure taxonomy/cost curve |
```

### Rules

- Predeclare the primary metric and target failure slice before the decisive run whenever possible.
- Never label an exploratory slice discovered post hoc as confirmatory without disclosure.
- Every row must identify a baseline/control. “Our full model versus nothing” does not establish a method effect.
- For model systems, state whether temperature, provider, endpoint, retries, reasoning tokens, retrieval, tools, prompts, and budgets are controlled.
- For a derived subset, include its fingerprint and explain why it cannot be treated as an official full benchmark score.

## 2. Main-result comparison table template

```markdown
| Method | Protocol/scope | Information/tools allowed | Primary metric | Target-slice metric | Invalid/violation rate | Cost/latency | Repetitions / CI | Notes |
|---|---|---|---:|---:|---:|---:|---|---|
| Mother-paper baseline |  |  |  |  |  |  |  |  |
| Strong external baseline |  |  |  |  |  |  |  |  |
| Ours / intervention |  |  |  |  |  |  |  |  |
```

## 3. Claim–Evidence Ledger

A paper claim must have a precise evidence path. A result table is not self-explanatory evidence for a broad conclusion.

```markdown
# Claim–Evidence Ledger

| Claim ID | Draft claim | Claim type | Strongest prior art / PA status | Required evidence | Artifact(s) | Scope / conditions | Counterevidence or limitation | Permitted wording | Status |
|---|---|---|---|---|---|---|---|---|---|
| C1 |  | What |  | matched main comparison |  |  |  |  | draft/verified/revise |
| C2 |  | How | ablation + method mapping |  |  |  |  | draft/verified/revise |
| C3 |  | Why | diagnostic/counterfactual evidence |  |  |  |  | draft/verified/revise |
| C4 |  | External validity | independent benchmark or setting |  |  |  |  | draft/verified/revise |
| C5 |  | Boundary | failures/negative conditions |  |  |  |  | draft/verified/revise |
```

### Claim types and evidence requirements

| Claim type | Minimum evidence |
|---|---|
| **What**: improves performance/quality/cost | fair common-protocol comparison; fixed denominator; uncertainty or repeated-run rationale |
| **How**: component contributes | ablation/replacement/control and defect-to-component mapping |
| **Why**: explains the effect | falsifiable prediction plus diagnostic, counterfactual, or mechanism evidence |
| **SOTA/best** | verified comparison set under same official protocol; dated and narrowly scoped |
| **Reproduction** | source implementation/protocol/result alignment, or precise adaptation wording |
| **External validity** | independent data/model/setting appropriate to the narrow capability claim |
| **Operational usefulness** | task-relevant cost/risk/human evaluation; benchmark accuracy alone is insufficient |

## 4. Result interpretation discipline

For each completed experiment, answer:

1. What did we observe exactly?
2. Which hypothesis does it support, weaken, or leave unresolved?
3. Did the actual result or method reveal a predecessor not covered by PA-START?
4. Is the contribution now replication, transfer, extension, combination, boundary correction, or unresolved?
5. What confound remains?
6. What claim does the result **not** support?
7. Which Gate and PA-CLOSE status change, if any?

Example:

> A higher strict task-gate rate supports the claim that the method satisfies the specified report contract more often on this frozen scope. It does not alone establish that the method is more factually useful in production, that its individual claim accuracy improved uniformly, or that it is SOTA on a different official benchmark.

## 5. Pre-run authorization block

```markdown
## Execution authorization
- Offline planning/audit authorized: [yes/no]
- Network/literature retrieval authorized: [yes/no]
- Model/provider/endpoint authorized: [yes/no; specify]
- Credential handling approved: [yes/no; local-only path]
- Training/tuning authorized: [yes/no]
- Pilot authorized: [yes/no; scope]
- Full run authorized: [yes/no; scope/budget]
- Publication/push authorized: [yes/no]
- Immutable output directory:
```

No missing authorization may be inferred from a request to “continue research.”
