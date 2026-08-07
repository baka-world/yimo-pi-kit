---
name: code-review-graph-usage
description: Efficient source-code investigation using the local code-review graph. Use when inspecting or debugging unfamiliar code, locating definitions, or tracing call relationships, to keep context usage low. Triggers: 查源码, 源码调查, investigate source, find definition, trace call graph, 用图查代码.
license: MIT
---

# Code Review Graph Usage

## When this applies

Use this skill when investigating source code (definitions, call relationships, impact radius, recent changes) — especially in large repositories or when context usage matters. It only applies when the `code-review-graph` MCP tools are available (after `setup-code-review` + `build-graph`).

## Workflow Rules (token efficiency)

1. **Prefer the graph over full-file dumps.** Use code-review-graph MCP tools first:
   - `query_graph_tool` — find nodes/definitions/symbols
   - `semantic_search_nodes_tool` — locate code by meaning
   - `get_minimal_context_tool` — fetch only the relevant functions/definitions
   - `get_impact_radius_tool` — trace callers/dependents
2. **Read source files in slices, not whole files.** Use `grep -n` / `sed -n <range>` to locate and read only the needed lines. Do NOT `cat` entire files into context.
3. **Only build the graph when it helps.** If the graph is not built for the current repo, prefer targeted `grep`/`sed` reads over a full `build-graph` unless the repo is large or the investigation is deep.
4. If a source location is not in the graph, fall back to `grep -n` for the symbol, then `sed -n` the surrounding lines.

## Check whether the graph is ready

```bash
# list_graph_stats_tool reports files/nodes; empty => need a full build
build_or_update_graph_tool(full_rebuild=True)   # first build / empty graph
```

Do not assume the graph exists; verify before relying on it.
