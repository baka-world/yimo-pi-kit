# Scope, Benchmark, and Comparability Boundaries

This guide prevents an otherwise careful research program from making claims that its protocol cannot support.

## 1. Separate the unit being evaluated

Before selecting a benchmark or writing a result sentence, name the capability unit exactly.

Examples:

| Unit | Legitimate evidence source | Does **not** automatically establish |
|---|---|---|
| CWE mapping from a vulnerability description | a fixed CWE-mapping benchmark | evidence-backed report generation, compliance validity, or SOC utility |
| CVSS prediction | a fixed CVSS benchmark | organizational risk prioritization or policy compliance |
| ATT&CK extraction | technique-label benchmark | full CTI analytic quality or attribution validity |
| Structured report fields | schema/field correctness test | evidence support, authorization, decision quality |
| Claim-to-evidence report validity | deterministic report verifier + evidence contract | broad cybersecurity capability or human operational effectiveness |
| Tool-using patch/CTF success | executable task benchmark | CTI reporting or governance/compliance quality |

A multi-part system may be tested on several units, but do not merge the resulting scores into a claim that no individual test measured.

## 2. Four protocol tracks

Keep these tracks physically and rhetorically separate.

### A. Official benchmark protocol

The released task scope, split, inputs, evaluator, and metric defined by the benchmark authors.

May support a qualified comparison with published work only if the same protocol and conditions are used.

### B. Derived or screened subset

A subset or transformed scope created to address leakage, safety, visibility, licensing, quality, or deployment constraints.

Must have:

- a new name, never silently reuse the official benchmark name as if scope were unchanged;
- explicit inclusion/exclusion rules;
- a frozen source identity and subset fingerprint;
- a distinct input/evaluator artifact identity;
- separate tables/figures from official results;
- a sentence stating why it is not directly comparable to official full-protocol results.

A derived subset may be scientifically stronger for its narrower question, but it does **not** become the official leaderboard protocol.

### C. Clean-room faithful adaptation

An independently implemented method inspired by a published system when direct reuse/reproduction is infeasible or inappropriate.

Must disclose:

- what published behavior/protocol was preserved;
- what was changed, including output contract, evaluator, data, model, budget, or retrieval environment;
- why exact reproduction is unavailable;
- the shared common-protocol comparison actually being made.

Use `faithful adaptation`, `clean-room adaptation`, or similarly precise wording—not `official implementation`, `exact reproduction`, or direct superiority over the historical paper unless that is actually true.

### D. Internal benchmark / task framework

A benchmark built by the current research project.

It can establish the project’s core task under its own validated protocol. It needs transparent construction, verifier, split, provenance, and limitations; it cannot by itself establish broad external generality.

## 3. Comparability checklist

A comparison is direct only when the following are materially aligned or explicitly accounted for:

| Dimension | Questions |
|---|---|
| Task definition | Same prediction/decision/report unit and acceptance criteria? |
| Population/split | Same data snapshot, rows, temporal range, filtering, and holdout? |
| Input visibility | Same information available to each method? Any labels, identifiers, retrieval handles, demos, tools, or metadata asymmetry? |
| Method allowance | Same tuning, training data, retrieval, tools, self-refinement, verifier feedback, and human assistance rules? |
| Model/compute budget | Same or disclosed model identity, endpoint, temperature, token/step limit, retries, latency and cost budget? |
| Evaluator | Same fixed scorer/version and error handling? |
| Denominator | Same expected instances; same treatment of missing, invalid, duplicate, abstained, or malformed outputs? |
| Statistical protocol | Same seed/repetition rule and uncertainty method? |
| Artifact provenance | Frozen source/evaluator/prediction identities and no hidden working-tree mutations? |

If a dimension differs, do one of the following:

1. align it;
2. add a matched condition;
3. report it as a separate non-direct comparison; or
4. remove the superiority/SOTA claim.

## 4. Claim vocabulary

Use the narrowest accurate term. Novelty and absence claims require a separate PA-START/PA-CLOSE record; protocol comparability alone does not establish originality.

| Phrase | Minimum evidence required | Safer alternative if incomplete |
|---|---|---|
| `official benchmark result` | released full protocol and official evaluator/metric | `result on a derived subset` |
| `SOTA` | verified current comparison set under the same official protocol, with a date/scope | `best audited comparable result in our comparison set` |
| `leaderboard SOTA` | official leaderboard rules, submission, and accepted listing | `outperforms the audited published baselines we evaluated` |
| `reproduction` | materially matches source implementation/protocol/results | `independent reimplementation` or `faithful adaptation` |
| `outperforms Paper X` | direct same-protocol comparison | `outperforms an adaptation/baseline under the common protocol` |
| `generalizes` | multiple independent domains/settings with a stated generalization rule | `shows evidence in the evaluated settings` |
| `robust` | predeclared stress conditions and appropriately bounded outcomes | `is more resilient under the tested perturbations` |
| `causes` / mechanism claim | intervention plus diagnostic/counterfactual support | `is consistent with the proposed mechanism` |

Avoid bare “SOTA,” “robust,” “general,” “production-ready,” “industry-standard,” or “solves” language unless the evidence matches the full implication.

For prior-art positioning, prefer:

- `replicates X under Y`;
- `transfers X from A to B`;
- `extends X with Z`;
- `combines established components under a new executable contract`;
- `provides a counterexample or boundary correction to assumption Q`;
- `not located in the audited corpus`.

Do not promote `not located` to `does not exist`, and do not call a combination novel unless every constituent and the claimed integration/evaluation unit have been compared against the strongest located predecessors.

## 5. Leakage and information-boundary audit

A public dataset can still invalidate a test if the model sees answer-adjacent information or an external lookup route that changes the intended task.

### Audit targets

Inspect at least:

- ground-truth labels, aliases, and label-like strings;
- entity identifiers such as CVE/CWE/ATT&CK IDs when the task is intended to infer them without lookup;
- URLs, hostnames, IPs, filenames, ticket IDs, hashes, and other retrieval handles;
- source descriptions that encode the answer;
- train/dev/demo/test overlap;
- evaluation notebook assumptions;
- published response artifacts that expose labels or rowwise correctness;
- retrieval corpus and tools available to each method.

### Policy choices

There is no universal rule that identifiers must always be removed. The policy must match the research question.

- If the intended application includes authorized retrieval using identifiers, retaining them may be valid—but every method must receive equivalent retrieval access and the claim is about retrieval-enabled performance.
- If the question is semantic inference from text alone, identifiers and retrieval routes may be confounds. A screened subset or a controlled no-retrieval track can be valid.
- If a screened subset is created, it is a new protocol and must not be presented as the official full benchmark.

### Generator/scorer isolation

For label-sensitive settings, preserve a real trust boundary:

```text
Untrusted generator: task ID + permitted input only
Trusted scorer: source rows + gold + task mapping + evaluator
```

Task IDs are identifiers, not access control. Prevent access through process/filesystem boundaries, artifact handling, and explicit procedures.

## 6. Dual-track pattern: official comparability plus validity stress test

When a benchmark includes possible leakage or other validity concern, the strongest design may use two separate tracks:

| Track | Question | Required wording |
|---|---|---|
| Official full protocol | How does the method compare under the released benchmark definition? | `official/released protocol result` if conditions truly match |
| Strict/screened protocol | Does performance persist when specified leakage or retrieval routes are removed? | `derived/screened subset result`, never official leaderboard score |

The two tracks answer different questions. A performance gap is an informative finding, not necessarily an embarrassment.

## 7. Report-generation systems and component benchmarks

For systems that generate evidence-backed reports, distinguish at least:

1. **domain inference** — e.g., CWE mapping or CVSS estimation;
2. **report structure** — required fields, types, and relationships;
3. **claim value correctness**;
4. **claim coverage and authorization**;
5. **evidence binding / provenance**;
6. **report-level acceptance under a deterministic gate**;
7. **human/operational criterion validity**.

A strong result on item 1 is useful external validation of a component. It does not establish items 2–7.

Likewise, a high average claim score can coexist with low report-level pass rate when all required claims must jointly be correct. Report both rather than using one metric to hide the other.

## 8. Immutable artifacts and provenance

For consequential public-benchmark results, record:

- source repository/release/commit or immutable archive identity;
- canonical file hashes;
- exact splits and filters;
- prompt/input schema and fingerprint;
- model/provider/endpoint identity as returned by the system where possible;
- controls such as temperature, reasoning mode, budget, retries, and tool availability;
- evaluator/scorer version and hash;
- coverage and invalid-output treatment;
- raw outputs or privacy-safe integrity evidence;
- fresh verification result;
- authorizations and no-network/no-model boundaries for audit-only stages.

Do not overwrite a prior audit or run to accommodate a changed matcher, filter, schema, evaluator, or policy. Seal a new artifact and explain its relationship to the prior one.

## 9. Result-sentence templates

### Official protocol

> Under the released [benchmark/task] protocol, using [evaluator], [method] achieves [metric], compared with [identified comparable baselines]. This statement is limited to [task capability].

### Derived subset

> On a separately specified [name] derived subset that excludes [rule], [method] achieves [metric] under [scorer]. This is not an official [benchmark] full-protocol or leaderboard result.

### Clean-room adaptation

> We implement a clean-room [source]-style faithful adaptation under a common frozen [task/output/evaluator] protocol. The result compares methods within this common protocol and is not an exact reproduction of the source paper’s original evaluation.

### Component to system boundary

> This external [component] result supports [narrow capability]; it does not validate end-to-end [report/evidence/operational] performance.
