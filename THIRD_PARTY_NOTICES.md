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
| <https://github.com/microsoft/skills> | cloud-solution-architect, frontend-design-review | MIT |
| <https://github.com/oksure/openalex-research-mcp> | OpenAlex skill | MIT |
| <https://github.com/supabase/agent-skills> | Postgres best-practices skill | MIT |
| <https://github.com/vercel-labs/agent-skills> | composition patterns and React best practices | selected skill frontmatter declares MIT |

The installer intentionally does not install Vercel's web-design-guidelines skill because the inspected revision did not carry an explicit license declaration for that skill.

## MCP servers

The configuration templates invoke, but do not redistribute:

- `@upstash/context7-mcp@3.2.3`
- `@playwright/mcp@0.0.78`
- `openalex-research-mcp@0.5.0`
- `arxiv-mcp-server==0.5.0`
- `semgrep==1.135.0`
- `zotero-mcp-server==0.1.6`

Users are responsible for reviewing the licenses, privacy behavior, network access, and security posture of these separately installed tools.
