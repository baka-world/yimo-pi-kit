# DeepSeek V4 Flash Responses API and provider-side Web Search

This kit can opt `deepseek/deepseek-v4-flash` into Pi's `openai-responses` transport and expose DeepSeek's provider-side `web_search` tool. Neither the model override nor authentication is installed silently. After installation or upgrade, the first interactive Pi startup shows a one-time versioned hint explaining whether the local model is still on Chat Completions or has the Responses API override.

## 1. Add the Responses API model override

From a checkout or the resolved package directory:

```bash
node ./scripts/cli.mjs setup-deepseek
```

The command:

- writes to `$PI_CODING_AGENT_DIR/models.json` or `~/.pi/agent/models.json` by default;
- creates a timestamped backup before changing an existing file;
- adds `deepseek-v4-flash` when it is absent;
- preserves an existing model with the same ID unless `--force` is supplied;
- keeps an existing model/provider `baseUrl` even with `--force`, so a private gateway is not silently redirected to the public endpoint;
- keeps unrelated providers, models, headers, and authentication settings;
- writes mode `0600` on Unix where possible.

Review [`examples/models.example.json`](../examples/models.example.json) before running it. When the installed package path is not obvious, `/kit deepseek` places the resolved setup command in the editor for review. To inspect a different destination first:

```bash
node ./scripts/cli.mjs setup-deepseek --target /path/to/models.json
```

Use `--force` only after reviewing the backup. It replaces matching DeepSeek model transport/capability fields with the supplied Responses API template while retaining unrelated fields and any existing endpoint.

## 2. Authenticate

Use Pi `/login` for the built-in `deepseek` provider or set the key locally:

```bash
export DEEPSEEK_API_KEY='...'
```

Never place a real key in this repository. The model template uses the public DeepSeek endpoint and contains no credential.

## 3. Select the model

Restart Pi or run `/reload`, then select:

```text
deepseek/deepseek-v4-flash
```

The model override uses:

- API: `openai-responses`;
- public base URL: `https://api.deepseek.com`;
- text input;
- DeepSeek V4 Flash context/output metadata;
- compatibility settings that avoid unsupported strict, grammar-tool, long-cache, and client tool-search fields.

The numeric context, output, compatibility, and pricing fields mirror the reviewed local configuration. Verify them against current DeepSeek documentation before publication or cost-sensitive use because provider capabilities and prices can change.

## 4. Web Search modes

The bundled extension defaults to `off` for the target model. Enabling external retrieval is an explicit opt-in.

```text
/deepseek-websearch status
/deepseek-websearch auto
/deepseek-websearch off
/deepseek-websearch force
```

Modes:

- `off` (default): do not add provider-side Web Search;
- `auto`: explicitly add `{ "type": "web_search" }` to Responses requests and let the model decide whether to search;
- `force`: add Web Search and set `tool_choice` to require it for every request in the process, unless another specific tool choice is already present.

For a single forced search without changing the process mode:

```text
/deepseek-search latest release notes for Pi 0.84
```

The one-shot command transforms into the query text and forces Web Search for only that provider request. Run it while the agent is idle; steer/follow-up use during an active stream is rejected so the flag cannot bind to the wrong request. It is cleared after use, model changes, cancellation, or agent settlement.

Process-level controls:

```bash
pi --deepseek-web-search off
PI_DEEPSEEK_WEB_SEARCH=force pi
```

Accepted values are `auto`, `off`, and `force`. Common boolean aliases are accepted for environment/command parsing, but the documented values are preferred. A process or shell environment that enables `auto`/`force` is an explicit authorization for provider-side external retrieval.

The public package intentionally fixes the injection target to `deepseek/deepseek-v4-flash` with `api: "openai-responses"`. It does not accept environment-based provider/model redirection, so a shared shell environment cannot silently retarget Web Search to an unrelated internal gateway model.

## Data flow and limitations

- This is a provider-side tool, not a local browser or MCP server. Prompts, search queries, and any provider-retrieved context are processed under DeepSeek's service and privacy terms.
- Search results are untrusted external content. The extension instructs the model not to follow instructions embedded in retrieved pages, but this is not a security sandbox.
- The extension asks the model to include useful source URLs and distinguish retrieved evidence from inference. It does not independently verify claims, rank sources, or guarantee citation completeness.
- The extension only mutates matching `deepseek-v4-flash` Responses payloads. Other providers, model IDs, and Chat Completions requests are untouched.
- Existing provider tools are preserved, an existing recognized Web Search tool is not duplicated, and a specific existing `tool_choice` is never replaced.
- If an endpoint emits a non-array `tools` field, the extension refuses to rewrite that payload rather than discarding provider data.

Use `/kit doctor` or `yimo-pi-kit doctor` to check whether the local `models.json` contains the Responses API override.
