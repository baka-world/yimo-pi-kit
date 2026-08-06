# Release guide

## 1. Prepare metadata

Before the first public release, add the real repository URL, issue tracker, and homepage to `package.json`. Confirm that the npm package name is available and that every bundled file may be redistributed.

## 2. Validate

```bash
npm ci --ignore-scripts
npm run check
npm run audit:prod
npm pack --dry-run
```

Inspect the tarball file list. It must not contain credentials, sessions, caches, local binaries, downloaded data, backups, or absolute personal paths.

## 3. Test in isolation

```bash
TEST_DIR="$(mktemp -d)"
PI_CODING_AGENT_DIR="$TEST_DIR" pi install /absolute/path/to/yimo-pi-kit
PI_CODING_AGENT_DIR="$TEST_DIR" pi --no-session
```

Verify:

- startup has no extension errors;
- `/kit doctor` and `/kit agents` work;
- `setup-deepseek` safely merges into an empty and an existing `models.json`;
- `/deepseek-websearch` loads and only matching Responses API requests receive `web_search`;
- `/skill:backend-engineering` loads;
- `/implement` expands;
- the subagent tool can run a bundled local-only agent without MCP;
- agents requiring optional skills or MCP degrade honestly rather than claiming unavailable capabilities;
- `pi config` can disable resources;
- no external package is installed by an npm lifecycle script.

## 4. Git release

```bash
git status --short
git tag -s v0.2.0 -m "yimo-pi-kit v0.2.0"
git push origin main --tags
```

Consumers install the tag:

```bash
pi install git:github.com/YOUR_ACCOUNT/yimo-pi-kit@v0.2.0
```

Pinned Git refs are not advanced by `pi update --extensions`; publish a new tag and update the install source explicitly.

## 5. npm release

```bash
npm login
npm publish --access public
```

Consumers install:

```bash
pi install npm:yimo-pi-kit@0.2.0
```

Use semantic versioning. Treat changes to agent behavior, tool permissions, automatic side effects, resource names, MCP servers, and required Pi APIs as release-significant.

## 6. Post-release

- verify the npm tarball and Pi package gallery entry;
- install from the public source into a fresh config directory;
- publish checksums and release notes;
- never rewrite an existing Git tag or npm version;
- rotate any credential immediately if a release artifact or Git history ever contains it.
