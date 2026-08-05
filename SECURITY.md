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

## Project agents

Project-local `.pi/agents` are repository-controlled instructions. The subagent extension refuses to load them from an untrusted project and asks for confirmation in interactive mode by default.

## MCP

MCP servers execute local or remote tools with their own privileges. The supplied configs use lazy startup and pin package versions, but users must still review each server and its upstream project. Zotero write tools are excluded by default.

## Untrusted repositories

Project trust is not a sandbox. Run Pi in a container, VM, micro-VM, or other operating-system isolation boundary when working with untrusted repositories or unattended automation.

## Reporting

Do not include credentials or private session content in reports. Before public release, run:

```bash
npm run check
npm run audit:prod
npm pack --dry-run
```
