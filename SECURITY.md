# Security

Pi packages execute with the permissions of the user running Pi. Extensions can run arbitrary code, and skills can instruct the model to run commands. Review this repository before installing it.

## Secrets

This package must never contain:

- `auth.json`, API keys, OAuth tokens, passwords, or cookies;
- Pi session JSONL files;
- private model gateway addresses;
- local trust decisions;
- downloaded paper data, MCP caches, or generated reports containing private content.

Use environment variables, Pi `/login`, an operating-system credential store, or a user-owned key file outside this repository. The API-key failover extension requires key files to be owned by the current user and mode `0600` or stricter on Unix.

The versioned startup-hint acknowledgment is local runtime state at `$PI_CODING_AGENT_DIR/state/yimo-pi-kit.json`. It stores only the last hinted package version and timestamp, uses private permissions where possible, refuses symlinked state paths, and must not be committed.

## Project agents

Project-local `.pi/agents` are repository-controlled instructions. The subagent extension refuses to load them from an untrusted project and asks for confirmation in interactive mode by default.

## MCP

MCP servers execute local or remote tools with their own privileges. The supplied configs use lazy startup and pin package versions, but users must still review each server and its upstream project. Zotero write tools are excluded by default.

## Local code-review graph

The optional code-review-graph integration runs a third-party Python MCP server with the same user permissions as Pi and parses repository source into a local SQLite database. Setup is explicit; the package does not run the upstream installer, install hooks, start watchers/daemons, expose HTTP, or index a repository automatically.

The curated profile pins the `2.3.7` primary wheel by URL and SHA-256, fixes the matching Skills to Git commit `6a1ee1c7063cc35cfa5ff12b8198c29360f3e4ad`, uses isolated `uvx` resolution with release-time cutoffs and no sdist builds, overlays `cryptography==50.0.0` to remediate `CVE-2026-69247` in the otherwise selected runtime tree, and exposes only graph construction and read-oriented review/impact tools. Skill checkout is rebuilt atomically under isolated Git config with hooks, attributes, credentials and inherited `GIT_*` overrides disabled; copied Skills are replaced only when a valid local management marker identifies them as kit-managed. A package-maintained runner locks the MCP process to the Git repository active at startup, validates changed-file inputs, rejects escaping symlinks and unsafe or hard-linked graph-data paths, clamps traversal/output limits, disables source snippets and embeddings, and removes upstream MCP prompts. Automatic refactoring, Wiki, cross-repository, HTTP, and cloud-embedding paths are excluded. Cloud credentials, FastMCP `.env`/update settings, Python user paths, and inherited OpenTelemetry exporters are cleared or disabled in the child environment; an isolated child HOME prevents reading a pre-existing upstream user registry or Python user site. A private Git shim allowlists read-only Git commands/options, clears inherited `GIT_*`, isolates Git config, and blocks repository external diff, textconv, clean/process filters, hooks, fsmonitor, pagers, and lazy remote fetch. The launcher owns and terminates the uvx child process group when stdio or Pi closes. SVN is disabled to avoid implicit remote access.

A graph build creates `.code-review-graph/graph.db` inside the locked repository. It may contain absolute paths, symbols, relationships, parser-derived structure, and hashes; never publish it without review. The curated MCP responses do not include source snippets, but Pi can still read repository files through its normal tools. Parsing hostile repositories is not sandboxed, and native parser dependencies plus attacker-controlled Git/SQLite data remain part of the attack surface. Use a container or VM for unknown code. See [docs/code-review-graph.md](docs/code-review-graph.md).

## Provider-side Web Search

The DeepSeek extension is `off` by default and adds a provider-side `web_search` declaration only after explicit opt-in for the configured DeepSeek Responses API model. This sends prompts/search queries to the provider and may expose retrieved external content to the model. Search results are untrusted data, not instructions. Review DeepSeek's privacy, retention, regional, and service terms before enabling it; keep `off` for sensitive tasks or environments where external retrieval is prohibited.

The extension does not independently verify sources or provide a browser sandbox. A cited page can be wrong, malicious, or prompt-injection content even when the provider successfully retrieved it.

## Untrusted repositories

Project trust is not a sandbox. Run Pi in a container, VM, micro-VM, or other operating-system isolation boundary when working with untrusted repositories or unattended automation.

## Reporting

Do not include credentials or private session content in reports. Before public release, run:

```bash
npm run check
npm run audit:prod
npm pack --dry-run
```
