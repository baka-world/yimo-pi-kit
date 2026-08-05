# Migration guide

## Move to another personal machine

1. Install Pi and authenticate independently with `/login` or environment variables.
2. Install this package from a pinned Git tag or npm version.
3. Copy only reviewed preferences from `examples/settings.example.json`.
4. Install `pi-mcp-adapter` and run the explicit MCP setup if needed.
5. Install only the optional skill profiles you need.
6. Recreate private model providers from `models.example.json`; inject keys through the environment or a password manager.
7. Do not copy sessions or trust decisions unless you have separately reviewed their content and actually need them.

## Share with a team

For project-local installation:

```bash
pi install -l git:github.com/YOUR_ORG/yimo-pi-kit@v0.1.0
```

Commit `.pi/settings.json`. Team members must trust the project before Pi loads project packages or extensions. Pin releases for reproducibility.

Keep team-specific agents in `.pi/agents` only when repository control and project trust are appropriate. They override bundled and user agents when `agentScope: "both"` is requested.

## Data classification

| Data | Share? | Recommended handling |
|---|---:|---|
| Extensions, original skills, agents, prompts, themes | Yes | Pi package |
| MCP server definitions without credentials | Usually | Versioned config template |
| Default UI/compaction preferences | Usually | Example settings |
| Private provider catalog | Sometimes | Private profile repository |
| API keys and OAuth credentials | No | `/login`, env, OS credential store |
| Sessions and reports | No by default | Review/redact individually |
| Trust decisions and caches | No | Recreate locally |
| Downloaded papers/Zotero data | No by default | User-owned local storage |

## Private overlay pattern

Keep organization-specific settings in a separate private repository or local files:

```text
public yimo-pi-kit
+ private team models/settings
+ each user's credentials
```

Do not fork the public package merely to add a key. Reference environment variables instead.
