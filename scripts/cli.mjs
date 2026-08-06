#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import stripJsonComments from "strip-json-comments";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const skillManifest = JSON.parse(readFileSync(path.join(root, "scripts", "skill-sources.json"), "utf8"));

function agentDir() {
  return path.resolve(
    process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"),
  );
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "sh";
  const args = process.platform === "win32" ? [command] : ["-lc", "command -v -- \"$1\"", "sh", command];
  return spawnSync(probe, args, { stdio: "ignore" }).status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout,
  });
  if (result.error || result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    const cause = result.error instanceof Error ? `: ${result.error.message}` : detail ? `: ${detail}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${cause}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function runWithRetry(command, args, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return run(command, args, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.error(`Retrying ${command} after attempt ${attempt}/${attempts} failed...`);
      sleep(attempt * 1500);
    }
  }
  throw lastError;
}

function parseJsonFile(file) {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(stripJsonComments(readFileSync(file, "utf8"), { trailingCommas: true }));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return parsed;
}

function mergeMissing(base, existing) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return existing ?? base;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return structuredClone(base);
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(existing)) {
    output[key] = key in output ? mergeMissing(output[key], value) : structuredClone(value);
  }
  return output;
}

function mergeForce(existing, overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return structuredClone(overlay);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return structuredClone(overlay);
  const output = structuredClone(existing);
  for (const [key, value] of Object.entries(overlay)) {
    output[key] = key in output ? mergeForce(output[key], value) : structuredClone(value);
  }
  return output;
}

function mergeModelsById(existingModels, templateModels, force, providerBaseUrl) {
  const output = Array.isArray(existingModels) ? structuredClone(existingModels) : [];
  const summary = { added: 0, updated: 0, preserved: 0 };
  for (const templateModel of templateModels) {
    const index = output.findIndex((model) => model && typeof model === "object" && model.id === templateModel.id);
    if (index < 0) {
      const addedModel = structuredClone(templateModel);
      if (typeof providerBaseUrl === "string" && providerBaseUrl) addedModel.baseUrl = providerBaseUrl;
      output.push(addedModel);
      summary.added++;
    } else if (force) {
      const existingModel = output[index];
      const preservedEndpoint = typeof existingModel.baseUrl === "string" && existingModel.baseUrl
        ? existingModel.baseUrl
        : typeof providerBaseUrl === "string" && providerBaseUrl
          ? providerBaseUrl
          : undefined;
      output[index] = mergeForce(existingModel, templateModel);
      if (preservedEndpoint) output[index].baseUrl = preservedEndpoint;
      summary.updated++;
    } else {
      summary.preserved++;
    }
  }
  return { models: output, summary };
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch {}
  } finally {
    try { rmSync(tmp, { force: true }); } catch {}
  }
}

function backupFile(file) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlinked configuration file: ${file}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.bak-${stamp}`;
  copyFileSync(file, backup);
  try { chmodSync(backup, 0o600); } catch {}
  return backup;
}

function parseFlags(args) {
  const flags = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "--copy" || arg === "--json") {
      flags[arg.slice(2)] = true;
    } else if (arg === "--target" && args[i + 1]) {
      flags.target = args[++i];
    } else if (arg.startsWith("--target=")) {
      flags.target = arg.slice("--target=".length);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function doctor({ json = false } = {}) {
  const checks = [];
  const add = (name, ok, detail, required = true) => checks.push({ name, ok, detail, required });

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  add("node >= 22.19.0", nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 19), process.versions.node);
  add("pi", commandExists("pi"), commandExists("pi") ? "found" : "not found");
  for (const command of ["npm", "npx", "git", "uvx"]) {
    add(command, commandExists(command), commandExists(command) ? "found" : "optional feature unavailable", false);
  }

  const mcpPath = path.join(agentDir(), "mcp.json");
  try {
    parseJsonFile(mcpPath);
    add("global MCP config", existsSync(mcpPath), existsSync(mcpPath) ? mcpPath : "not installed", false);
  } catch (error) {
    add("global MCP config", false, error instanceof Error ? error.message : String(error));
  }

  const adapterCandidates = [
    path.join(root, "node_modules", "pi-mcp-adapter", "index.ts"),
    path.join(agentDir(), "npm", "node_modules", "pi-mcp-adapter", "index.ts"),
  ];
  const adapterPath = adapterCandidates.find((candidate) => existsSync(candidate));
  add("pi-mcp-adapter", Boolean(adapterPath), adapterPath || "optional; install pi-mcp-adapter@2.15.0 for MCP", false);

  const modelsPath = path.join(agentDir(), "models.json");
  try {
    const modelsConfig = parseJsonFile(modelsPath);
    const deepseekModels = modelsConfig.providers?.deepseek?.models;
    const responsesModel = Array.isArray(deepseekModels)
      ? deepseekModels.find((model) => model?.id === "deepseek-v4-flash" && model?.api === "openai-responses")
      : undefined;
    add(
      "DeepSeek V4 Flash Responses API",
      Boolean(responsesModel),
      responsesModel ? `configured in ${modelsPath}` : "optional; run setup-deepseek",
      false,
    );
  } catch (error) {
    add("DeepSeek V4 Flash Responses API", false, error instanceof Error ? error.message : String(error), false);
  }

  const report = {
    package: `${packageJson.name}@${packageJson.version}`,
    root,
    agentDir: agentDir(),
    checks,
    ok: checks.filter((check) => check.required).every((check) => check.ok),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.package}\nroot: ${root}\nagent dir: ${report.agentDir}\n`);
    for (const check of checks) {
      console.log(`${check.ok ? "✓" : check.required ? "✗" : "○"} ${check.name}: ${check.detail}`);
    }
  }
  return report.ok ? 0 : 1;
}

function setupMcp(args) {
  const flags = parseFlags(args);
  const target = path.resolve(flags.target || path.join(agentDir(), "mcp.json"));
  if (lexicalPathExists(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing symlinked MCP target: ${target}`);
  }
  const template = parseJsonFile(path.join(root, "mcp", "global.json"));
  const existing = parseJsonFile(target);
  const next = flags.force ? mergeForce(existing, template) : mergeMissing(template, existing);
  const backup = backupFile(target);
  writeJsonAtomic(target, next);

  console.log(`MCP configuration written to ${target}`);
  if (backup) console.log(`Previous configuration backed up to ${backup}`);
  console.log("Existing server definitions were preserved unless --force was supplied.");
  console.log("Install the parent-session adapter with: pi install npm:pi-mcp-adapter@2.15.0");
  console.log("Python MCP servers require uvx; Node MCP servers require npx.");
}

function setupDeepseek(args) {
  const flags = parseFlags(args);
  const target = path.resolve(flags.target || path.join(agentDir(), "models.json"));
  if (lexicalPathExists(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing symlinked models target: ${target}`);
  }

  const example = parseJsonFile(path.join(root, "examples", "models.example.json"));
  const templateProvider = example.providers?.deepseek;
  if (!templateProvider || typeof templateProvider !== "object" || Array.isArray(templateProvider) || !Array.isArray(templateProvider.models)) {
    throw new Error("DeepSeek model template is missing or invalid");
  }

  const existing = parseJsonFile(target);
  const next = structuredClone(existing);
  if (!next.providers || typeof next.providers !== "object" || Array.isArray(next.providers)) next.providers = {};

  const existingProvider = next.providers.deepseek;
  const providerBase = existingProvider && typeof existingProvider === "object" && !Array.isArray(existingProvider)
    ? existingProvider
    : {};
  const { models: templateModels, ...templateSettings } = templateProvider;
  const mergedProvider = flags.force
    ? mergeForce(providerBase, templateSettings)
    : mergeMissing(templateSettings, providerBase);
  const { models, summary } = mergeModelsById(
    providerBase.models,
    templateModels,
    Boolean(flags.force),
    providerBase.baseUrl,
  );
  mergedProvider.models = models;
  next.providers.deepseek = mergedProvider;

  const backup = backupFile(target);
  writeJsonAtomic(target, next);

  console.log(`DeepSeek Responses configuration written to ${target}`);
  if (backup) console.log(`Previous configuration backed up to ${backup}`);
  console.log(`Models added: ${summary.added}; updated: ${summary.updated}; preserved: ${summary.preserved}.`);
  if (summary.preserved > 0 && !flags.force) {
    console.log("Existing model definitions won. Re-run with --force to replace matching DeepSeek model fields.");
  }
  console.log("Authenticate with Pi /login or set DEEPSEEK_API_KEY, then select deepseek/deepseek-v4-flash.");
}

function lexicalPathExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function removeExistingTarget(target) {
  if (!lexicalPathExists(target)) return;
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) {
    rmSync(target);
    return;
  }
  throw new Error(`Refusing to replace non-symlink path: ${target}`);
}

function ensureSource(name, source) {
  if (!commandExists("git")) throw new Error("git is required to install optional skills");
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe source name: ${name}`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(source.url ?? "")) {
    throw new Error(`Unsafe source URL for ${name}`);
  }
  if (!/^[0-9a-f]{40}$/.test(source.ref ?? "")) throw new Error(`Source ${name} is not pinned to a full commit`);
  if (!Array.isArray(source.paths) || source.paths.length === 0 || source.paths.some((entry) => typeof entry !== "string" || path.isAbsolute(entry) || entry.split(/[\\/]+/).includes(".."))) {
    throw new Error(`Unsafe sparse-checkout paths for ${name}`);
  }

  const sourcesRoot = path.join(agentDir(), "sources", "yimo-pi-kit");
  const destination = path.join(sourcesRoot, name);
  const hooksPath = path.join(sourcesRoot, ".disabled-git-hooks");
  const isolatedGitConfig = path.join(sourcesRoot, ".isolated-gitconfig");
  mkdirSync(sourcesRoot, { recursive: true, mode: 0o700 });
  mkdirSync(hooksPath, { recursive: true, mode: 0o700 });
  if (!lexicalPathExists(isolatedGitConfig)) {
    writeFileSync(isolatedGitConfig, "", { mode: 0o600, flag: "wx" });
  }
  if (lstatSync(isolatedGitConfig).isSymbolicLink()) {
    throw new Error(`Refusing symlinked isolated Git config: ${isolatedGitConfig}`);
  }
  const gitEnvironment = {
    GIT_CONFIG_GLOBAL: isolatedGitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };

  if (lexicalPathExists(destination) && lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Refusing symlinked source checkout: ${destination}`);
  }
  if (!existsSync(path.join(destination, ".git"))) {
    if (lexicalPathExists(destination)) throw new Error(`Source path exists but is not a Git repository: ${destination}`);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    run("git", ["-c", `core.hooksPath=${hooksPath}`, "-c", "init.defaultBranch=main", "init", "--quiet"], {
      cwd: destination,
      env: gitEnvironment,
    });
    run("git", ["-c", `core.hooksPath=${hooksPath}`, "remote", "add", "origin", source.url], {
      cwd: destination,
      env: gitEnvironment,
    });
  }

  const remote = run("git", ["remote", "get-url", "origin"], {
    cwd: destination,
    capture: true,
    env: gitEnvironment,
  });
  if (remote !== source.url) throw new Error(`Unexpected origin for ${name}: ${remote}`);
  const gitArgs = ["-c", `core.hooksPath=${hooksPath}`];
  run("git", [...gitArgs, "sparse-checkout", "init", "--cone"], { cwd: destination, env: gitEnvironment });
  run("git", [...gitArgs, "sparse-checkout", "set", ...source.paths], { cwd: destination, env: gitEnvironment });
  runWithRetry("git", [...gitArgs, "fetch", "--depth", "1", "--filter=blob:none", "origin", source.ref], {
    cwd: destination,
    env: gitEnvironment,
    timeout: 180000,
  });
  run("git", [...gitArgs, "checkout", "--detach", "--force", "FETCH_HEAD"], {
    cwd: destination,
    env: gitEnvironment,
  });
  run("git", [...gitArgs, "clean", "-ffdx"], { cwd: destination, env: gitEnvironment });
  const checkedOutRef = run("git", ["rev-parse", "HEAD"], {
    cwd: destination,
    capture: true,
    env: gitEnvironment,
  });
  if (checkedOutRef !== source.ref) throw new Error(`Pinned commit mismatch for ${name}: ${checkedOutRef}`);
  return destination;
}

function assertSafeSkillTree(directory, displayRoot = directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing symlink in optional skill: ${path.relative(displayRoot, candidate)}`);
    }
    if (stats.isDirectory()) assertSafeSkillTree(candidate, displayRoot);
  }
}

function copyUpstreamNotices(sourceRoot, target) {
  const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "NOTICE", "NOTICE.md", "NOTICE.txt"];
  for (const name of candidates) {
    const source = path.join(sourceRoot, name);
    if (!lexicalPathExists(source)) continue;
    const stats = lstatSync(source);
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    const prefix = name.toUpperCase().startsWith("NOTICE") ? "UPSTREAM_NOTICE" : "UPSTREAM_LICENSE";
    const extension = path.extname(name);
    const destination = path.join(target, `${prefix}${extension}`);
    if (!lexicalPathExists(destination)) copyFileSync(source, destination);
  }
}

function installSkills(args) {
  const flags = parseFlags(args);
  const profile = flags.positional[0] || "all";
  const allowedProfiles = new Set(["academic", "architecture", "backend", "frontend", "security", "all"]);
  if (!allowedProfiles.has(profile)) {
    throw new Error(`Unknown profile ${profile}. Choose: ${[...allowedProfiles].join(", ")}`);
  }

  const selected = Object.entries(skillManifest.skills).filter(([, definition]) => definition.profiles.includes(profile));
  if (selected.length === 0) {
    console.log(`No optional skills are defined for profile ${profile}.`);
    return;
  }

  console.log("This command downloads third-party repositories. Review their licenses in THIRD_PARTY_NOTICES.md.");
  const sourceNames = [...new Set(selected.map(([, definition]) => definition.source))];
  const sourcePaths = new Map();
  for (const sourceName of sourceNames) {
    const source = skillManifest.sources[sourceName];
    if (!source) throw new Error(`Unknown source in skill manifest: ${sourceName}`);
    sourcePaths.set(sourceName, ensureSource(sourceName, source));
  }

  const skillsRoot = path.join(agentDir(), "skills");
  mkdirSync(skillsRoot, { recursive: true });

  for (const [skillName, definition] of selected) {
    if (!/^[a-z0-9-]+$/.test(skillName)) throw new Error(`Unsafe skill name: ${skillName}`);
    if (typeof definition.path !== "string" || path.isAbsolute(definition.path) || definition.path.split(/[\\/]+/).includes("..")) {
      throw new Error(`Unsafe source path for ${skillName}`);
    }
    const sourceRoot = sourcePaths.get(definition.source);
    const sourcePath = path.join(sourceRoot, definition.path);
    if (!existsSync(sourcePath)) throw new Error(`Skill source does not exist after checkout: ${sourcePath}`);
    if (lstatSync(sourcePath).isSymbolicLink()) throw new Error(`Refusing symlinked skill directory: ${sourcePath}`);
    const resolvedSourcePath = realpathSync(sourcePath);
    const resolvedSourceRoot = realpathSync(sourceRoot);
    if (resolvedSourcePath !== resolvedSourceRoot && !resolvedSourcePath.startsWith(`${resolvedSourceRoot}${path.sep}`)) {
      throw new Error(`Skill source escapes its pinned repository: ${sourcePath}`);
    }
    if (!existsSync(path.join(resolvedSourcePath, "SKILL.md"))) {
      throw new Error(`Skill directory has no SKILL.md: ${sourcePath}`);
    }
    assertSafeSkillTree(resolvedSourcePath);
    const target = path.join(skillsRoot, skillName);

    if (flags.copy) {
      if (lexicalPathExists(target)) {
        const stats = lstatSync(target);
        if (!stats.isSymbolicLink()) throw new Error(`Refusing to overwrite existing skill: ${target}`);
        rmSync(target);
      }
      cpSync(resolvedSourcePath, target, { recursive: true, dereference: true });
      copyUpstreamNotices(resolvedSourceRoot, target);
    } else {
      removeExistingTarget(target);
      symlinkSync(resolvedSourcePath, target, process.platform === "win32" ? "junction" : "dir");
    }
    console.log(`✓ ${skillName}`);
  }

  console.log(`Installed ${selected.length} optional skills for profile ${profile}. Run /reload in Pi.`);
}

function usage() {
  console.log(`Usage: yimo-pi-kit <command> [options]\n\nCommands:\n  doctor [--json]\n      Check Pi, Node, package dependencies, DeepSeek setup, and optional MCP prerequisites.\n\n  setup-mcp [--target <path>] [--force]\n      Merge the portable MCP profile into the Pi global MCP config. Existing values win by default.\n\n  setup-deepseek [--target <path>] [--force]\n      Add DeepSeek V4 Flash using the Responses API to models.json. Matching models are preserved unless --force is supplied.\n\n  install-skills [academic|architecture|backend|frontend|security|all] [--copy]\n      Download pinned third-party skill repositories and link selected skills into the Pi agent directory.\n\n  help\n      Show this help.\n`);
}

const [command = "help", ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "doctor":
      process.exitCode = doctor(parseFlags(args));
      break;
    case "setup-mcp":
      setupMcp(args);
      break;
    case "setup-deepseek":
      setupDeepseek(args);
      break;
    case "install-skills":
      installSkills(args);
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(packageJson.version);
      break;
    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(`yimo-pi-kit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
