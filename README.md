# yimo-pi-kit

A portable, opinionated profile for the [Pi coding agent](https://pi.dev). It packages reusable capabilities while deliberately excluding credentials, sessions, private endpoints, caches, downloaded data, and machine-specific binaries.

> Status: `0.3.1`. Requires Pi `0.84.0` or newer and Node.js `22.19.0` or newer.

## Included

- Portable extensions for safe temp files, API-key failover, DeepSeek Responses API provider-side Web Search, automatic context continuation, compaction status, LaTeX rendering, task notifications, work logs, todos, summaries, and Git/session safeguards.
- A subagent tool with bundled `scout`, `planner`, `worker`, `reviewer`, backend, frontend, architecture, security, academic, and deep-research agents.
- Six locally maintained skills for engineering, architecture, security, academic retrieval, and public-dataset research.
- Three subagent workflow prompts.
- Four Catppuccin themes.
- Portable, version-pinned MCP configuration templates.
- Optional local code-review graph integration with a hash-pinned primary MCP wheel, an audited runtime security override, and four commit-pinned review workflows.
- Explicit setup and diagnostic commands; no lifecycle script silently installs external software.

## Deliberately not included

- `auth.json`, API keys, OAuth tokens, or secret files;
- Pi sessions, trust decisions, MCP metadata caches, model stores, backups, or downloaded papers;
- private model gateway URLs or organization-specific models;
- copied `node_modules`, Python virtual environments, or architecture-specific binaries;
- third-party skills whose upstream licenses and update cycles should remain visible to the user.

## Install

### Local development

```bash
pi install /path/to/yimo-pi-kit
```

### Git release

```bash
pi install git:github.com/baka-world/yimo-pi-kit@v0.3.1
```

### npm release

After the package is published:

```bash
pi install npm:yimo-pi-kit@0.3.1
```

Restart Pi or run `/reload`, then check:

```text
/kit doctor
/kit agents
```

On the first interactive startup after installing or upgrading each kit version, Pi shows a one-time setup hint. It explicitly says whether DeepSeek V4 Flash is still using Pi's default Chat Completions or the opt-in Responses API override, reminds you that Web Search is off by default, reports or offers the optional local code-review graph through `/kit graph`, and points to `/kit doctor`. The acknowledgment stores only the kit version and timestamp in `$PI_CODING_AGENT_DIR/state/yimo-pi-kit.json` with private permissions; it contains no session or credential data. Set `YIMO_PI_KIT_HIDE_STARTUP_HINT=1` to suppress it.

Use `pi config` to disable any extension, skill, prompt, or theme you do not want.

## MCP setup

The bundled subagents degrade to local tools when MCP is unavailable. To enable MCP in child agents and in the parent Pi session:

```bash
pi install npm:pi-mcp-adapter@2.15.0
```

Then install the portable MCP profile from a checkout:

```bash
node ./scripts/cli.mjs setup-mcp
```

When the kit was installed through Pi and its package path is not obvious, run `/kit setup`; it prints copy-paste commands using the resolved package path.

The setup command:

- writes to `$PI_CODING_AGENT_DIR/mcp.json` or `~/.pi/agent/mcp.json` by default;
- creates a timestamped backup before changing an existing file;
- preserves existing values unless `--force` is supplied;
- writes mode `0600` on Unix where possible.

### Profiles are opt-in

MCP servers are grouped into **profiles**, and nothing is enabled until you explicitly merge a profile with `setup-mcp <profile>` (default `global`). Only the servers in the profiles you merged appear in `mcp.json` and in `/mcp` — running only `setup-code-review`, for example, enables just `code-review-graph`.

| Profile | Servers | Enable with |
|---|---|---|
| `global` | Context7, Playwright, OpenAlex, arXiv, Semgrep, Zotero | `setup-mcp global` (default) |
| `academic` | arXiv, OpenAlex, Zotero | `setup-mcp academic` |
| `architecture` | Context7 | `setup-mcp architecture` |
| `backend` | Context7, Semgrep | `setup-mcp backend` |
| `frontend` | Context7, Playwright | `setup-mcp frontend` |
| `security` | Context7, Semgrep | `setup-mcp security` |
| `code-review` | code-review-graph | `setup-code-review` |

Merges are additive and preserve existing servers (including unrelated servers you configured yourself); use `--force` to replace a matching definition. `code-review-graph` is intentionally **not** part of `global` and is added only by the explicit code-review setup.

Requirements by server:

| Server | Runtime | Notes |
|---|---|---|
| Context7 | `npx` | Optional `CONTEXT7_API_KEY` |
| Playwright | `npx` | Browser binaries may require `npx playwright install chromium` |
| OpenAlex | `npx` | Public scholarly metadata |
| arXiv | `uvx` | Stores papers under its own user directory by default |
| Semgrep | `uvx` | Uses `semgrep==1.135.0` and `semgrep mcp` |
| Zotero | `uvx` | Local mode; Zotero must expose its local API |
| code-review-graph | `uvx`, Python 3.10+ | Separate opt-in profile; local SQLite graph and curated review-only tools |

All supplied MCP servers are lazy. Zotero write/mutation tools are excluded by default. See the profile table above for which servers each profile enables.

## DeepSeek V4 Flash Responses API and Web Search

The package includes an opt-in model setup command and a request-scoped extension for DeepSeek's provider-side `web_search` tool. No model configuration or credential is installed automatically.

```bash
node ./scripts/cli.mjs setup-deepseek
```

When the package path is not obvious, run `/kit deepseek`; it places the resolved setup command in the editor for review.

Authenticate independently with Pi `/login` or `DEEPSEEK_API_KEY`, run `/reload`, and select `deepseek/deepseek-v4-flash`.

Controls:

```text
/deepseek-websearch auto|off|force|status
/deepseek-search <query>
```

Web Search is **off by default**. `auto` explicitly adds the provider-side search tool and lets the model decide; `force` requires it when no other specific tool is already forced; `off` leaves the request unchanged. `/deepseek-search` explicitly forces one matching Responses request and must be submitted while the agent is idle. Search queries and retrieved context are processed by the provider, and retrieved pages must be treated as untrusted content.

See [DeepSeek Responses and Web Search](docs/deepseek-responses.md) for setup, environment overrides, data-flow details, and limitations.

## Optional local code-review graph

The kit can add [code-review-graph](https://github.com/tirth8205/code-review-graph) for Tree-sitter/SQLite code maps, focused review context, dependency queries, test discovery, and blast-radius analysis. It is not downloaded or enabled by package installation.

After installing `pi-mcp-adapter@2.15.0`, review and run:

```bash
node ./scripts/cli.mjs setup-code-review
```

Or run `/kit graph` to place the resolved command in Pi's editor as a runnable shell command (prefixed with `!`). Setup installs four upstream Skills from the audited `v2.3.7` commit through an isolated, atomically rebuilt Git checkout and merges a lazy local-stdio MCP profile whose primary PyPI wheel is pinned by URL and SHA-256. The setup resolves absolute local `uvx`, Python, Node, runner, and Git-shim paths; the wheel runs with no sdist builds, no project uv sources/config, and release-time dependency cutoffs. The curated server exposes graph construction plus read-oriented review/impact and local FTS/keyword search tools; it excludes upstream prompts/hooks/installers, HTTP, daemon/watch mode, embedding generation/cloud credentials, Wiki/cross-repository tools, source snippets, and automatic refactoring writes.

After `/reload`, start with:

```text
/skill:build-graph
/skill:review-delta
```

The very first build must be a **full build** (`build_or_update_graph_tool(full_rebuild=True)`). An incremental update against a never-built or empty graph only re-parses recently changed tracked files, and changed Markdown/configuration files produce no code nodes—so you can end up with an empty `graph.db` even after the skill appears to succeed. If `list_graph_stats_tool` reports zero nodes/files after building, rerun with `full_rebuild=True` (or delete `.code-review-graph/` and rebuild).

The server must start inside a Git repository and is locked to that repository for its lifetime; `repo_root`, changed-file paths, symlinks, and graph-data paths cannot escape it. The first build creates `.code-review-graph/graph.db` with private local permissions; symlinked or hard-linked graph files are refused. Treat it as generated project data. The curated profile isolates Git config and blocks external diff/textconv plus clean/process filters; SVN access is intentionally disabled. The launcher also terminates its uvx process group when Pi or MCP stdio closes. The upstream Skills sometimes mention automatic hooks, but this profile installs no hooks—run the build/update workflow explicitly. The dedicated uv cache can grow to hundreds of megabytes. See [Local code-review graph](docs/code-review-graph.md) for pins, data flow, security boundaries, workflows and rollback.

## Optional third-party skills

Bundled agents work without these skills and explicitly report when one is missing. To install a reviewed profile from pinned upstream commits:

```bash
node ./scripts/cli.mjs install-skills frontend
node ./scripts/cli.mjs install-skills backend
node ./scripts/cli.mjs install-skills architecture
node ./scripts/cli.mjs install-skills security
node ./scripts/cli.mjs install-skills academic
node ./scripts/cli.mjs install-skills code-review
```

Use `--copy` to copy instead of symlink. The default stores repositories under:

```text
$PI_CODING_AGENT_DIR/sources/yimo-pi-kit/
```

Important: the optional `academic-research-skills` repository is licensed **CC BY-NC 4.0**. Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and every upstream license before installation or redistribution.

## Custom model gateway and key failover

The failover extension activates only for providers whose API is:

```json
"api": "openai-completions-key-failover"
```

Start from [`examples/models.example.json`](examples/models.example.json). Prefer environment variables:

```json
"apiKeys": [
  "$YIMO_PI_GATEWAY_KEY_1",
  "$YIMO_PI_GATEWAY_KEY_2"
]
```

A user-owned key file is also supported through `apiKeyFile`. It must be a regular file rather than a symlink; on Unix it must be owned by the current user and mode `0600` or stricter. Never commit that file.

## Agent precedence

The subagent tool supports four scopes:

- `package`: bundled agents only;
- `user` (default): bundled agents plus `~/.pi/agent/agents` overrides;
- `project`: trusted project `.pi/agents` only;
- `both`: bundled agents, then user overrides, then trusted project overrides.

Project agents are never loaded from an untrusted project. Interactive runs ask for confirmation before executing requested project agents unless `confirmProjectAgents` is explicitly disabled.

## Configuration

Examples:

- [`examples/settings.example.json`](examples/settings.example.json)
- [`examples/models.example.json`](examples/models.example.json)
- [`examples/env.example`](examples/env.example)

Credentials remain per-user. Authenticate independently with Pi `/login` or environment variables.

## Validate before sharing

```bash
npm install --ignore-scripts
npm run check
npm run audit:prod
npm pack --dry-run
```

The validation checks JSON/frontmatter, package and agent resource paths, optional-skill references, MCP command portability, full Git pins, executable modes, symlinks, private paths, and common secret patterns.

For a clean Pi installation test:

```bash
TEST_DIR="$(mktemp -d)"
PI_CODING_AGENT_DIR="$TEST_DIR" pi install /path/to/yimo-pi-kit
PI_CODING_AGENT_DIR="$TEST_DIR" pi --list-models
```

See:

- [Migration guide](docs/migration.md)
- [DeepSeek Responses and Web Search](docs/deepseek-responses.md)
- [Local code-review graph](docs/code-review-graph.md)
- [Troubleshooting / FAQ](docs/troubleshooting.md)
- [Release guide](docs/release.md)
- [Security policy](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Security

Pi packages execute with full user permissions. Review source before installation. Project trust is an input-loading guard, not a sandbox. Use a container or VM for untrusted repositories and unattended work.

## License

Original material in this repository is MIT licensed. Copied/adapted Pi examples, Catppuccin palette values, optional dependencies, and optional third-party skills retain their upstream licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
