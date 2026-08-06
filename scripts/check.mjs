#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
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

walk(root);

for (const relative of checked) {
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

const allowedProfiles = new Set(["academic", "architecture", "backend", "frontend", "security", "all"]);
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

if (process.platform !== "win32") {
  for (const script of ["scripts/cli.mjs", "scripts/check.mjs"]) {
    if ((statSync(path.join(root, script)).mode & 0o111) === 0) fail(`script is not executable: ${script}`);
  }
}

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${checked.length} publishable files: no symlinks, private paths, obvious secrets, or invalid manifests found.`);
}
