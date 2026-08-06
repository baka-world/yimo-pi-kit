#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
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
const MCP_PROFILES = new Set(["global", "code-review"]);
const CODE_REVIEW_SKILLS = ["build-graph", "review-changes", "review-delta", "review-pr"];
const CODE_REVIEW_TOOLS = [
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
const CODE_REVIEW_RUNNER_PLACEHOLDER = "__YIMO_PI_KIT_CODE_REVIEW_RUNNER__";
const CODE_REVIEW_PYTHON_PLACEHOLDER = "__YIMO_PI_KIT_PYTHON__";
const CODE_REVIEW_NODE_PLACEHOLDER = "__YIMO_PI_KIT_NODE__";
const CODE_REVIEW_GIT_SHIM_PLACEHOLDER = "__YIMO_PI_KIT_GIT_SHIM__";
const CODE_REVIEW_RUNNER = path.join(root, "scripts", "code-review-runner.py");
const CODE_REVIEW_PROFILE_MARKER = "managed-v1";
const MANAGED_SKILL_MARKER = ".yimo-pi-kit-source.json";

function agentDir() {
  return path.resolve(
    process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"),
  );
}

function resolveCommandPath(command) {
  if (typeof command !== "string" || !command || command.includes("\0")) return undefined;
  const explicit = path.isAbsolute(command) || command.includes("/") || command.includes("\\");
  const directories = explicit ? [""] : (process.env.PATH ?? "").split(path.delimiter);
  const configuredExtensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  const hasWindowsExtension = process.platform === "win32" && /[.][A-Za-z0-9]+$/.test(command);
  const extensions = hasWindowsExtension ? [""] : configuredExtensions;
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = explicit
        ? `${command}${extension}`
        : path.join(directory || ".", `${command}${extension}`);
      try {
        const stats = lstatSync(candidate);
        if (stats.isSymbolicLink()) {
          const resolved = realpathSync(candidate);
          const resolvedStats = lstatSync(resolved);
          if (!resolvedStats.isFile()) continue;
          accessSync(resolved, fsConstants.X_OK);
          return resolved;
        }
        if (!stats.isFile()) continue;
        accessSync(candidate, fsConstants.X_OK);
        return realpathSync(candidate);
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function commandExists(command) {
  return Boolean(resolveCommandPath(command));
}

function resolveCodeReviewPython() {
  const candidates = process.platform === "win32"
    ? ["python.exe", "python3.exe", "python", "python3"]
    : ["python3", "python"];
  for (const command of candidates) {
    const resolved = resolveCommandPath(command);
    if (!resolved) continue;
    const executable = realpathSync(resolved);
    const result = spawnSync(
      executable,
      ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 },
    );
    if (result.status !== 0) continue;
    const [major, minor] = result.stdout.trim().split(".").map(Number);
    if (major === 3 && minor >= 10) return executable;
  }
  throw new Error("Python 3.10 or newer is required for the code-review-graph MCP server");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: options.replaceEnv ? (options.env || {}) : { ...process.env, ...(options.env || {}) },
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

function mcpTransport(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return undefined;
  if (typeof definition.command === "string" && definition.command) return { kind: "command", value: definition.command };
  if (typeof definition.url === "string" && definition.url) return { kind: "url", value: definition.url };
  if (typeof definition.socket === "string" && definition.socket) return { kind: "socket", value: definition.socket };
  return undefined;
}

function mergeMcpServerDefault(template, existing) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return structuredClone(existing ?? template);
  const templateTransport = mcpTransport(template);
  const existingTransport = mcpTransport(existing);
  if (
    existingTransport && templateTransport &&
    (existingTransport.kind !== templateTransport.kind || existingTransport.value !== templateTransport.value)
  ) {
    return structuredClone(existing);
  }
  return mergeMissing(template, existing);
}

function mergeMcpProfile(existing, template, force) {
  const output = force ? mergeForce(existing, template) : mergeMissing(template, existing);
  const templateServers = template.mcpServers;
  if (templateServers && typeof templateServers === "object" && !Array.isArray(templateServers)) {
    if (!output.mcpServers || typeof output.mcpServers !== "object" || Array.isArray(output.mcpServers)) {
      output.mcpServers = {};
    }
    const existingServers = existing.mcpServers;
    for (const [name, definition] of Object.entries(templateServers)) {
      if (force) {
        output.mcpServers[name] = structuredClone(definition);
      } else if (
        existingServers && typeof existingServers === "object" && !Array.isArray(existingServers) &&
        Object.hasOwn(existingServers, name)
      ) {
        output.mcpServers[name] = mergeMcpServerDefault(definition, existingServers[name]);
      }
    }
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

function ensurePrivateDirectory(target, boundary = agentDir()) {
  const resolvedBoundary = path.resolve(boundary);
  if (lexicalPathExists(resolvedBoundary)) {
    const boundaryStats = lstatSync(resolvedBoundary);
    if (boundaryStats.isSymbolicLink() || !boundaryStats.isDirectory()) {
      throw new Error(`Refusing unsafe Pi agent directory: ${resolvedBoundary}`);
    }
  } else {
    mkdirSync(resolvedBoundary, { recursive: true, mode: 0o700 });
  }

  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBoundary, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Private runtime directory escapes the Pi agent directory: ${resolvedTarget}`);
  }

  let current = resolvedBoundary;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (lexicalPathExists(current)) {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Refusing unsafe private runtime path: ${current}`);
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
    try { chmodSync(current, 0o700); } catch {}
  }
}

function writePrivateRuntimeFile(file, content, mode) {
  const stats = lexicalPathExists(file) ? lstatSync(file) : undefined;
  if (stats && (stats.isSymbolicLink() || !stats.isFile())) {
    throw new Error(`Refusing unsafe private runtime file: ${file}`);
  }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode, flag: "wx" });
    try { chmodSync(temporary, mode); } catch {}
    if (process.platform === "win32" && stats) rmSync(file);
    renameSync(temporary, file);
    try { chmodSync(file, mode); } catch {}
  } finally {
    try { rmSync(temporary, { force: true }); } catch {}
  }
}

function prepareCodeReviewRuntime() {
  const runtimeRoot = path.join(agentDir(), "cache", "yimo-pi-kit", "code-review-graph");
  const runtimeHome = path.join(runtimeRoot, "home");
  const uvCache = path.join(runtimeRoot, "uv");
  const xdgCache = path.join(runtimeRoot, "xdg-cache");
  const xdgConfig = path.join(runtimeRoot, "xdg-config");
  const xdgData = path.join(runtimeRoot, "xdg-data");
  const fastMcpHome = path.join(runtimeRoot, "fastmcp-home");
  const fastMcpEnv = path.join(runtimeRoot, "fastmcp.env");
  const tempDirectory = path.join(runtimeRoot, "tmp");
  const appData = path.join(runtimeRoot, "appdata");
  const localAppData = path.join(runtimeRoot, "local-appdata");
  const shimDirectory = path.join(runtimeRoot, "bin");
  const hooksDirectory = path.join(runtimeRoot, "disabled-git-hooks");
  ensurePrivateDirectory(runtimeHome);
  ensurePrivateDirectory(uvCache);
  ensurePrivateDirectory(xdgCache);
  ensurePrivateDirectory(xdgConfig);
  ensurePrivateDirectory(xdgData);
  ensurePrivateDirectory(fastMcpHome);
  ensurePrivateDirectory(tempDirectory);
  ensurePrivateDirectory(appData);
  ensurePrivateDirectory(localAppData);
  ensurePrivateDirectory(shimDirectory);
  ensurePrivateDirectory(hooksDirectory);

  const realGitCommand = resolveCommandPath("git");
  const realUvxCommand = resolveCommandPath("uvx");
  if (!realGitCommand) throw new Error("git is required for the code-review-graph MCP server");
  if (!realUvxCommand) throw new Error("uvx is required for the code-review-graph MCP server");
  const realGit = realpathSync(realGitCommand);
  const realUvx = realpathSync(realUvxCommand);
  const realPython = resolveCodeReviewPython();
  const isolatedGitConfig = path.join(runtimeRoot, "isolated-gitconfig");
  const isolatedAttributes = path.join(runtimeRoot, "isolated-gitattributes");
  for (const privateFile of [fastMcpEnv, isolatedGitConfig, isolatedAttributes]) {
    if (lexicalPathExists(privateFile)) {
      const stats = lstatSync(privateFile);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Refusing unsafe private runtime file: ${privateFile}`);
    }
    writePrivateRuntimeFile(privateFile, "", 0o600);
  }

  const shimSource = `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nimport path from "node:path";\nconst realGit = ${JSON.stringify(realGit)};\nconst hooksPath = ${JSON.stringify(hooksDirectory)};\nconst isolatedConfig = ${JSON.stringify(isolatedGitConfig)};\nconst isolatedAttributes = ${JSON.stringify(isolatedAttributes)};\nconst original = process.argv.slice(2);\nlet commandIndex = 0;\nwhile (commandIndex < original.length) {\n  const argument = original[commandIndex];\n  if (argument === "-c") {\n    if (commandIndex + 1 >= original.length) { console.error("git shim: missing value after -c"); process.exit(1); }\n    if (!/^core[.]quotepath=(?:off|false|0)$/i.test(original[commandIndex + 1])) {\n      console.error("git shim: unsupported Git configuration override");\n      process.exit(1);\n    }\n    commandIndex += 2;\n    continue;\n  }\n  if (argument.startsWith("-c") && argument.length > 2) {\n    if (!/^core[.]quotepath=(?:off|false|0)$/i.test(argument.slice(2))) {\n      console.error("git shim: unsupported Git configuration override");\n      process.exit(1);\n    }\n    commandIndex += 1;\n    continue;\n  }\n  break;\n}\nconst args = original.slice(commandIndex);\nconst allowedCommands = new Set(["diff", "log", "ls-files", "rev-parse", "status"]);\nif (!args[0] || !allowedCommands.has(args[0])) {\n  console.error("git shim: unsupported or missing Git subcommand");\n  process.exit(1);\n}\nconst separatorIndex = args.indexOf("--");\nconst optionEnd = separatorIndex >= 0 ? separatorIndex : args.length;\nconst allowedOption = (command, argument) => {\n  if (command === "diff") return ["--name-only", "-z", "--cached", "--unified=0", "--no-ext-diff", "--no-textconv"].includes(argument);\n  if (command === "log") return ["--numstat", "--no-renames", "--format=", "-z", "--no-ext-diff", "--no-textconv"].includes(argument) || /^--since=[1-9][0-9]*[.]days[.]ago$/.test(argument);\n  if (command === "ls-files") return ["-z", "--recurse-submodules"].includes(argument);\n  if (command === "rev-parse") return ["--abbrev-ref", "--verify"].includes(argument);\n  if (command === "status") return ["--porcelain", "--porcelain=v1", "--untracked-files=all", "-z"].includes(argument);\n  return false;\n};\nfor (let index = 1; index < optionEnd; index += 1) {\n  const argument = args[index];\n  if (argument.startsWith("-") && !allowedOption(args[0], argument)) {\n    console.error("git shim: unsupported Git option: " + argument);\n    process.exit(1);\n  }\n}\nif (args[0] === "diff" || args[0] === "log") {\n  const hardening = [];\n  if (!args.includes("--no-ext-diff")) hardening.push("--no-ext-diff");\n  if (!args.includes("--no-textconv")) hardening.push("--no-textconv");\n  args.splice(1, 0, ...hardening);\n}\nconst env = { ...process.env };\nfor (const key of Object.keys(env)) {\n  if (/^GIT_/i.test(key)) delete env[key];\n}\nObject.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: isolatedConfig, GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_PAGER: "cat" });\nconst lockedRoot = process.env.YIMO_PI_KIT_LOCKED_ROOT || process.cwd();\nif (!path.isAbsolute(lockedRoot)) { console.error("git shim: invalid locked worktree"); process.exit(1); }\nconst safety = ["--no-pager", "-c", "core.hooksPath=" + hooksPath, "-c", "core.attributesFile=" + isolatedAttributes, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.worktree=" + lockedRoot, "-c", "core.bare=false", "-c", "core.quotepath=false", "-c", "color.ui=false", "-c", "diff.noprefix=false", "-c", "diff.srcPrefix=a/", "-c", "diff.dstPrefix=b/", "-c", "diff.mnemonicPrefix=false", "-c", "diff.linePrefix=", "-c", "log.showSignature=false", "-c", "status.showUntrackedFiles=all"];\nconst filterProbe = spawnSync(realGit, [...safety, "config", "--includes", "--name-only", "-z", "--get-regexp", "^filter[.].*[.](clean|smudge|process|required)$"], {\n  env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,\n});\nif (filterProbe.error || (filterProbe.status !== 0 && filterProbe.status !== 1)) {\n  const detail = filterProbe.error?.message || filterProbe.stderr?.trim() || "unable to inspect Git filters";\n  console.error("git shim: " + detail);\n  process.exit(1);\n}\nconst filterDrivers = new Set();\nfor (const key of (filterProbe.stdout || "").split("\\0").filter(Boolean)) {\n  const match = /^filter[.](.+)[.](clean|smudge|process|required)$/i.exec(key);\n  if (!match || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(match[1])) {\n    console.error("git shim: unsafe Git filter key");\n    process.exit(1);\n  }\n  filterDrivers.add(match[1]);\n}\nif (filterDrivers.size > 256) { console.error("git shim: too many Git filter drivers"); process.exit(1); }\nconst filterSafety = [];\nfor (const driver of filterDrivers) {\n  const prefix = "filter." + driver;\n  filterSafety.push("-c", prefix + ".clean=", "-c", prefix + ".smudge=", "-c", prefix + ".process=", "-c", prefix + ".required=false");\n}\nconst result = spawnSync(realGit, [...safety, ...filterSafety, ...args], { env, stdio: "inherit", windowsHide: true });\nif (result.error) { console.error("git shim: " + result.error.message); process.exit(1); }\nprocess.exit(result.status ?? 1);\n`;
  const shimModule = path.join(shimDirectory, "git-shim.mjs");
  writePrivateRuntimeFile(shimModule, shimSource, 0o700);
  const svnShimSource = `#!/usr/bin/env node\nconsole.error("yimo-pi-kit: SVN access is disabled in the curated code-review-graph profile; use a reviewed Git checkout or a separately audited custom profile.");\nprocess.exit(1);\n`;
  const svnShimModule = path.join(shimDirectory, "svn-shim.mjs");
  writePrivateRuntimeFile(svnShimModule, svnShimSource, 0o700);
  if (process.platform === "win32") {
    const nodeExecutable = process.execPath.replaceAll("%", "%%");
    writePrivateRuntimeFile(
      path.join(shimDirectory, "git.cmd"),
      `@echo off\r\n"${nodeExecutable}" "%~dp0git-shim.mjs" %*\r\n`,
      0o700,
    );
    writePrivateRuntimeFile(
      path.join(shimDirectory, "svn.cmd"),
      `@echo off\r\n"${nodeExecutable}" "%~dp0svn-shim.mjs" %*\r\n`,
      0o700,
    );
  } else {
    writePrivateRuntimeFile(path.join(shimDirectory, "git"), shimSource, 0o700);
    writePrivateRuntimeFile(path.join(shimDirectory, "svn"), svnShimSource, 0o700);
  }

  return { runtimeRoot, runtimeHome, uvCache, xdgCache, xdgConfig, xdgData, fastMcpHome, fastMcpEnv, tempDirectory, appData, localAppData, shimDirectory, isolatedGitConfig, realGit, realUvx, realPython };
}

function prepareMcpTemplate(profile, template) {
  const prepared = structuredClone(template);
  if (profile !== "code-review") return prepared;
  const runtime = prepareCodeReviewRuntime();
  const server = prepared.mcpServers?.["code-review-graph"];
  if (!server?.env || !Array.isArray(server.args)) throw new Error("code-review-graph MCP template is missing its command or environment block");
  const runnerIndex = server.args.indexOf(CODE_REVIEW_RUNNER_PLACEHOLDER);
  const pythonIndex = server.args.indexOf(CODE_REVIEW_PYTHON_PLACEHOLDER);
  if (runnerIndex < 0 || pythonIndex < 0 || server.command !== "uvx") {
    throw new Error("code-review-graph MCP template is missing hardened command placeholders");
  }
  const runnerStats = lstatSync(CODE_REVIEW_RUNNER);
  if (runnerStats.isSymbolicLink() || !runnerStats.isFile()) throw new Error(`Refusing unsafe code-review runner: ${CODE_REVIEW_RUNNER}`);
  server.args[runnerIndex] = CODE_REVIEW_RUNNER;
  server.args[pythonIndex] = runtime.realPython;
  server.env.HOME = runtime.runtimeHome;
  server.env.USERPROFILE = runtime.runtimeHome;
  server.env.APPDATA = runtime.appData;
  server.env.LOCALAPPDATA = runtime.localAppData;
  server.env.TMPDIR = runtime.tempDirectory;
  server.env.TMP = runtime.tempDirectory;
  server.env.TEMP = runtime.tempDirectory;
  server.env.UV_CACHE_DIR = runtime.uvCache;
  server.env.XDG_CACHE_HOME = runtime.xdgCache;
  server.env.XDG_CONFIG_HOME = runtime.xdgConfig;
  server.env.XDG_DATA_HOME = runtime.xdgData;
  server.env.PATH = [...new Set([
    runtime.shimDirectory,
    path.dirname(runtime.realUvx),
    path.dirname(runtime.realPython),
    path.dirname(realpathSync(process.execPath)),
  ])].join(path.delimiter);
  server.env.GIT_CONFIG_GLOBAL = runtime.isolatedGitConfig;
  if (server.env.FASTMCP_ENV_FILE !== "__YIMO_PI_KIT_FASTMCP_ENV__" || server.env.FASTMCP_HOME !== "__YIMO_PI_KIT_FASTMCP_HOME__") {
    throw new Error("code-review-graph MCP template is missing private FastMCP placeholders");
  }
  server.env.FASTMCP_ENV_FILE = runtime.fastMcpEnv;
  server.env.FASTMCP_HOME = runtime.fastMcpHome;
  if (server.env.YIMO_PI_KIT_NODE !== CODE_REVIEW_NODE_PLACEHOLDER || server.env.YIMO_PI_KIT_GIT_SHIM !== CODE_REVIEW_GIT_SHIM_PLACEHOLDER) {
    throw new Error("code-review-graph MCP template is missing hardened subprocess placeholders");
  }
  server.env.YIMO_PI_KIT_NODE = realpathSync(process.execPath);
  server.env.YIMO_PI_KIT_GIT_SHIM = path.join(runtime.shimDirectory, "git-shim.mjs");

  const launcherPath = path.join(runtime.shimDirectory, "uvx-launcher.mjs");
  const inheritedNetworkKeys = [
    "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
    "all_proxy", "https_proxy", "http_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    "SYSTEMROOT", "WINDIR", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  ];
  const launcherSource = `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nconst uvx = ${JSON.stringify(runtime.realUvx)};\nconst fixed = ${JSON.stringify(server.env)};\nconst inheritedKeys = ${JSON.stringify(inheritedNetworkKeys)};\nconst proxyKeys = new Set(["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "all_proxy", "https_proxy", "http_proxy"]);\nconst env = { ...fixed };\nfor (const key of inheritedKeys) {\n  const value = process.env[key];\n  if (value === undefined) continue;\n  if (proxyKeys.has(key)) {\n    try {\n      const parsed = new URL(value);\n      if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname) || !["http:", "https:"].includes(parsed.protocol)) continue;\n    } catch { continue; }\n  }\n  env[key] = value;\n}\nconst args = process.argv.slice(2);\nconst mcpServe = args.length >= 3 && args.at(-3) === "serve" && args.at(-2) === "--tools";\nconst child = spawn(uvx, args, {\n  env,\n  stdio: ["pipe", "inherit", "inherit"],\n  windowsHide: true,\n  detached: process.platform !== "win32",\n});\nlet stopping = false;\nlet forceTimer;\nlet inputClosed = false;\nconst signalChild = (signal) => {\n  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;\n  try {\n    if (process.platform === "win32") child.kill(signal);\n    else process.kill(-child.pid, signal);\n  } catch {}\n};\nconst stop = (signal = "SIGTERM") => {\n  if (stopping) return;\n  stopping = true;\n  signalChild(signal);\n  forceTimer = setTimeout(() => signalChild("SIGKILL"), 5000);\n  forceTimer.unref();\n};\nchild.stdin.on("error", (error) => {\n  if (error?.code !== "EPIPE") console.error("uvx launcher stdin: " + error.message);\n});\nprocess.stdin.pipe(child.stdin);\nconst stopAfterInput = () => {\n  if (inputClosed) return;\n  inputClosed = true;\n  if (mcpServe) stop("SIGTERM");\n};\nprocess.stdin.once("end", stopAfterInput);\nprocess.stdin.once("close", stopAfterInput);\nfor (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {\n  process.once(signal, () => stop(signal));\n}\nlet spawnFailed = false;\nchild.once("error", (error) => {\n  spawnFailed = true;\n  console.error("uvx launcher: " + error.message);\n});\nchild.once("close", (code) => {\n  if (forceTimer) clearTimeout(forceTimer);\n  process.stdin.unpipe(child.stdin);\n  process.stdin.pause();\n  process.exit(spawnFailed ? 1 : (code ?? 1));\n});\n`;
  writePrivateRuntimeFile(launcherPath, launcherSource, 0o700);
  server.command = realpathSync(process.execPath);
  server.args = [launcherPath, ...server.args];
  return prepared;
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

function expectedCodeReviewServer() {
  const definition = structuredClone(parseJsonFile(path.join(root, "mcp", "code-review.json")).mcpServers?.["code-review-graph"]);
  if (!definition || !Array.isArray(definition.args) || !definition.env) return undefined;
  const runnerIndex = definition.args.indexOf(CODE_REVIEW_RUNNER_PLACEHOLDER);
  const pythonIndex = definition.args.indexOf(CODE_REVIEW_PYTHON_PLACEHOLDER);
  const uvxCommand = resolveCommandPath("uvx");
  if (runnerIndex < 0 || pythonIndex < 0 || !uvxCommand) return undefined;
  const resolvedUvx = realpathSync(uvxCommand);
  const resolvedPython = resolveCodeReviewPython();
  definition.args[runnerIndex] = CODE_REVIEW_RUNNER;
  definition.args[pythonIndex] = resolvedPython;
  const runtimeRoot = path.join(agentDir(), "cache", "yimo-pi-kit", "code-review-graph");
  definition.env.HOME = path.join(runtimeRoot, "home");
  definition.env.USERPROFILE = path.join(runtimeRoot, "home");
  definition.env.APPDATA = path.join(runtimeRoot, "appdata");
  definition.env.LOCALAPPDATA = path.join(runtimeRoot, "local-appdata");
  definition.env.TMPDIR = path.join(runtimeRoot, "tmp");
  definition.env.TMP = path.join(runtimeRoot, "tmp");
  definition.env.TEMP = path.join(runtimeRoot, "tmp");
  definition.env.UV_CACHE_DIR = path.join(runtimeRoot, "uv");
  definition.env.XDG_CACHE_HOME = path.join(runtimeRoot, "xdg-cache");
  definition.env.XDG_CONFIG_HOME = path.join(runtimeRoot, "xdg-config");
  definition.env.XDG_DATA_HOME = path.join(runtimeRoot, "xdg-data");
  definition.env.PATH = [...new Set([
    path.join(runtimeRoot, "bin"),
    path.dirname(resolvedUvx),
    path.dirname(resolvedPython),
    path.dirname(realpathSync(process.execPath)),
  ])].join(path.delimiter);
  definition.env.GIT_CONFIG_GLOBAL = path.join(runtimeRoot, "isolated-gitconfig");
  if (definition.env.FASTMCP_ENV_FILE !== "__YIMO_PI_KIT_FASTMCP_ENV__" || definition.env.FASTMCP_HOME !== "__YIMO_PI_KIT_FASTMCP_HOME__") return undefined;
  definition.env.FASTMCP_ENV_FILE = path.join(runtimeRoot, "fastmcp.env");
  definition.env.FASTMCP_HOME = path.join(runtimeRoot, "fastmcp-home");
  if (definition.env.YIMO_PI_KIT_NODE !== CODE_REVIEW_NODE_PLACEHOLDER || definition.env.YIMO_PI_KIT_GIT_SHIM !== CODE_REVIEW_GIT_SHIM_PLACEHOLDER) return undefined;
  definition.env.YIMO_PI_KIT_NODE = realpathSync(process.execPath);
  definition.env.YIMO_PI_KIT_GIT_SHIM = path.join(runtimeRoot, "bin", "git-shim.mjs");
  definition.command = realpathSync(process.execPath);
  definition.args = [path.join(runtimeRoot, "bin", "uvx-launcher.mjs"), ...definition.args];
  return definition;
}

function isManagedCodeReviewServer(server) {
  return Boolean(
    server && typeof server === "object" && !Array.isArray(server) &&
    server.env?.YIMO_PI_KIT_CODE_REVIEW_PROFILE === CODE_REVIEW_PROFILE_MARKER &&
    typeof server.command === "string" && path.isAbsolute(server.command) &&
    server.env?.YIMO_PI_KIT_NODE === server.command &&
    path.basename(String(server.args?.[0] ?? "")).toLowerCase() === "uvx-launcher.mjs"
  );
}

function matchesManagedCodeReviewServer(server) {
  if (!isManagedCodeReviewServer(server)) return false;
  let expected;
  try {
    expected = expectedCodeReviewServer();
  } catch {
    return false;
  }
  if (!expected) return false;
  const allowedKeys = new Set([...Object.keys(expected), "disabled"]);
  if (Object.keys(server).some((key) => !allowedKeys.has(key))) return false;
  if (server.disabled !== undefined && typeof server.disabled !== "boolean") return false;
  return Object.entries(expected).every(([key, value]) => JSON.stringify(server[key]) === JSON.stringify(value));
}

function isPinnedCodeReviewServer(server) {
  if (!matchesManagedCodeReviewServer(server)) return false;
  const runtimeRoot = path.join(agentDir(), "cache", "yimo-pi-kit", "code-review-graph");
  const directories = ["home", "uv", "xdg-cache", "xdg-config", "xdg-data", "fastmcp-home", "tmp", "appdata", "local-appdata", "bin", "disabled-git-hooks"];
  const files = [
    "fastmcp.env", "isolated-gitconfig", "isolated-gitattributes",
    "bin/git-shim.mjs", "bin/svn-shim.mjs", "bin/uvx-launcher.mjs",
    ...(process.platform === "win32" ? ["bin/git.cmd", "bin/svn.cmd"] : ["bin/git", "bin/svn"]),
  ];
  try {
    const runnerStats = lstatSync(CODE_REVIEW_RUNNER);
    if (runnerStats.isSymbolicLink() || !runnerStats.isFile()) return false;
    for (const relative of directories) {
      const stats = lstatSync(path.join(runtimeRoot, relative));
      if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    }
    for (const relative of files) {
      const target = path.join(runtimeRoot, relative);
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isFile()) return false;
      if (relative === "fastmcp.env" && stats.size !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
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
  try {
    add("python >= 3.10", true, resolveCodeReviewPython(), false);
  } catch (error) {
    add("python >= 3.10", false, error instanceof Error ? error.message : String(error), false);
  }

  const mcpPath = path.join(agentDir(), "mcp.json");
  let mcpConfig = {};
  try {
    mcpConfig = parseJsonFile(mcpPath);
    add("global MCP config", existsSync(mcpPath), existsSync(mcpPath) ? mcpPath : "not installed", false);
  } catch (error) {
    add("global MCP config", false, error instanceof Error ? error.message : String(error));
  }

  const graphServer = mcpConfig.mcpServers?.["code-review-graph"];
  const graphServerPinned = isPinnedCodeReviewServer(graphServer);
  add(
    "code-review-graph MCP",
    graphServerPinned,
    graphServerPinned
      ? "configured (pinned 2.3.7, local stdio, curated tools)"
      : graphServer
        ? "configured with a custom/unverified definition; compare mcp/code-review.json or re-run setup-mcp code-review --force"
        : "optional; run setup-code-review",
    false,
  );
  const installedGraphSkills = CODE_REVIEW_SKILLS.filter((name) =>
    existsSync(path.join(agentDir(), "skills", name, "SKILL.md")),
  );
  add(
    "code-review-graph skills",
    installedGraphSkills.length === CODE_REVIEW_SKILLS.length,
    installedGraphSkills.length === CODE_REVIEW_SKILLS.length
      ? `${installedGraphSkills.length}/${CODE_REVIEW_SKILLS.length} installed`
      : `optional; ${installedGraphSkills.length}/${CODE_REVIEW_SKILLS.length} installed`,
    false,
  );

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
  if (flags.positional.length > 1) throw new Error("setup-mcp accepts at most one profile name");
  const profile = flags.positional[0] || "global";
  if (!MCP_PROFILES.has(profile)) {
    throw new Error(`Unknown MCP profile ${profile}. Choose: ${[...MCP_PROFILES].join(", ")}`);
  }

  const target = path.resolve(flags.target || path.join(agentDir(), "mcp.json"));
  if (lexicalPathExists(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing symlinked MCP target: ${target}`);
  }
  const templateName = profile === "global" ? "global.json" : `${profile}.json`;
  const rawTemplate = parseJsonFile(path.join(root, "mcp", templateName));
  const existing = parseJsonFile(target);
  const existingProfileServer = existing.mcpServers?.["code-review-graph"];
  const existingManaged = isManagedCodeReviewServer(existingProfileServer);
  const profileWillApply = profile !== "code-review" || Boolean(flags.force) || !existingProfileServer || existingManaged;
  const template = profileWillApply ? prepareMcpTemplate(profile, rawTemplate) : rawTemplate;
  const next = mergeMcpProfile(existing, template, Boolean(flags.force));
  if (profile === "code-review" && existingProfileServer && !flags.force) {
    if (existingManaged && template.mcpServers?.["code-review-graph"]) {
      next.mcpServers["code-review-graph"] = structuredClone(template.mcpServers["code-review-graph"]);
      if (typeof existingProfileServer.disabled === "boolean") {
        next.mcpServers["code-review-graph"].disabled = existingProfileServer.disabled;
      }
    } else {
      next.mcpServers["code-review-graph"] = structuredClone(existingProfileServer);
    }
  }
  const backup = backupFile(target);
  writeJsonAtomic(target, next);

  console.log(`MCP profile ${profile} written to ${target}`);
  if (backup) console.log(`Previous configuration backed up to ${backup}`);
  console.log("Existing server definitions were preserved unless --force was supplied.");
  console.log("Install the parent-session adapter with: pi install npm:pi-mcp-adapter@2.15.0");
  const pinnedCodeReview = profile === "code-review" && isPinnedCodeReviewServer(next.mcpServers?.["code-review-graph"]);
  if (profile === "code-review") {
    const cliPath = path.join(root, "scripts", "cli.mjs");
    if (pinnedCodeReview) {
      console.log("code-review-graph is pinned to 2.3.7 and starts lazily over local stdio with a curated review-only tool set.");
    } else {
      console.log("An existing custom code-review-graph server definition was preserved. Review it or re-run with --force to apply the pinned profile.");
    }
    console.log(`If needed, install its pinned workflow skills with: node ${JSON.stringify(cliPath)} install-skills code-review`);
  } else {
    console.log("Python MCP servers require uvx; Node MCP servers require npx.");
  }
  return { profile, target, pinnedCodeReview };
}

function setupCodeReview(args) {
  const flags = parseFlags(args);
  if (flags.positional.length > 0) throw new Error("setup-code-review does not accept positional arguments");
  if (!commandExists("uvx")) throw new Error("uvx is required for the code-review-graph MCP server");

  const target = path.resolve(flags.target || path.join(agentDir(), "mcp.json"));
  if (lexicalPathExists(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing symlinked MCP target: ${target}`);
  }
  parseJsonFile(target);

  const skillArgs = ["code-review"];
  if (flags.copy) skillArgs.push("--copy");
  installSkills(skillArgs);

  const mcpArgs = ["code-review"];
  if (flags.target) mcpArgs.push("--target", flags.target);
  if (flags.force) mcpArgs.push("--force");
  const mcpResult = setupMcp(mcpArgs);

  if (mcpResult.pinnedCodeReview) {
    console.log("Code review graph setup complete. Run /reload, then use /skill:build-graph or /skill:review-delta.");
    console.log("The first graph build creates a local .code-review-graph/ directory in the repository.");
  } else {
    console.log("Workflow skills were installed, but the existing custom MCP definition remains active. Review it or re-run setup-code-review with --force.");
  }
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

function managedSkillMarker(target, definition) {
  const markerPath = path.join(target, MANAGED_SKILL_MARKER);
  try {
    const stats = lstatSync(markerPath);
    if (stats.isSymbolicLink() || !stats.isFile()) return false;
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    return marker?.schema === 1 && marker?.source === definition.source && marker?.path === definition.path &&
      typeof marker?.ref === "string" && /^[0-9a-f]{40}$/.test(marker.ref);
  } catch {
    return false;
  }
}

function removeExistingSkillTarget(target, definition) {
  if (!lexicalPathExists(target)) return;
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) {
    rmSync(target);
    return;
  }
  if (stats.isDirectory() && managedSkillMarker(target, definition)) {
    rmSync(target, { recursive: true });
    return;
  }
  throw new Error(`Refusing to replace unmanaged skill path: ${target}`);
}

function installCopiedSkill(sourcePath, sourceRoot, target, definition, source) {
  const parent = path.dirname(target);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const previous = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomUUID()}.previous`);
  let movedPrevious = false;
  try {
    cpSync(sourcePath, temporary, { recursive: true, dereference: true, errorOnExist: true });
    copyUpstreamNotices(sourceRoot, temporary);
    writePrivateRuntimeFile(
      path.join(temporary, MANAGED_SKILL_MARKER),
      `${JSON.stringify({ schema: 1, source: definition.source, ref: source.ref, path: definition.path }, null, 2)}\n`,
      0o600,
    );
    if (lexicalPathExists(target)) {
      const stats = lstatSync(target);
      if (!stats.isSymbolicLink() && (!stats.isDirectory() || !managedSkillMarker(target, definition))) {
        throw new Error(`Refusing to overwrite unmanaged skill: ${target}`);
      }
      renameSync(target, previous);
      movedPrevious = true;
    }
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (movedPrevious && !lexicalPathExists(target)) renameSync(previous, target);
      throw error;
    }
    if (movedPrevious) rmSync(previous, { recursive: true, force: true });
  } finally {
    try { rmSync(temporary, { recursive: true, force: true }); } catch {}
    if (movedPrevious && lexicalPathExists(previous) && lexicalPathExists(target)) {
      try { rmSync(previous, { recursive: true, force: true }); } catch {}
    }
  }
}

function ensureSource(name, source) {
  const realGit = resolveCommandPath("git");
  if (!realGit) throw new Error("git is required to install optional skills");
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
  const isolatedAttributes = path.join(sourcesRoot, ".isolated-gitattributes");
  const sourceHome = path.join(sourcesRoot, ".home");
  const sourceTemp = path.join(sourcesRoot, ".tmp");
  ensurePrivateDirectory(sourcesRoot);
  ensurePrivateDirectory(hooksPath);
  ensurePrivateDirectory(sourceHome);
  ensurePrivateDirectory(sourceTemp);
  writePrivateRuntimeFile(isolatedGitConfig, "", 0o600);
  writePrivateRuntimeFile(isolatedAttributes, "", 0o600);

  const gitEnvironment = {
    HOME: sourceHome,
    USERPROFILE: sourceHome,
    TMPDIR: sourceTemp,
    TMP: sourceTemp,
    TEMP: sourceTemp,
    PATH: process.env.PATH ?? path.dirname(realGit),
    GIT_CONFIG_GLOBAL: isolatedGitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PROTOCOL_FROM_USER: "0",
    GCM_INTERACTIVE: "Never",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  for (const key of [
    "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
    "all_proxy", "https_proxy", "http_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE",
    "SYSTEMROOT", "WINDIR", "PATHEXT", "LC_ALL", "LC_CTYPE", "TZ",
  ]) {
    const value = process.env[key];
    if (value === undefined) continue;
    if (/^(?:all|https?|no)_proxy$/i.test(key) && !/^no_proxy$/i.test(key)) {
      try {
        const parsed = new URL(value);
        if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname) || !["http:", "https:"].includes(parsed.protocol)) continue;
      } catch {
        continue;
      }
    }
    gitEnvironment[key] = value;
  }

  if (lexicalPathExists(destination)) {
    const stats = lstatSync(destination);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Refusing unsafe source checkout: ${destination}`);
    }
  }

  const temporary = path.join(sourcesRoot, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  const previous = path.join(sourcesRoot, `.${name}.${process.pid}.${randomUUID()}.previous`);
  const gitArgs = [
    "-c", `core.hooksPath=${hooksPath}`,
    "-c", `core.attributesFile=${isolatedAttributes}`,
    "-c", "credential.helper=",
    "-c", "core.askPass=",
    "-c", "protocol.file.allow=never",
    "-c", "protocol.ext.allow=never",
    "-c", "http.followRedirects=initial",
  ];
  const options = (cwd, extra = {}) => ({ cwd, env: gitEnvironment, replaceEnv: true, ...extra });
  let movedPrevious = false;
  try {
    mkdirSync(temporary, { mode: 0o700 });
    run(realGit, [...gitArgs, "-c", "init.defaultBranch=main", "init", "--quiet"], options(temporary));
    run(realGit, [...gitArgs, "remote", "add", "origin", source.url], options(temporary));
    run(realGit, [...gitArgs, "sparse-checkout", "init", "--cone"], options(temporary));
    run(realGit, [...gitArgs, "sparse-checkout", "set", ...source.paths], options(temporary));
    runWithRetry(realGit, [...gitArgs, "fetch", "--depth", "1", "--filter=blob:none", "origin", source.ref], {
      ...options(temporary),
      timeout: 180000,
    });
    run(realGit, [...gitArgs, "checkout", "--detach", "--force", "FETCH_HEAD"], options(temporary));
    run(realGit, [...gitArgs, "clean", "-ffdx"], options(temporary));
    const checkedOutRef = run(realGit, [...gitArgs, "rev-parse", "HEAD"], options(temporary, { capture: true }));
    if (checkedOutRef !== source.ref) throw new Error(`Pinned commit mismatch for ${name}: ${checkedOutRef}`);

    if (lexicalPathExists(destination)) {
      renameSync(destination, previous);
      movedPrevious = true;
    }
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (movedPrevious && !lexicalPathExists(destination)) renameSync(previous, destination);
      throw error;
    }
    if (movedPrevious) rmSync(previous, { recursive: true, force: true });
    return destination;
  } finally {
    try { rmSync(temporary, { recursive: true, force: true }); } catch {}
    if (movedPrevious && lexicalPathExists(previous) && lexicalPathExists(destination)) {
      try { rmSync(previous, { recursive: true, force: true }); } catch {}
    }
  }
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
  const allowedProfiles = new Set(["academic", "architecture", "backend", "frontend", "security", "code-review", "all"]);
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
  ensurePrivateDirectory(skillsRoot);

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
      installCopiedSkill(
        resolvedSourcePath,
        resolvedSourceRoot,
        target,
        definition,
        skillManifest.sources[definition.source],
      );
    } else {
      removeExistingSkillTarget(target, definition);
      symlinkSync(resolvedSourcePath, target, process.platform === "win32" ? "junction" : "dir");
    }
    console.log(`✓ ${skillName}`);
  }

  console.log(`Installed ${selected.length} optional skills for profile ${profile}. Run /reload in Pi.`);
}

function usage() {
  console.log(`Usage: yimo-pi-kit <command> [options]\n\nCommands:\n  doctor [--json]\n      Check Pi, Node, package dependencies, DeepSeek setup, code-review-graph, and optional MCP prerequisites.\n\n  setup-mcp [global|code-review] [--target <path>] [--force]\n      Merge a portable MCP profile into the Pi global MCP config. Existing values win by default.\n\n  setup-code-review [--target <path>] [--force] [--copy]\n      Install pinned code-review-graph workflow skills and its local stdio MCP profile.\n\n  setup-deepseek [--target <path>] [--force]\n      Add DeepSeek V4 Flash using the Responses API to models.json. Matching models are preserved unless --force is supplied.\n\n  install-skills [academic|architecture|backend|frontend|security|code-review|all] [--copy]\n      Download pinned third-party skill repositories and link selected skills into the Pi agent directory.\n\n  help\n      Show this help.\n`);
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
    case "setup-code-review":
      setupCodeReview(args);
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
