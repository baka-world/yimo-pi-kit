#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const checked = [];

function fail(message) {
  errors.push(message);
}

function walk(directory, relative = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (relative === "" && [".git", "node_modules"].includes(entry.name)) continue;
    const rel = path.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) {
      fail(`symlink is not publishable: ${rel}`);
      continue;
    }
    if (stats.isDirectory()) walk(absolute, rel);
    else if (stats.isFile()) checked.push(rel);
  }
}

function parseJson(relative) {
  try {
    return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    fail(`invalid JSON ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function frontmatter(relative) {
  const text = readFileSync(path.join(root, relative), "utf8");
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) {
    fail(`missing frontmatter: ${relative}`);
    return "";
  }
  return match[1];
}

function parseFrontmatter(relative) {
  const text = frontmatter(relative);
  if (!text) return null;
  try {
    return YAML.parse(text);
  } catch (error) {
    fail(`invalid YAML frontmatter in ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

walk(root);

for (const relative of checked) {
  if (relative.split(path.sep).includes("__pycache__") || /[.]py[co]$/.test(relative)) {
    fail(`Python cache artifact is not publishable: ${relative}`);
  }

  const absolute = path.join(root, relative);
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");

  const forbidden = [
    [/\/home\/yimo(?:\/|\b)/g, "personal absolute path"],
    [/100\.64\.0\.32/g, "private gateway address"],
    [new RegExp(`codex${"-"}compact`, "g"), "private provider name"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "private key material"],
    [/\bghp_[A-Za-z0-9]{20,}\b/g, "GitHub token"],
    [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, "API key"],
    [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "Slack token"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) fail(`${label} found in ${relative}`);
    pattern.lastIndex = 0;
  }
}

const forbiddenTopLevel = [
  "auth.json",
  "secrets",
  "sessions",
  "trust.json",
  "mcp-cache.json",
  "models-store.json",
  "state",
  ".code-review-graph",
  "data",
  "backups",
];
for (const name of forbiddenTopLevel) {
  try {
    statSync(path.join(root, name));
    fail(`forbidden runtime state present: ${name}`);
  } catch {}
}

const packageJson = parseJson("package.json");
if (packageJson) {
  if (packageJson.private === true) fail("package.json must not be private for publication");
  if (!packageJson.keywords?.includes("pi-package")) fail("package.json must include the pi-package keyword");
  for (const kind of ["extensions", "skills", "prompts", "themes"]) {
    for (const resource of packageJson.pi?.[kind] ?? []) {
      const resolved = path.resolve(root, resource);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        fail(`Pi ${kind} resource escapes package root: ${resource}`);
        continue;
      }
      try {
        statSync(resolved);
      } catch {
        fail(`missing Pi ${kind} resource: ${resource}`);
      }
    }
  }
  if (!packageJson.pi?.extensions?.includes("./extensions/deepseek-web-search.ts")) {
    fail("DeepSeek Web Search extension is missing from the Pi manifest");
  }

  // Reverse validation: every bundled resource must be registered in the Pi manifest.
  const extensionEntries = checked
    .filter(
      (file) =>
        file.startsWith("extensions/") &&
        (file.endsWith("/index.ts") || (file.endsWith(".ts") && !file.slice("extensions/".length).includes("/"))),
    )
    .map((file) => `./${file}`);
  for (const resource of extensionEntries) {
    if (!packageJson.pi?.extensions?.includes(resource)) fail(`unregistered Pi extension: ${resource}`);
  }
  for (const [kind, pattern] of [
    ["skills", /^skills\/[^/]+\/SKILL\.md$/],
    ["prompts", /^prompts\/[^/]+\.md$/],
    ["themes", /^themes\/[^/]+\.json$/],
  ]) {
    for (const relative of checked.filter((file) => pattern.test(file))) {
      const resource = `./${relative}`;
      if (!packageJson.pi?.[kind]?.includes(resource)) fail(`unregistered Pi ${kind.slice(0, -1)}: ${resource}`);
    }
  }
}

for (const relative of checked.filter((file) => file.endsWith(".json"))) parseJson(relative);

const modelsExample = parseJson("examples/models.example.json");
const deepseekProvider = modelsExample?.providers?.deepseek;
const deepseekResponsesModel = Array.isArray(deepseekProvider?.models)
  ? deepseekProvider.models.find((model) => model?.id === "deepseek-v4-flash")
  : undefined;
if (!deepseekResponsesModel) fail("examples/models.example.json is missing deepseek-v4-flash");
else {
  if (deepseekResponsesModel.api !== "openai-responses") fail("DeepSeek V4 Flash example must use openai-responses");
  if (deepseekResponsesModel.baseUrl !== "https://api.deepseek.com") fail("DeepSeek example must use the public API endpoint");
  if (deepseekResponsesModel.compat?.supportsToolSearch !== false) {
    fail("DeepSeek Responses example must disable client-side tool search");
  }
}
if (deepseekProvider && ["apiKey", "apiKeys", "apiKeyFile"].some((key) => key in deepseekProvider)) {
  fail("DeepSeek example must not contain credential fields");
}

const sources = parseJson("scripts/skill-sources.json");
const optionalSkillNames = new Set(Object.keys(sources?.skills ?? {}));

for (const relative of checked.filter((file) => file.startsWith("agents/") && file.endsWith(".md"))) {
  const metadata = frontmatter(relative);
  parseFrontmatter(relative);
  if (!/^name:\s*\S+/m.test(metadata)) fail(`agent missing name: ${relative}`);
  if (!/^description:\s*\S+/m.test(metadata)) fail(`agent missing description: ${relative}`);

  const agentDirectory = path.dirname(path.join(root, relative));
  const mcpMatch = metadata.match(/^mcpConfig:\s*(\S+)\s*$/m);
  if (mcpMatch) {
    const mcpPath = path.resolve(agentDirectory, mcpMatch[1]);
    if (mcpPath !== root && !mcpPath.startsWith(`${root}${path.sep}`)) fail(`agent MCP config escapes package: ${relative}`);
    else if (!checked.includes(path.relative(root, mcpPath))) fail(`agent MCP config is missing: ${relative} -> ${mcpMatch[1]}`);
  }

  const skillsMatch = metadata.match(/^skills:\s*(.+)$/m);
  for (const skillReference of skillsMatch?.[1].split(",").map((value) => value.trim()).filter(Boolean) ?? []) {
    const skillPath = path.resolve(agentDirectory, skillReference);
    const relativeSkillPath = path.relative(path.join(root, "skills"), skillPath);
    const skillName = path.basename(skillPath);
    if (relativeSkillPath.startsWith("..") || path.isAbsolute(relativeSkillPath)) {
      fail(`agent skill escapes skills root: ${relative} -> ${skillReference}`);
    } else if (!checked.includes(path.join("skills", relativeSkillPath, "SKILL.md")) && !optionalSkillNames.has(skillName)) {
      fail(`agent references unknown skill: ${relative} -> ${skillName}`);
    }
  }
}

for (const relative of checked.filter((file) => file.endsWith("SKILL.md"))) {
  const metadata = frontmatter(relative);
  parseFrontmatter(relative);
  if (!/^name:\s*\S+/m.test(metadata)) fail(`skill missing name: ${relative}`);
  if (!/^description:\s*[>|]?\s*\S+/m.test(metadata)) fail(`skill missing description: ${relative}`);
}

for (const relative of checked.filter((file) => file.startsWith("mcp/") && file.endsWith(".json"))) {
  const config = parseJson(relative);
  for (const [name, server] of Object.entries(config?.mcpServers ?? {})) {
    if (typeof server.command !== "string" || !server.command) fail(`${relative}: ${name} has no command`);
    if (path.isAbsolute(server.command ?? "")) fail(`${relative}: ${name} uses an absolute command path`);
    if (server.cwd && path.isAbsolute(server.cwd)) fail(`${relative}: ${name} uses an absolute cwd`);
  }
}

for (const [name, source] of Object.entries(sources?.sources ?? {})) {
  if (!/^[a-z0-9-]+$/.test(name)) fail(`unsafe skill source name: ${name}`);
  if (!/^[0-9a-f]{40}$/.test(source.ref ?? "")) fail(`skill source ${name} is not pinned to a full commit`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(source.url ?? "")) {
    fail(`skill source ${name} is not a canonical HTTPS GitHub URL`);
  }
  if (!Array.isArray(source.paths) || source.paths.length === 0) fail(`skill source ${name} has no sparse paths`);
  for (const sourcePath of source.paths ?? []) {
    if (typeof sourcePath !== "string" || path.isAbsolute(sourcePath) || sourcePath.split(/[\\/]+/).includes("..")) {
      fail(`skill source ${name} has unsafe sparse path: ${sourcePath}`);
    }
  }
}

const allowedProfiles = new Set(["academic", "architecture", "backend", "frontend", "security", "code-review", "all"]);
for (const [name, skill] of Object.entries(sources?.skills ?? {})) {
  if (!/^[a-z0-9-]+$/.test(name)) fail(`unsafe optional skill name: ${name}`);
  const source = sources?.sources?.[skill.source];
  if (!source) fail(`optional skill ${name} references unknown source: ${skill.source}`);
  if (typeof skill.path !== "string" || path.isAbsolute(skill.path) || skill.path.split(/[\\/]+/).includes("..")) {
    fail(`optional skill ${name} has unsafe path: ${skill.path}`);
  } else if (source && !(source.paths ?? []).some((entry) => skill.path === entry || skill.path.startsWith(`${entry}/`))) {
    fail(`optional skill ${name} is outside sparse paths for ${skill.source}: ${skill.path}`);
  }
  if (!Array.isArray(skill.profiles) || skill.profiles.length === 0 || skill.profiles.some((profile) => !allowedProfiles.has(profile))) {
    fail(`optional skill ${name} has invalid profiles`);
  }
}

const codeReviewSource = sources?.sources?.["code-review-graph"];
const expectedCodeReviewSkills = ["build-graph", "review-changes", "review-delta", "review-pr"];
if (codeReviewSource?.ref !== "6a1ee1c7063cc35cfa5ff12b8198c29360f3e4ad") {
  fail("code-review-graph skills must be pinned to the audited v2.3.7 commit");
}
for (const name of expectedCodeReviewSkills) {
  const skill = sources?.skills?.[name];
  if (skill?.source !== "code-review-graph" || skill?.profiles?.length !== 1 || skill.profiles[0] !== "code-review") {
    fail(`code-review-graph skill ${name} must be isolated to the code-review profile`);
  }
}

const codeReviewMcp = parseJson("mcp/code-review.json");
const codeReviewServer = codeReviewMcp?.mcpServers?.["code-review-graph"];
const expectedCodeReviewTools = [
  "build_or_update_graph_tool",
  "get_minimal_context_tool",
  "get_impact_radius_tool",
  "query_graph_tool",
  "semantic_search_nodes_tool",
  "get_review_context_tool",
  "list_graph_stats_tool",
  "get_docs_section_tool",
  "get_affected_flows_tool",
  "detect_changes_tool",
];
if (!codeReviewServer) fail("mcp/code-review.json is missing code-review-graph");
else {
  const args = codeReviewServer.args ?? [];
  const packageSpec = args[args.indexOf("--from") + 1];
  const toolsValue = args[args.indexOf("--tools") + 1];
  const commandTools = typeof toolsValue === "string" ? toolsValue.split(",") : [];
  if (codeReviewServer.command !== "uvx") fail("code-review-graph MCP must use portable uvx");
  if (packageSpec !== "code-review-graph @ https://files.pythonhosted.org/packages/f3/8f/2df3fcca285b489d195706b09cefda3e57e7158185cb83905200d7b27199/code_review_graph-2.3.7-py3-none-any.whl#sha256=12196dce3e673bdec7fba97ae5c4dff7589adee73a721374f62efae76e0fdd88") {
    fail("code-review-graph MCP primary wheel is not pinned to the audited 2.3.7 artifact and hash");
  }
  for (const requiredArg of ["--isolated", "--no-config", "--no-env-file", "--no-python-downloads", "--no-build", "--no-sources", "--no-progress", "serve", "--tools"]) {
    if (!args.includes(requiredArg)) fail(`code-review-graph MCP is missing hardened argument ${requiredArg}`);
  }
  const pythonIndex = args.indexOf("--python");
  const linkModeIndex = args.indexOf("--link-mode");
  const fromIndex = args.indexOf("--from");
  if (pythonIndex < 0 || args[pythonIndex + 1] !== "__YIMO_PI_KIT_PYTHON__") {
    fail("code-review-graph MCP must resolve a reviewed local Python interpreter during setup");
  }
  if (linkModeIndex < 0 || args[linkModeIndex + 1] !== "copy") {
    fail("code-review-graph MCP must copy, not symlink, uv cache artifacts into its environment");
  }
  if (
    fromIndex < 0 ||
    args[fromIndex + 2] !== "python" ||
    args[fromIndex + 3] !== "-I" ||
    args[fromIndex + 4] !== "__YIMO_PI_KIT_CODE_REVIEW_RUNNER__"
  ) {
    fail("code-review-graph MCP must start through the hardened package runner");
  }
  const withIndex = args.indexOf("--with");
  const packageCutoffIndex = args.indexOf("--exclude-newer-package");
  if (withIndex < 0 || args[withIndex + 1] !== "cryptography==50.0.0") {
    fail("code-review-graph MCP must pin the audited cryptography security override");
  }
  if (packageCutoffIndex < 0 || args[packageCutoffIndex + 1] !== "cryptography=2026-07-31T14:25:11Z") {
    fail("code-review-graph MCP cryptography override must retain its artifact cutoff");
  }
  for (const forbiddenArg of ["install", "--http", "--auto-watch"]) {
    if (args.includes(forbiddenArg)) fail(`code-review-graph MCP must not use ${forbiddenArg}`);
  }
  if (JSON.stringify(commandTools) !== JSON.stringify(expectedCodeReviewTools)) {
    fail("code-review-graph MCP command tool allowlist drifted");
  }
  if (JSON.stringify(codeReviewServer.includeTools) !== JSON.stringify(expectedCodeReviewTools)) {
    fail("code-review-graph MCP adapter tool allowlist drifted");
  }
  if (codeReviewServer.env?.CRG_TOOLS !== toolsValue) fail("code-review-graph defense-in-depth environment tool allowlist drifted");
  const requiredEnv = {
    UV_ISOLATED: "1",
    UV_NO_CONFIG: "1",
    UV_NO_ENV_FILE: "1",
    UV_NO_SOURCES: "1",
    UV_NO_BUILD: "1",
    UV_LINK_MODE: "copy",
    UV_NO_PROGRESS: "1",
    UV_INDEX_STRATEGY: "first-index",
    UV_PRERELEASE: "disallow",
    UV_PYTHON_DOWNLOADS: "never",
    PYTHONPATH: "",
    PYTHONHOME: "",
    PYTHONNOUSERSITE: "1",
    PYTHONSAFEPATH: "1",
    NODE_OPTIONS: "",
    NODE_PATH: "",
    FASTMCP_ENV_FILE: "__YIMO_PI_KIT_FASTMCP_ENV__",
    FASTMCP_HOME: "__YIMO_PI_KIT_FASTMCP_HOME__",
    FASTMCP_TRANSPORT: "stdio",
    FASTMCP_CHECK_FOR_UPDATES: "off",
    FASTMCP_SHOW_SERVER_BANNER: "false",
    FASTMCP_DEBUG: "false",
    FASTMCP_DOCKET_URL: "memory://",
    OTEL_PROPAGATORS: "none",
    OTEL_PYTHON_TRACER_PROVIDER: "default_tracer_provider",
    OTEL_PYTHON_METER_PROVIDER: "default_meter_provider",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    CRG_REPO_ROOT: "",
    CRG_DATA_DIR: "",
    CRG_RECURSE_SUBMODULES: "0",
    CRG_ALLOW_REMOTE_CODE: "0",
    CRG_PARSE_EXECUTOR: "thread",
    CRG_BFS_ENGINE: "sql",
    CRG_MAX_IMPACT_DEPTH: "2",
    CRG_MAX_SEARCH_RESULTS: "20",
    CRG_ACCEPT_CLOUD_EMBEDDINGS: "0",
    YIMO_PI_KIT_NODE: "__YIMO_PI_KIT_NODE__",
    YIMO_PI_KIT_GIT_SHIM: "__YIMO_PI_KIT_GIT_SHIM__",
    YIMO_PI_KIT_CODE_REVIEW_PROFILE: "managed-v1",
  };
  for (const [key, value] of Object.entries(requiredEnv)) {
    if (codeReviewServer.env?.[key] !== value) fail(`code-review-graph hardened environment drifted: ${key}`);
  }
  if (codeReviewServer.env?.HOME !== "${HOME}/.cache/yimo-pi-kit/code-review-graph-home") {
    fail("code-review-graph MCP must isolate its upstream user registry");
  }
  if (codeReviewServer.env?.UV_CACHE_DIR !== "${HOME}/.cache/yimo-pi-kit/code-review-graph-uv") {
    fail("code-review-graph MCP must use its dedicated uv cache");
  }
  if (codeReviewServer.directTools !== false) fail("code-review-graph tools must remain proxy-only by default");
  if (codeReviewServer.lifecycle !== "lazy") fail("code-review-graph MCP must start lazily");
  if (codeReviewServer.exposeResources !== false) fail("code-review-graph MCP resources must remain hidden");
  for (const key of ["CRG_EMBEDDING_MODEL", "CRG_OPENAI_API_KEY", "CRG_OPENAI_BASE_URL", "CRG_OPENAI_MODEL", "CRG_OPENAI_BATCH_SIZE", "CRG_OPENAI_DIMENSION", "MINIMAX_API_KEY", "GOOGLE_API_KEY"]) {
    if (codeReviewServer.env?.[key] !== "") fail(`code-review-graph MCP must clear inherited cloud embedding setting ${key}`);
  }
  if (codeReviewServer.cwd !== undefined || codeReviewServer.url !== undefined || codeReviewServer.socket !== undefined) {
    fail("code-review-graph MCP must inherit the active Pi repository cwd and remain local stdio");
  }
}

/**
 * Manifest resource lists must be explicit, sorted, and complete.
 *
 * pi resolves a directory entry (e.g. "./skills") with readdirSync in
 * filesystem order, which is not guaranteed stable across runs/machines.
 * The system prompt is assembled from these resources, so any reordering on
 * /reload changes the prompt prefix and invalidates provider-side prompt
 * caches. Explicit sorted file lists keep the resolved order deterministic.
 */
function checkDeterministicResourceLists() {
  const pkg = parseJson("package.json");
  if (!pkg?.pi) return;
  const matchers = {
    skills: /^skills\/[^/]+\/SKILL\.md$/,
    prompts: /^prompts\/[^/]+\.md$/,
    themes: /^themes\/[^/]+\.json$/,
  };
  for (const [resourceType, matcher] of Object.entries(matchers)) {
    const base = path.join(root, resourceType);
    const discovered = [];
    if (existsSync(base)) {
      const walkDir = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkDir(full);
          else discovered.push(path.relative(root, full).split(path.sep).join("/"));
        }
      };
      walkDir(base);
    }
    const expected = discovered.filter((f) => matcher.test(f)).sort();
    const declared = (pkg.pi[resourceType] ?? []).map((p) => p.replace(/^\.\//, "")).sort();
    for (const f of expected) {
      if (!declared.includes(f)) {
        fail(`pi.${resourceType} must list ${f} explicitly (directory scan order is non-deterministic)`);
      }
    }
    for (const f of declared) {
      if (!expected.includes(f)) fail(`pi.${resourceType} lists ${f} which is missing or out of scope`);
    }
    if (JSON.stringify(declared) !== JSON.stringify([...declared].sort())) {
      fail(`pi.${resourceType} entries must be sorted alphabetically for deterministic prompt prefixes`);
    }
  }
}

const codeReviewRunner = readFileSync(path.join(root, "scripts", "code-review-runner.py"), "utf8");
for (const marker of [
  "LOCKED_ROOT = _find_locked_root()",
  "os.umask(0o077)",
  "subprocess.run = _guarded_subprocess_run",
  "incremental.get_data_dir = _safe_graph_data_dir",
  "server._resolve_repo_root = _locked_repo_root",
  "include_source=False",
  "embedding_provider=None",
  "server.mcp.local_provider.remove_prompt",
  "refusing hard-linked graph data file",
  '"YIMO_PI_KIT_CODE_REVIEW_PROFILE": "managed-v1"',
  "Unix-domain sockets can expose privileged local services",
  "socket.gethostbyname = _guarded_gethostbyname",
]) {
  if (!codeReviewRunner.includes(marker)) fail(`hardened code-review runner is missing marker: ${marker}`);
}

if (process.platform !== "win32") {
  for (const script of ["scripts/cli.mjs", "scripts/check.mjs"]) {
    if ((statSync(path.join(root, script)).mode & 0o111) === 0) fail(`script is not executable: ${script}`);
  }
}

checkDeterministicResourceLists();

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${checked.length} publishable files: no symlinks, private paths, obvious secrets, or invalid manifests found.`);
}
