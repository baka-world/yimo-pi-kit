---
name: code-review-graph-usage
description: Efficient source-code investigation using the local code-review graph. Use when inspecting or debugging unfamiliar code, locating definitions, or tracing call relationships, to keep context usage low. Triggers: 查源码, 源码调查, investigate source, find definition, trace call graph, 用图查代码.
license: MIT
---

# Code Review Graph Usage

## When this applies

Use this skill when investigating source code (definitions, call relationships, impact radius, recent changes) — especially in large repositories or when context usage matters. The code-review-graph MCP tools must be installed (`setup-code-review`); if the graph itself is not yet built for the current repo, build it first (see below) — do not skip the graph because it is absent.

## Workflow Rules (token efficiency)

1. **The graph is the primary path for source investigation.** Use code-review-graph MCP tools first:
   - `query_graph_tool` — find nodes/definitions/symbols
   - `semantic_search_nodes_tool` — locate code by meaning
   - `get_minimal_context_tool` — fetch only the relevant functions/definitions
   - `get_impact_radius_tool` — trace callers/dependents
2. **No graph yet? Build it — do not give up and fall back to grep.** If the graph is missing, empty, or stale for the current repo, generate it as part of the investigation before proceeding:
   - `build_or_update_graph_tool(full_rebuild=True)` for a first build / empty graph
   - or `/skill:build-graph` in the interactive TUI
   - For a stale graph, run an incremental update first; only do a full rebuild when incremental results stay empty.
3. **After the graph is available, use it for every source lookup.** Reserve `grep -n` / `sed -n <range>` for locating files/lines that the graph does not cover (e.g., config, markdown, generated code) — never as a substitute for the graph when the graph exists. Do NOT `cat` entire files into context.
4. If a source location is genuinely not in the graph after a build, fall back to `grep -n` for the symbol, then `sed -n` the surrounding lines.

## Check whether the graph is ready

```bash
# list_graph_stats_tool reports files/nodes; empty => need a full build
build_or_update_graph_tool(full_rebuild=True)   # first build / empty graph
```

Do not assume the graph exists; verify before relying on it.
