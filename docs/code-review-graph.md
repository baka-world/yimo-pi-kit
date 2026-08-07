# Local code-review graph

`yimo-pi-kit` can explicitly add [code-review-graph](https://github.com/tirth8205/code-review-graph), a local-first Tree-sitter and SQLite knowledge graph for focused code review, dependency queries, test discovery, and change-impact analysis.

This integration is optional. Installing `yimo-pi-kit` alone does not download code-review-graph, change project files, index repositories, or start a background process.

## What is pinned

| Component | Pin |
|---|---|
| MCP Python package | `code-review-graph 2.3.7` |
| PyPI wheel SHA-256 | `12196dce3e673bdec7fba97ae5c4dff7589adee73a721374f62efae76e0fdd88` |
| General PyPI dependency cutoff | `2026-07-18T00:34:12Z` |
| Security override | `cryptography==50.0.0`, package cutoff `2026-07-31T14:25:11Z` |
| Workflow Skills Git commit | `6a1ee1c7063cc35cfa5ff12b8198c29360f3e4ad` (`v2.3.7`) |
| Upstream license | MIT, copyright (c) 2026 Tirth Kanani |

The MCP command runs through a private Node launcher and `uvx --isolated`. It ignores project/user uv configuration and `.env` files, disables automatic Python downloads and source-distribution builds, copies rather than symlinks cache artifacts, uses the public PyPI index, verifies the primary wheel hash, and limits dependency candidates to artifacts published no later than the recorded release time. Setup resolves absolute local Node, `uvx`, Python, runner, Git-shim, child HOME, temp, XDG/FastMCP directories, and uv cache paths under `$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/`; rerun setup after moving the installed package or runtime executables. The launcher passes only fixed curated variables plus non-credential proxy/certificate settings, so Pi model keys, OAuth material, session paths, and unrelated parent environment values do not enter the Python process. It also owns the uvx child process group and terminates it when MCP stdio closes or Pi exits, including during a cold dependency download. The release-time resolution selected `cryptography 49.0.0`, which is affected by `CVE-2026-69247`; the profile overlays the fixed `cryptography 50.0.0` with its own artifact cutoff. Transitive Python packages are not individually vendored in this repository; review and audit the generated uv environment whenever either pin changes.

## Prerequisites

- Pi `0.84.0` or newer;
- Node.js `22.19.0` or newer;
- Python `3.10` or newer already available locally;
- `uvx` from [uv](https://docs.astral.sh/uv/);
- `pi-mcp-adapter@2.15.0` for parent-session MCP access.

Install the adapter explicitly:

```bash
pi install npm:pi-mcp-adapter@2.15.0
```

## Setup

From a reviewed checkout or installed package path:

```bash
node ./scripts/cli.mjs setup-code-review
```

This performs two explicit operations:

1. downloads four upstream Skills from the fixed Git commit into `$PI_CODING_AGENT_DIR/sources/yimo-pi-kit/code-review-graph` and links them into the Pi Skills directory; the managed sparse checkout is rebuilt atomically with isolated Git config, hooks, attributes, credentials and inherited `GIT_*` overrides disabled;
2. merges `mcp/code-review.json` into `$PI_CODING_AGENT_DIR/mcp.json`, preserving custom server definitions unless `--force` is supplied. A yimo-pi-kit-managed definition is refreshed on repeat setup while preserving its `disabled` flag.

Use `--copy` if you prefer copied Skills rather than symlinks. Copied Skills receive a small `.yimo-pi-kit-source.json` management marker plus the upstream license; repeat setup replaces only copies carrying a valid matching marker and refuses unmanaged directories:

```bash
node ./scripts/cli.mjs setup-code-review --copy
```

You can also perform the steps separately:

```bash
node ./scripts/cli.mjs install-skills code-review
node ./scripts/cli.mjs setup-mcp code-review
```

When the package path is not obvious, run:

```text
/kit graph
```

In interactive mode Pi asks for confirmation and then runs the setup directly inside Pi, reporting the result; if you cancel (or in non-interactive modes) it copies the `!`-prefixed command to the editor instead.

Restart Pi or run `/reload`, then check:

```text
/kit doctor
```

## Workflows

The curated profile installs these upstream Skills:

```text
/skill:build-graph
/skill:review-changes
/skill:review-delta
/skill:review-pr
```

Typical first use inside a repository:

```text
/skill:build-graph
```

After making changes:

```text
/skill:review-delta
```

For a branch or pull-request style review:

```text
/skill:review-pr
```

The first graph build parses tracked source files and stores per-repository data
outside the source tree, under the private Pi runtime cache:

```text
$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/graph-data/<repo-name>-<hash>/graph.db
```

The per-repository subdirectory is derived from the locked Git root, so each
repository gets its own graph and no tool argument can redirect the data to
another project or arbitrary path. No `.code-review-graph/` directory is created
inside the repository; the source tree stays free of generated runtime state.

The first build is a full parse; later runs update incrementally. Do not rely on an incremental update against a never-built or empty graph: it only re-parses recently changed tracked files, and changed Markdown/configuration files yield zero code nodes. If `list_graph_stats_tool` reports zero files/nodes after building, rerun `build_or_update_graph_tool(full_rebuild=True)`, or delete the repository's `graph-data` subdirectory under `$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/graph-data/` and rebuild, before treating the graph as usable.

The generated directory lives outside the repository and is created privately where the platform supports Unix modes; it carries a `.yimo-pi-kit-repo` marker recording the owning repository. Symlinked/non-directory graph storage and symlinked, hard-linked, or non-regular database sidecars are rejected; existing graph files are tightened to private Unix modes. The database can contain absolute paths, hashes, symbols, and source-structure metadata; treat it as local project data and do not publish it without review.

## Curated MCP surface

The package deliberately exposes only these tools:

- `build_or_update_graph_tool`
- `get_minimal_context_tool`
- `get_impact_radius_tool`
- `query_graph_tool`
- `semantic_search_nodes_tool` (local FTS/keyword fallback; no embedding generation in this profile)
- `get_review_context_tool`
- `list_graph_stats_tool`
- `get_docs_section_tool`
- `get_affected_flows_tool`
- `detect_changes_tool`

The tools remain behind the adapter's single `mcp` proxy by default, reducing persistent tool-schema context. The server starts lazily over stdio only when Pi is inside a Git repository, resolves the nearest Git root, and locks every tool call to that one repository for the process lifetime. Explicit `repo_root` values may only name the same root; absolute, parent-traversing, or symlink-escaping changed-file paths are rejected.

Not exposed by this profile:

- `apply_refactor_tool` or other automatic source-editing tools;
- embedding generation tools or cloud embedding credentials; the runner strips embedding provider/model arguments and semantic search remains local FTS/keyword-only unless the user independently replaces the profile;
- source snippets in review responses; use Pi's normal `read` tool after the graph identifies a file/line range;
- Wiki generation and cross-repository registry tools;
- upstream MCP prompt templates;
- HTTP transport, visualization HTTP serving, daemon/watch mode, or auto-watch;
- upstream installer, hooks, platform instruction injection, or Git hooks.

## Privacy and network behavior

Normal first startup may access PyPI to obtain the pinned wheel and dependencies in the dedicated cache; Skill installation accesses the pinned GitHub repository. The Python MCP runner then blocks non-loopback/Unix-socket network connections, disables FastMCP project `.env` loading and update checks, removes inherited OpenTelemetry exporters, clears embedding credentials, strips embedding arguments, and limits subprocesses to the fixed Git shim plus the current Python parser probe. It also removes upstream MCP prompts. This is a defense-in-depth application guard rather than an operating-system sandbox.

The graph parser reads tracked repository source files and invokes local `git` commands for file and diff information. The private Git shim allowlists only `diff`, `log`, `ls-files`, `rev-parse`, and `status` with bounded options; clears all inherited `GIT_*`; isolates global/system config and attributes; disables hooks, fsmonitor, pagers, lazy fetch, external diff, textconv, and clean/process filters; and fails closed on unknown options. SVN access is disabled because upstream SVN listing can contact a configured server.

The four upstream Skills are installed unchanged at the pinned commit. Their `build-graph` text mentions automatic hooks, but this integration deliberately installs none—run the build/update workflow explicitly. The MCP server still runs with the same operating-system permissions as Pi, and native Tree-sitter parsers process repository-controlled files. Repository trust is not a sandbox; use a container or VM for hostile or unknown codebases.

## Do not run the upstream installer for this integration

Do not use this command merely to enable the Pi integration:

```bash
code-review-graph install
```

The upstream installer is designed for many editors and agents. It can write MCP configuration, Skills, hooks, Git hooks, and instruction sections for Claude Code, Codex, Cursor, Gemini and other platforms. `yimo-pi-kit` intentionally bypasses that installer and configures only Pi through its audited setup commands.

Also avoid these modes unless you independently review and explicitly need them:

```bash
code-review-graph serve --http
code-review-graph visualize --serve
code-review-graph daemon start
code-review-graph watch
```

## Updating and rollback

Pins must be updated as one release pair: inspect the new source/tag, PyPI wheel hash, dependencies, tool names, Skills, license and network behavior before changing either the MCP package or Git commit.

To disable the server, remove only the `code-review-graph` entry from your local `mcp.json` or disable it through your MCP configuration. Remove the four installed Skill links/directories if no longer wanted. The optional runtime home, launcher, uv cache, FastMCP/XDG state, Git config and shims live under `$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/` and may grow to hundreds of megabytes. Generated per-repository graph data can be deleted separately without touching the source tree:

```bash
rm -rf "$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/graph-data"
```

A legacy in-repository `.code-review-graph/` from an older kit version is no longer used; remove it with `rm -rf .code-review-graph`.

Review paths before deletion. The kit does not automatically remove user data or modify repository-level files during rollback.
