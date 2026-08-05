---
name: public-dataset-research-sop
description: Designs, audits, and writes public-dataset research through a gated Defect → What → How → Why → Ideas → Release workflow. Use when selecting a mother paper or baseline, reproducing published work, diagnosing baseline failures, designing an intervention, planning ablations and robustness tests, evaluating benchmark/SOTA claims, or preparing a reproducible dataset-based paper.
metadata:
  version: 1.0.0
  language: zh-CN
  scope: research-methodology
---

# Public-Dataset Research SOP

Use this skill to turn a vague topic or a benchmark score into a defensible research program. The unit of progress is **a verifiable research artifact that passes a Gate**, not an attractive method name or a single favorable result.

## Core production loop

```text
Baseline defect → What → How → Why → Ideas → Release
```

- **Defect:** find a reproducible, interpretable, intervenable failure mechanism in a strong baseline.
- **What:** establish that an intervention improves the intended outcome under a fair, auditable comparison.
- **How:** describe a reproducible intervention whose components each address a diagnosed defect.
- **Why:** state and test a falsifiable explanation connecting the failure, intervention, and observed effect.
- **Ideas:** formulate the scholarly advance and its explicit opponent sentence.
- **Release:** preserve the data, code, configurations, results, limits, licenses, and provenance needed to inspect the claim.

The **research execution order** is the loop above. The usual **paper presentation order** is:

```text
Why → Problem → How → What → Contributions
```

Do not reverse the execution order merely because the paper will be written in the latter order.

## First response protocol

1. Identify the requested stage: `G0 mother-paper selection`, `G1 reproduction`, `G2 defect diagnosis`, `G3 What`, `G4 How`, `G5 Why`, `G6 submission/release`, or `full planning`.
2. State what is known, unknown, and prohibited by the user's execution boundary.
3. Read [the Gate and artifact guide](references/gates-and-artifacts.md) before making a research recommendation.
4. Open or verify the stage's **PA-START Prior-Art Gate** before implementation, data collection, or strong gap language. Decompose the proposed contribution into finding, technical primitive, evaluation protocol, and artifact/release claims.
5. Read [the research-card templates](templates/research-cards.md) whenever selecting a baseline, diagnosing a failure, designing a method, or closing a Prior-Art Gate.
6. For benchmark, leaderboard, subtask, leakage, reporting-system, or novelty claims, also read [the scope-boundary guide](references/scope-and-comparability.md).
7. Produce the smallest missing artifact first. Do not jump to full experiments, paper prose, or SOTA claims.

When fresh literature discovery is required, use a source-verification workflow and distinguish verified metadata from unverified claims. When the user requests paper drafting or review, pair this skill with the applicable academic-writing/review workflow.

## Hard rules

### 1. A mother paper is an executable research starting point

A **mother paper** is not merely a famous citation, a benchmark paper, or the nearest related work. It must be a sufficiently strong and relevant published baseline that is feasible to reproduce and likely to yield a diagnosable failure mechanism.

Do not designate a paper as the mother paper until it passes the G0 screen for:

- scholarly strength and target-outlet relevance;
- licensed, available data and a fixed evaluable protocol;
- executable or independently reproducible implementation path;
- metric/task comparability with the proposed research problem;
- a plausible path to observe a stable, meaningful failure; and
- an intervention path that is not just arbitrary module addition.

A paper that is useful as an application reference, historical context, or clean-room comparison may remain a **reference baseline** without becoming the mother paper.

### 2. Defects must be mechanisms, not slogans

Reject statements such as “the baseline does not use our module,” “accuracy could be higher,” or “we can add retrieval/agents/constraints.” A qualifying defect must be:

1. **reproducible** — not a one-off run;
2. **interpretable** — supports a causal or mechanism-level hypothesis;
3. **intervenable** — admits a specific technical response; and
4. **publishable** — matters for the task, deployment constraint, or theory.

### 3. No fabricated evidence or retrospective laundering

Never invent literature, baseline results, confidence intervals, mechanisms, ablations, figures, or credentials. Do not alter data, cherry-pick favorable slices, hide material failures, or silently redefine a benchmark after seeing results. A failure can become a boundary analysis; it cannot be hidden or converted into a claim without evidence.

### 4. Execution authorization remains explicit

Do not run model calls, training, tuning, paid APIs, network retrieval, long benchmarks, destructive operations, or publish/push actions unless the user has authorized them. Separate:

- offline audit / planning;
- pilot experiment;
- full experiment;
- publication/release.

Use new immutable artifact locations for new runs; do not overwrite historical evidence to make a later story cleaner.

### 5. Comparable claims require comparable protocols

A score is not automatically a SOTA claim. The scope, split, input visibility, model budget, tuning allowance, evaluator, denominator, and baseline conditions must match. Read [scope and comparability](references/scope-and-comparability.md) before making any “best,” “SOTA,” “official,” “reproduction,” or “outperforms” statement.

### 6. Prior art is a stage Gate, not a final-writing cleanup

Every material G0--G6 stage must pass two explicit checks:

- **PA-START:** before implementation, collection, decisive evaluation, or contribution wording, search and verify the closest prior work for (a) the finding, (b) each technical primitive, (c) the evaluation protocol, and (d) the claimed artifact or release contribution.
- **PA-CLOSE:** before closing the stage, repeat a bounded delta search and compare the **actual** method and findings—not merely the plan—against the strongest located predecessors.

A Prior-Art Gate must record databases/surfaces, exact queries, search date, screening rules, stable identifiers, full-text locators for decisive claims, and known coverage limits. Classify the contribution as one or more of: `replication`, `transfer`, `extension`, `combination`, `counterexample_or_boundary_correction`, or `unresolved`.

Do not use `first`, `novel`, `new problem`, `no prior work`, or equivalent language when the strongest predecessor has not been read at claim level. An empty query is only `not located in the audited scope`; it is never proof of universal absence. If direct prior art is found, contract the claim immediately and preserve the correction as a visible artifact rather than rewriting history.

## Gate workflow

| Gate | Decision | Minimum artifact | Pass condition |
|---|---|---|---|
| **G0** | Commit to a research starting point | Mother Paper Qualification Card + Dataset/Evaluation Card | strong, legal, reproducible, comparable baseline with an outlet fit |
| **G1** | Establish a trustworthy baseline | reproduction table, environment/config/log provenance | result is close enough to explain relative to the paper, or a bounded explanation exists |
| **G2** | Establish a research problem | Baseline Defect Card + slice/error evidence | stable, interpretable, intervenable, meaningful failure mechanism |
| **G3** | Establish What | pre-specified comparison matrix and pilot/full result | target outcome improves fairly, stably, and on the target failure slice |
| **G4** | Establish How | Method Card + ablation plan | each component maps to a defect and can be removed/tested/reproduced |
| **G5** | Establish Why | falsifiable Why Hypothesis + diagnostic results | predicted observations support or revise the mechanism explanation |
| **G6** | Prepare a defensible paper and release | claim-evidence matrix, figures/tables, reproducibility and ethics checklist | claims, assets, licenses, limits, and release artifacts are aligned |

`PA-START` and `PA-CLOSE` overlay every row. A stage cannot pass while its prior-art status is `missing`, `metadata_only_for_decisive_claim`, `direct_predecessor_unresolved`, or `novelty_wording_not_contracted`.

If a Gate fails, return to the earliest failed Gate. Do not compensate for a failed G0–G2 with more tuning, larger models, prose, or charts.

## Required reasoning chain

For every proposed contribution, write the chain explicitly:

```text
Baseline B fails under condition P.
Evidence shows failure pattern F.
Hypothesized reason R explains F.
Method component M is designed to mitigate R.
If R is material, outcome W should improve primarily under P.
Experiments E1…En and ablations test that prediction.
Therefore the contribution is bounded to the evidence-supported scope S.
```

If any arrow is missing, label the claim as a hypothesis or future work—not a contribution.

## Minimum experiment set

The exact design depends on the field, but a public-dataset paper should usually plan all applicable items:

1. **Main comparison (What):** fixed benchmark/split, strong comparable baselines, predeclared primary metric.
2. **Target-slice analysis (What/Why):** the condition where the baseline defect occurs.
3. **Ablation (How):** remove or replace each claimed component.
4. **Robustness/generalization (What/Why):** distribution shift, noise, missingness, temporal split, OOD, adversarial constraint, or another defect-relevant stressor.
5. **Cost/efficiency (What/How):** compute, latency, tokens, labels, tools, or human effort where practicality is claimed.
6. **Failure boundary (Why):** representative negative cases and a taxonomy; do not claim universal success.
7. **Uncertainty/reproducibility:** multiple seeds, repeated runs, confidence intervals, or a justified deterministic alternative.

Every experiment must answer a named What, How, or Why question. Remove experiments that only generate volume.

## Deliverable style

When applying this skill, provide concise but auditable output in this order:

1. **Stage and Gate verdict** — pass / revise / blocked, with reason.
2. **Prior-Art verdict** — PA-START/PA-CLOSE state, strongest direct predecessor, and contribution classification.
3. **Evidence inventory** — observed facts versus assumptions.
4. **Filled or partially filled card** — use the exact relevant template.
5. **Minimal next experiment or audit** — hypothesis, inputs, controls, metric, decision rule, and artifact path.
6. **Claim boundary** — what the proposed evidence can and cannot support.
7. **Authorization check** — what must be approved before execution.

## Current-project adaptation: report-generation and security/CTI work

For evidence-backed report generation, treat end-to-end report validity and narrow public subtask accuracy as different capability axes. A CWE/CVSS/ATT&CK subtask benchmark can test one component, but it cannot validate report completeness, evidence binding, policy applicability, or a strict report gate. Use the scope-boundary guide and never collapse these axes into a single SOTA claim.

## Templates and references

- [Gates, stop rules, and required artifacts](references/gates-and-artifacts.md)
- [Scope, benchmark, and SOTA comparability boundaries](references/scope-and-comparability.md)
- [Mother-paper, defect, method, and hypothesis cards](templates/research-cards.md)
- [Experiment matrix and claim-evidence ledger](templates/experiment-and-claim-matrix.md)
