---
name: frontend-engineering
description: Production frontend engineering workflow for accessible, responsive, performant web interfaces, component architecture, state/data flows, testing, and design quality. Use when implementing or reviewing browser UI.
license: MIT
---

# Frontend Engineering

Combine this workflow with the installed `frontend-design`, `frontend-design-review`, `vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-web-design-guidelines`, and `webapp-testing` skills as appropriate.

## Workflow

1. Inspect the actual framework, design system, tokens, routing, state management, API contracts, browser support, and tests.
2. Define the user task, information hierarchy, interaction states, loading/empty/error states, responsive behavior, and accessibility requirements before coding.
3. Reuse existing components and tokens. Preserve semantic HTML, keyboard navigation, visible focus, labels, contrast, reduced motion, and screen-reader behavior.
4. Keep server state, URL state, form state, and local UI state conceptually separate. Avoid effects for derived state.
5. Optimize measured bottlenecks: waterfalls, bundle size, hydration, rendering, image/font loading, and long tasks. Do not cargo-cult memoization.
6. Test behavior rather than implementation details. Use Playwright for critical user journeys and screenshots at representative breakpoints.
7. Review browser console, network failures, race conditions, cleanup, cancellation, and stale responses.
8. Run security checks for XSS, unsafe HTML, URL handling, token storage, postMessage, redirects, and third-party scripts.

## MCP

- `context7` for current framework and library documentation.
- `playwright` for browser inspection and end-to-end validation.
- `semgrep` for static security checks.

Use MCP through the `mcp` proxy, discovering tool names before calling them.
