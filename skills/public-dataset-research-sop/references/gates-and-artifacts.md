# Gates, Stop Rules, and Research Artifacts

This reference operationalizes the Defect → What → How → Why → Ideas → Release workflow. It is designed to prevent a common failure mode in public-dataset research: spending weeks on a method before establishing that the baseline, task, defect, and evidence chain are real.

## Gate map

```text
G0 qualify the mother paper / protocol
  ↓
G1 reproduce the baseline
  ↓
G2 diagnose a stable baseline defect
  ↓
G3 establish What with a fair intervention test
  ↓
G4 establish How with a defect-to-component map
  ↓
G5 establish Why with falsifiable mechanism tests
  ↓
G6 package the paper, evidence, and reproducible release
```

## Mandatory Prior-Art overlay — PA-START and PA-CLOSE

Prior-art verification is required at every G0--G6 stage; it is not deferred to Related Work drafting.

### PA-START — before material execution

Freeze a **Prior-Art Gate Card** before implementing a method, collecting decisive data, running a confirmatory evaluation, or using strong gap language. The card must:

1. state the exact proposed finding, technical primitives, evaluation protocol, and artifact/release claim separately;
2. name the strongest known opponent for each component;
3. record databases and technical surfaces searched, exact queries, search date, result/screening counts where available, and inclusion/exclusion rules;
4. verify decisive claims against full text or authoritative specifications with page/section/code locators;
5. classify each component as `already_established`, `replication`, `transfer`, `extension`, `combination`, `counterexample_or_boundary_correction`, or `unresolved`;
6. replace all unsupported `first`/`novel`/absence wording with a bounded provisional sentence; and
7. specify what additional search or evidence would change the decision.

`metadata_only` may establish that a work exists, but it cannot close a decisive claim-overlap question. If the closest work is inaccessible, PA-START remains `revise` unless the proposed action is only further literature retrieval.

### PA-CLOSE — before stage completion

Repeat a bounded delta search and compare the **actual artifacts and results** with prior art. PA-CLOSE must answer:

- Did the observed finding already appear in prior work?
- Did implementation changes introduce an established primitive not covered at PA-START?
- Is the final evaluator/protocol materially the same as an existing one?
- Does the evidence support replication, transfer, extension, combination, boundary correction, or no defensible contribution yet?
- Which draft claims must be deleted or contracted?

If direct prior art is discovered late, do not rewrite or delete frozen historical protocols. Add a dated correction artifact, update the claim ledger, and return to the earliest affected Gate.

### Negative-search rule

`not located in the audited scope` is the strongest permitted negative conclusion unless a genuinely systematic review supports more. Empty keyword searches, noisy indexes, missing full text, proprietary implementations, recent indexing lag, non-English literature, patents, theses, and technical repositories are explicit uncertainty sources. They never justify `no prior work` or `the first`.

### Prior-Art pass criteria

A stage's Prior-Art overlay passes only when:

- the closest direct and adjacent predecessors have stable identities;
- decisive overlap claims have full-text/specification/code locators;
- component-level overlap and residual difference are explicit;
- the opponent sentence names the strongest predecessor rather than a weak strawman;
- contribution wording is bounded to the verified difference; and
- the search record is reproducible enough for a second reviewer to challenge.

A later Gate cannot repair an earlier failure. For example:

- More ablations cannot make an unreproducible baseline a valid mother paper.
- A better average score cannot make a non-comparable protocol an official benchmark result.
- Elegant prose cannot convert an untested mechanism into a Why claim.
- A release bundle cannot legalize data or code that lacks a usable license.

## G0 — Mother-paper and protocol qualification

### Goal

Select a **research starting point** that can support a credible opponent sentence, a fair reproduction, a defect diagnosis, and a target publication venue.

### Required artifacts

1. **PA-START Prior-Art Gate Card** for the proposed problem, method, and protocol
2. **Mother Paper Qualification Card**
3. **Dataset and Evaluation Card**
4. Verified bibliographic record and source links
5. License/provenance note for data, code, model weights, and evaluation assets
6. Explicit target outlet and why it fits

### Pass criteria

A candidate must satisfy all critical conditions:

| Dimension | Minimum question |
|---|---|
| Scholarly strength | Is the venue/reputation appropriate for the target outlet and the claim being made? |
| Problem fit | Does it address the same core problem, not merely share a dataset or keyword? |
| Data/protocol | Are data, split, labels, evaluator, and input contract available and legal to use? |
| Reproduction path | Is code available or is a clean-room reimplementation realistically possible? |
| Comparability | Can method and baseline be evaluated under the same task, visibility boundary, budget, and metric? |
| Defect prospect | Is there a credible way to inspect failures beyond an aggregate score? |
| Outlet fit | Can the eventual contribution meet the style and evidence expectations of the intended venue? |

### Stop / downgrade rules

- **No legal data/code path:** reject as a mother-paper candidate; it may remain a background citation.
- **No fixed evaluator or split:** reject for SOTA/comparative claims until an independently auditable protocol is established.
- **No plausible defect slice:** keep as a baseline/reference, not the research starting point.
- **Task mismatch:** use only for external context or a clearly named adaptation; do not claim direct extension.
- **Low scholarly strength for the goal:** do not use as the primary opponent when pursuing a stronger outlet. A lower-tier paper can still serve as an implementation/reference baseline.
- **Reproduction not viable after a bounded investigation:** document the failure and switch rather than endlessly repairing the upstream stack.

### Decision language

Use one of these labels:

- `qualified mother paper`
- `qualified reference baseline`
- `external benchmark only`
- `historical/context citation only`
- `rejected / blocked` with reason

Do not call something a mother paper merely because it is the closest available citation.

## G1 — Baseline reproduction

### Goal

Establish that the baseline result is sufficiently trustworthy to diagnose and compare against.

### Required artifacts

- environment lockfile or environment manifest;
- source/data/split/evaluator fingerprint;
- configuration file and random seeds;
- command invocation and logs;
- reproduction table comparing paper-reported and observed metrics;
- explanation of material discrepancies;
- raw outputs or durable aggregate diagnostics appropriate to the trust boundary.

### Reproduction table

| Condition | Paper result | Reproduced result | Difference | Repeated? | Explanation/status |
|---|---:|---:|---:|---|---|
| Main metric |  |  |  |  |  |
| Target slice |  |  |  |  |  |
| Cost/runtime |  |  |  |  |  |

### Pass rule

“Close enough” is field-dependent. The requirement is not exact bitwise identity; it is that the difference is small enough to be understood and does not invalidate the comparison. If there is no credible explanation for a large difference, G1 fails.

### Stop rules

- Do not tune the baseline until it beats the paper without documenting every deviation.
- Do not substitute a different split, model, evaluator, or metric and call it a reproduction.
- If an exact reproduction is impossible but a clean-room adaptation is useful, label it precisely and restrict claims to the common protocol.

## G2 — Baseline defect diagnosis

### Goal

Turn an observation into a research problem: a stable failure mechanism with a technical intervention path.

### Required artifacts

- PA-START/PA-CLOSE record for the observed failure and proposed intervention;
- Baseline Defect Card;
- failure taxonomy or error clusters;
- slice-performance table and/or stress curve;
- at least one representative positive and negative example where permitted;
- initial reason hypothesis `R`;
- proposed intervention boundary.

### Defect evidence menu

| Defect class | Evidence that can establish it |
|---|---|
| Long-tail / subgroup failure | category, length, rarity, or difficulty slice metrics |
| Distribution/temporal shift | cross-domain, future-time, OOD, or source-shift evaluation |
| Noise/missingness sensitivity | controlled perturbation or missing-data curve |
| Constraint violation | deterministic invalid/violation rate and examples |
| Cost inefficiency | cost–quality or latency–quality curve under equal budgets |
| Poor calibration/uncertainty | calibration/error-risk analysis and abstention curve |
| Evidence/provenance failure | claim-to-evidence support audit, citation/anchor checks |
| Reproducibility fragility | seed/environment variation and exact artifact provenance |
| Evaluation blind spot | disagreement between average metric and risk/strict gate/slice outcomes |

### Pass criteria

All must hold:

1. Failure repeats under stated conditions.
2. The slice/condition was not chosen solely after trying many undisclosed partitions.
3. A plausible reason hypothesis can be written.
4. A method can intervene specifically on that reason.
5. The failure matters to the task, user, or scientific question.

## G3 — What: fair outcome validation

### Goal

Show that the intervention improves a predeclared outcome, especially under the target defect condition.

### Required artifacts

- experiment protocol or registry note written before the decisive run;
- baseline and intervention configurations;
- fixed inputs/splits and evaluator identity;
- main result table;
- uncertainty estimate or justified deterministic result protocol;
- target-slice result;
- negative/failed conditions;
- audit of coverage, invalid outputs, and budget where relevant.

### Pass criteria

The result must be:

- better than the chosen comparable baseline on the primary outcome;
- stable enough to rule out an obvious sampling accident;
- visible on the defect-relevant slice or condition;
- obtained without an unfair information, tool, tuning, budget, or evaluator advantage;
- bounded by disclosed limitations.

### If the result is weak

Do not manipulate data or suppress it. Legitimate actions include:

- revise the task boundary;
- change to a scientifically justified metric;
- test a different predeclared operational condition;
- simplify or replace the intervention;
- report the negative result as a boundary analysis.

## G4 — How: method organization and ablation

### Goal

Make the method reproducible and demonstrate that it is a coherent response to the diagnosed defect rather than a module inventory.

### Required artifacts

- Method Card;
- input/output and data-flow specification;
- defect → component → expected effect → verification mapping;
- algorithm/pseudocode or executable flow;
- ablation matrix;
- complexity/cost analysis;
- reproducibility instructions.

### Pass criteria

- Every material component has a stated purpose tied to the defect.
- Components can be removed, replaced, or otherwise tested where feasible.
- Input visibility and trust boundaries are explicit.
- The method can be implemented from the description and released configuration.

## G5 — Why: mechanism and diagnostic closure

### Goal

Replace “it worked” with a falsifiable explanation for why it worked, where it should work, and where it should not.

### Required artifacts

- Why Hypothesis;
- predicted observable outcomes;
- diagnostic experiments;
- alternative explanation analysis;
- ablation/counterfactual evidence;
- explicit scope/limitations statement.

### Pass criteria

The explanation connects:

```text
baseline failure R → intervention M → predicted phenomenon W → observed diagnostic evidence
```

It must be possible for a reasonable experiment to weaken or falsify the explanation. If the evidence supports only correlation, say so.

## G6 — Paper, release, and integrity package

### Goal

Ensure the final paper tells the same story that the artifacts support.

### Required artifacts

- claim–evidence ledger;
- figures/tables mapped to What, How, or Why;
- dataset/model/code cards where applicable;
- licenses, attributions, and access restrictions;
- reproducible environment and commands;
- raw/aggregate result provenance consistent with privacy/security constraints;
- limitations, negative findings, and ethics statement;
- citation verification and authorship/AI-use disclosures required by the outlet.

### Submission checklist

1. Did every material stage complete PA-START and PA-CLOSE with reproducible search records?
2. Is the strongest direct predecessor named and represented fairly?
3. Is the mother paper qualified rather than merely cited?
4. Is the baseline reproduction documented?
5. Is the defect reproducible and important?
6. Is the main result fair and stable?
7. Does every method component map to a defect?
8. Is the Why claim diagnostic and falsifiable?
9. Are official and derived/subset results separated?
10. Are all novelty/SOTA/reproduction words accurately scoped?
11. Are licenses and releases valid?
12. Are failures, corrections, and limitations visible?

## Suggested figure/table minimum set

Adapt to the venue, but a mature public-dataset paper normally needs the following evidence surfaces:

| Artifact | Main function | Layer |
|---|---|---|
| Problem/defect figure | make the baseline failure concrete | Why |
| Method/framework figure | map failure to intervention | How |
| Dataset/protocol table | make data/splits/visibility explicit | Problem |
| Main comparison table | establish outcome | What |
| Ablation table | establish component contribution | How |
| Robustness or cost curve | test defect-relevant value | What / Why |
| Error/failure examples or taxonomy | delimit mechanism and boundary | Why |

## Research log cadence

Record daily:

- PA-START/PA-CLOSE change, new predecessor, or novelty contraction;
- command/run/audit performed;
- what evidence it adds or contradicts;
- observed failure or success;
- change to the What/How/Why hypothesis;
- artifact path, hash, and authorization status where relevant.

Record weekly:

- strongest supported finding;
- strongest counterevidence or failure;
- next falsifiable hypothesis;
- Gate status and earliest blocker;
- a draft sentence that could enter the paper only if its evidence remains valid.
