# Third-party notices

This repository contains or integrates material from the projects below. Upstream projects are not responsible for this package.

## Pi coding agent examples

The following files are copied or adapted from Pi examples and remain under the Pi MIT license:

- `extensions/confirm-destructive/index.ts`
- `extensions/dirty-repo-guard/index.ts`
- `extensions/git-checkpoint/index.ts`
- `extensions/summarize/index.ts`
- `extensions/todo/index.ts`
- `prompts/*.md`
- portions of the subagent implementation and extension patterns

Source: <https://github.com/earendil-works/pi>

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Catppuccin palette

The theme files use Catppuccin palette values.

Source: <https://github.com/catppuccin/palette>

MIT License

Copyright (c) 2021 Catppuccin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## pi-mcp-adapter

MCP integration is optional and designed for `pi-mcp-adapter@2.15.0`.

Source: <https://github.com/nicobailon/pi-mcp-adapter>
License: MIT, copyright (c) 2026 Nico Bailon.

The adapter is not copied into this repository. Install it separately as a Pi package.

## Optional skill sources

`scripts/cli.mjs install-skills` downloads selected files from pinned upstream commits. Those skills are not included in this package and retain their own licenses:

| Repository | Selected material | License note |
|---|---|---|
| <https://github.com/Imbad0202/academic-research-skills> | academic-paper, reviewer, pipeline, deep-research | **CC BY-NC 4.0**; attribution and non-commercial restriction apply |
| <https://github.com/anthropics/skills> | frontend-design, webapp-testing | Apache License 2.0 in each selected skill directory |
| <https://github.com/upstash/context7> | context7-docs | MIT |
| <https://github.com/tirth8205/code-review-graph> | build-graph, review-changes, review-delta, review-pr at commit `6a1ee1c7063cc35cfa5ff12b8198c29360f3e4ad` | MIT, copyright (c) 2026 Tirth Kanani |
| <https://github.com/microsoft/skills> | cloud-solution-architect, frontend-design-review | MIT |
| <https://github.com/oksure/openalex-research-mcp> | OpenAlex skill | MIT |
| <https://github.com/supabase/agent-skills> | Postgres best-practices skill | MIT |
| <https://github.com/vercel-labs/agent-skills> | composition patterns and React best practices | selected skill frontmatter declares MIT |

The installer intentionally does not install Vercel's web-design-guidelines skill because the inspected revision did not carry an explicit license declaration for that skill.

## External provider services

The DeepSeek model example points to the public `https://api.deepseek.com` service and the Web Search extension can request DeepSeek's provider-side `web_search` tool. No DeepSeek SDK, model weights, search result, credential, or proprietary code is redistributed. Users must review DeepSeek's current API terms, privacy behavior, availability, pricing, and regional requirements.

## MCP servers

The configuration templates invoke, but do not redistribute:

- `@upstash/context7-mcp@3.2.3`
- `@playwright/mcp@0.0.78`
- `openalex-research-mcp@0.5.0`
- `arxiv-mcp-server==0.5.0`
- `semgrep==1.135.0`
- `zotero-mcp-server==0.1.6`
- `code-review-graph==2.3.7` from the PyPI wheel with SHA-256 `12196dce3e673bdec7fba97ae5c4dff7589adee73a721374f62efae76e0fdd88`, with `cryptography==50.0.0` pinned as a security override

The code-review-graph profile is optional and local-stdio only. A yimo-pi-kit-maintained launcher/runner constrains the audited wheel and intentionally excludes upstream prompts, installer, hooks, daemon, HTTP servers, cloud embedding/source-snippet paths, cross-repository access, and source-writing refactor tools. The four upstream Skills are installed unchanged at the pinned Git commit; their own license remains MIT. Users are responsible for reviewing licenses, transitive dependencies, privacy behavior, network access, and security posture whenever pins change.
