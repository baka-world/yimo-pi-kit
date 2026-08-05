# Research Cards

Copy the smallest applicable card into the project’s research notes. Keep observed evidence separate from hypotheses and plans. Empty fields are evidence gaps, not invitations to guess.

---

## 0. Prior-Art Gate Card (PA-START / PA-CLOSE)

```markdown
# Prior-Art Gate Card — <stage/action>

## Gate identity
- Gate point: [PA-START | PA-CLOSE]
- Research stage: [G0 | G1 | G2 | G3 | G4 | G5 | G6]
- Search date / cutoff:
- Proposed or actual artifact identity/hash:
- Reviewer:

## Contribution decomposition
| Component | Exact proposed/observed claim | Strongest located predecessor | Overlap | Residual difference | Classification | Status |
|---|---|---|---|---|---|---|
| Finding |  |  |  |  | already established / replication / transfer / extension / boundary correction / unresolved |  |
| Technical primitive A |  |  |  |  |  |  |
| Technical primitive B |  |  |  |  |  |  |
| Evaluation protocol |  |  |  |  |  |  |
| Artifact/release unit |  |  |  |  |  |  |

## Reproducible search record
- Databases/indexes:
- Standards/code/patent/thesis/tool surfaces:
- Exact queries:
- Result counts where available:
- Citation/backward/related-network procedure:
- Inclusion criteria:
- Exclusion criteria:
- Full-text availability and version handling:
- Known coverage limitations:

## Claim-level verification
| Source | Stable identifier | Decisive claim | Full-text/spec/code locator | Evidence grade | Direct / adjacent / contextual |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Opponent and correction
- Strongest opponent sentence:
- Claims deleted or contracted:
- Permitted bounded contribution sentence:
- Prohibited wording:

## Gate decision
- Verdict: [pass | revise | blocked]
- Earliest affected research Gate:
- What would change the verdict:
- Next delta-search trigger:
```

### Prior-Art interpretation rules

- `metadata_only` cannot close a decisive overlap question.
- An empty search result means only `not located in the audited scope`.
- If direct prior art is found, preserve a dated correction artifact and reclassify the work; do not silently erase frozen history.
- PA-CLOSE compares the final method/result, not the initial proposal.

---

## 1. Mother Paper Qualification Card (G0)

```markdown
# Mother Paper Qualification Card

## Identity
- Candidate paper:
- Authors / year:
- Venue and publication status:
- Stable identifier (DOI / proceedings / arXiv):
- Code repository / release:
- Dataset / benchmark:
- Target outlet for the new paper:

## Role decision
- Proposed role: [mother paper | reference baseline | external benchmark only | context citation]
- Same core problem as our proposal? [yes/no/partial]
- Exact common task unit:
- Why this is the strongest relevant opponent:

## Qualification screen
| Criterion | Evidence | Verdict | Risk / follow-up |
|---|---|---|---|
| Scholarly strength / outlet fit |  | pass / revise / fail |  |
| Data available and license clear |  | pass / revise / fail |  |
| Code or clean-room reproduction path |  | pass / revise / fail |  |
| Fixed split/input/evaluator available |  | pass / revise / fail |  |
| Comparable task/metric possible |  | pass / revise / fail |  |
| Plausible diagnostic failure slice |  | pass / revise / fail |  |
| Intervention opportunity beyond module stacking |  | pass / revise / fail |  |

## G0 decision
- Verdict: [qualified mother paper | qualified reference baseline | external benchmark only | blocked/rejected]
- Blocking condition(s):
- Earliest next Gate:
- Required authorization before execution:
```

### Mother-paper interpretation notes

- A lower-tier application paper can be an informative reference baseline, but do not make it the primary mother paper when its scholarly strength conflicts with the target outlet.
- A prestigious benchmark paper can be an external evaluation source without being the mother paper for a different end-to-end task.
- If the original code/license is unavailable, a clean-room comparison may still be valid, but only under a new common protocol and with exact-reproduction claims removed.

---

## 2. Dataset and Evaluation Card (G0)

```markdown
# Dataset and Evaluation Card

## Identity and provenance
- Dataset / benchmark name:
- Source/release URL or archive:
- Commit / version / DOI:
- Data license:
- Code/evaluator license:
- Frozen artifact/hash identity:

## Task and population
- Prediction / decision / report unit:
- Input visible to the method:
- Gold or hidden evaluator-only fields:
- Population / temporal range:
- Train/dev/test split and creation rule:
- Official metric and denominator:

## Validity and access audit
| Check | Finding | Evidence path | Status |
|---|---|---|---|
| Source can be frozen |  |  | pass / revise / fail |
| Split is stable and documented |  |  | pass / revise / fail |
| Evaluator is available/auditable |  |  | pass / revise / fail |
| Gold is outside generator boundary |  |  | pass / revise / fail |
| Prompt/demo/test overlap audited |  |  | pass / revise / fail |
| Leakage/retrieval handles assessed |  |  | pass / revise / fail |
| License permits intended use/release |  |  | pass / revise / fail |
| Published baselines are comparable |  |  | pass / revise / fail |

## Protocol designation
- Track: [official full | derived/screened | internal | clean-room common protocol]
- Exact scope name:
- What the protocol can support:
- What it cannot support:
- Required next action:
```

---

## 3. Reproduction Card (G1)

```markdown
# Reproduction Card

## Baseline identity
- Paper / method:
- Code commit or implementation identity:
- Data/evaluator identity:
- Model/provider/environment identity:

## Reproduction protocol
- Hardware / OS / accelerator:
- Runtime and dependency lockfile:
- Seeds / repetitions:
- Training/tuning allowance:
- Inference budget / tool access:
- Commands and configuration paths:

## Results
| Measure / slice | Paper | Reproduction | Difference | Repetitions / CI | Status |
|---|---:|---:|---:|---|---|
| Primary metric |  |  |  |  |  |
| Defect-relevant slice |  |  |  |  |  |
| Runtime/cost |  |  |  |  |  |

## Discrepancy diagnosis
- Known protocol differences:
- Suspected source of discrepancy:
- Evidence for the explanation:
- Does discrepancy invalidate direct comparison? [yes/no/uncertain]

## G1 decision
- Verdict: [pass / revise / fail]
- Immutable artifact paths/hashes:
- Next action:
```

---

## 4. Baseline Defect Card (G2)

```markdown
# Baseline Defect Card

## Starting point
1. Mother paper / baseline:
2. Dataset / benchmark / protocol:
3. Reproduction status: paper result ___; reproduced result ___; difference ___

## Observed failure
4. Failure statement (observable, not causal):
5. Affected data slice / operational condition P:
6. Evidence type: [error taxonomy | slice table | stress curve | cost curve | constraint audit | reproducibility audit]
7. Frequency / effect size / uncertainty:
8. Does it reproduce across seeds, time, datasets, or conditions?

## Hypothesis and intervention
9. Candidate reason hypothesis R:
10. Competing explanation(s):
11. Specific technical intervention entry M:
12. Predicted result W if R is material:
13. Minimal test that could falsify R:

## Qualification
14. Reproducible? [yes/no/evidence gap]
15. Interpretable? [yes/no/evidence gap]
16. Intervenable? [yes/no/evidence gap]
17. Publishable/important? [yes/no/evidence gap]

## G2 decision
- Verdict: [pass / revise / fail]
- Do not claim yet:
- Smallest next What experiment:
```

### Example of acceptable granularity

> Under multi-claim, cross-field-dependent report tasks, a single-pass baseline’s probability of satisfying the joint gate decreases sharply even where individual claim accuracy remains moderate. The effect is concentrated in tasks that require evidence binding and source-priority claims.

This is testable with joint-versus-marginal metrics, task slices, failure codes, and a matched intervention. It is stronger than “the baseline is inaccurate.”

---

## 5. Method Card (G4)

```markdown
# Method Card

1. Method name:
2. Input / output contract:
3. Trust and information boundaries:
4. Target baseline defect(s):
5. Component A:
   - mechanism / operation:
   - defect addressed:
   - expected observable effect:
   - ablation or replacement test:
6. Component B:
   - mechanism / operation:
   - defect addressed:
   - expected observable effect:
   - ablation or replacement test:
7. Component C:
   - mechanism / operation:
   - defect addressed:
   - expected observable effect:
   - ablation or replacement test:
8. Training / optimization procedure:
9. Inference / decision procedure:
10. Complexity / cost / tool calls:
11. Configuration, seeds, and reproducibility plan:
12. Known limitations / non-goals:
```

### Required defect-to-component table

| Component | Target defect / reason | Expected result | Test | Failure interpretation |
|---|---|---|---|---|
|  |  |  |  |  |

If a component cannot fill this table, it is likely a speculative module and should be removed, isolated as exploratory, or explicitly framed as such.

---

## 6. Why Hypothesis Card (G5)

```markdown
# Why Hypothesis Card

## Observation
- Baseline B fails under condition P:
- Evidence for this observation:

## Mechanism hypothesis
- Candidate reason R:
- Alternative explanation A1:
- Alternative explanation A2:
- Intervention M changes which part of the causal/decision path:

## Falsifiable prediction
If R is the main reason, then after introducing M:
- Expected outcome W1:
- Expected slice pattern W2:
- Expected ablation/counterfactual pattern W3:
- Expected non-effect or boundary condition W4:

## Tests
| Test | Control | Expected result if R is right | Result | Interpretation |
|---|---|---|---|---|
| E1 |  |  |  |  |
| E2 |  |  |  |  |
| E3 |  |  |  |  |

## G5 decision
- Supported / weakened / falsified / unresolved:
- Wording permitted by evidence:
- Wording prohibited by evidence:
- Next diagnostic action:
```

---

## 7. Opponent and Contribution Card (Ideas)

```markdown
# Opponent and Contribution Card

## Opponent sentence
- PA-START / PA-CLOSE artifact:
- Existing definition / conclusion / evidence chain:
- Representative strongest predecessor(s):
- What it establishes well:
- Verified residual difference or transfer boundary:
- Where overlap remains unresolved:

## Our advance
- New problem / constraint:
- New solution path:
- New method / evaluator / framework:
- New finding / boundary / regularity:

## Evidence chain
- What evidence:
- How evidence:
- Why evidence:
- Scope and limitations:

## One-sentence contribution
> While prior work ________, it fails under ________ because ________. We introduce ________, which ________; experiments show ________ under ________, while ________ remains outside scope.

## Title test
- Object/problem:
- Opponent/limitation:
- Method or reframing:
- Value/setting:
- Proposed title:
```

---

## 8. Weekly Gate Review Card

```markdown
# Weekly Research Gate Review — Week __

- Current Gate:
- Gate verdict: [pass / revise / blocked]
- PA-START status:
- PA-CLOSE status:
- Strongest new predecessor or novelty correction:
- Strongest evidence gained:
- Strongest counterevidence/failure:
- Artifact paths/hashes:
- What hypothesis changed:
- How design change, if any:
- Next falsifiable Why hypothesis:
- Authorization required next week:
- Earliest blocker and stop condition:
- One evidence-backed sentence that may enter the paper:
```
