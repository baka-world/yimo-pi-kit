import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import stripJsonComments from "strip-json-comments";
import { discoverAgents } from "../subagent/agents.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const KIT_STATE_DIR = path.join(getAgentDir(), "state");
const KIT_STATE_PATH = path.join(KIT_STATE_DIR, "yimo-pi-kit.json");
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
const CODE_REVIEW_PACKAGE_SPEC = "code-review-graph @ https://files.pythonhosted.org/packages/f3/8f/2df3fcca285b489d195706b09cefda3e57e7158185cb83905200d7b27199/code_review_graph-2.3.7-py3-none-any.whl#sha256=12196dce3e673bdec7fba97ae5c4dff7589adee73a721374f62efae76e0fdd88";
const CODE_REVIEW_RUNNER = path.join(PACKAGE_ROOT, "scripts", "code-review-runner.py");
const requireFromHere = createRequire(import.meta.url);

interface PackageMetadata {
	name?: string;
	version?: string;
}

interface KitState {
	lastHintVersion?: string;
	hintedAt?: string;
}

function readPackageMetadata(): PackageMetadata {
	try {
		return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageMetadata;
	} catch {
		return {};
	}
}

function hasMcpAdapter(): boolean {
	try {
		requireFromHere.resolve("pi-mcp-adapter");
		return true;
	} catch {
		return fs.existsSync(path.join(getAgentDir(), "npm", "node_modules", "pi-mcp-adapter", "index.ts"));
	}
}

function hasDeepseekResponsesModel(): boolean {
	try {
		const modelsPath = path.join(getAgentDir(), "models.json");
		const config = JSON.parse(stripJsonComments(fs.readFileSync(modelsPath, "utf8"), { trailingCommas: true }));
		const models = config?.providers?.deepseek?.models;
		return Array.isArray(models) && models.some(
			(model) => model?.id === "deepseek-v4-flash" && model?.api === "openai-responses",
		);
	} catch {
		return false;
	}
}

function codeReviewGraphStatus(): "missing" | "pinned" | "custom" {
	try {
		const mcpPath = path.join(getAgentDir(), "mcp.json");
		const config = JSON.parse(stripJsonComments(fs.readFileSync(mcpPath, "utf8"), { trailingCommas: true }));
		const server = config?.mcpServers?.["code-review-graph"];
		if (!server || typeof server !== "object" || Array.isArray(server)) return "missing";
		const args = Array.isArray(server.args) ? server.args : [];
		const fromIndex = args.indexOf("--from");
		const withIndex = args.indexOf("--with");
		const toolsIndex = args.indexOf("--tools");
		const commandPath = path.resolve(String(server.command ?? ""));
		const launcherPath = path.resolve(String(args[0] ?? ""));
		const expectedRuntime = path.join(getAgentDir(), "cache", "yimo-pi-kit", "code-review-graph");
		const expectedLauncher = path.join(expectedRuntime, "bin", "uvx-launcher.mjs");
		const runtimeFiles = [
			expectedLauncher,
			path.join(expectedRuntime, "bin", "git-shim.mjs"),
			path.join(expectedRuntime, "bin", "svn-shim.mjs"),
			path.join(expectedRuntime, "fastmcp.env"),
		];
		const runtimeReady = runtimeFiles.every((file) => {
			const stats = lexicalStats(file);
			return Boolean(stats && !stats.isSymbolicLink() && stats.isFile());
		});
		const commandTools = typeof args[toolsIndex + 1] === "string" ? args[toolsIndex + 1].split(",") : [];
		const cloudKeys = ["CRG_OPENAI_API_KEY", "CRG_OPENAI_BASE_URL", "CRG_OPENAI_MODEL", "MINIMAX_API_KEY", "GOOGLE_API_KEY"];
		return path.isAbsolute(String(server.command ?? "")) && server.env?.YIMO_PI_KIT_NODE === commandPath && launcherPath === expectedLauncher && runtimeReady &&
			fromIndex >= 0 && args[fromIndex + 1] === CODE_REVIEW_PACKAGE_SPEC &&
			args[fromIndex + 2] === "python" && args[fromIndex + 3] === "-I" && args[fromIndex + 4] === CODE_REVIEW_RUNNER &&
			withIndex >= 0 && args[withIndex + 1] === "cryptography==50.0.0" &&
			JSON.stringify(commandTools) === JSON.stringify(CODE_REVIEW_TOOLS) &&
			JSON.stringify(server.includeTools) === JSON.stringify(CODE_REVIEW_TOOLS) &&
			server.env?.CRG_TOOLS === CODE_REVIEW_TOOLS.join(",") &&
			server.env?.CRG_ALLOW_REMOTE_CODE === "0" &&
			server.env?.YIMO_PI_KIT_CODE_REVIEW_PROFILE === "managed-v1" &&
			server.env?.FASTMCP_CHECK_FOR_UPDATES === "off" &&
			server.env?.OTEL_TRACES_EXPORTER === "none" &&
			cloudKeys.every((key) => server.env?.[key] === "") &&
			server.lifecycle === "lazy" && server.exposeResources === false && server.directTools === false
			? "pinned"
			: "custom";
	} catch {
		return "missing";
	}
}

function codeReviewSkillCount(): number {
	return CODE_REVIEW_SKILLS.filter((name) =>
		fs.existsSync(path.join(getAgentDir(), "skills", name, "SKILL.md")),
	).length;
}

function lexicalStats(target: string): fs.Stats | undefined {
	try {
		return fs.lstatSync(target);
	} catch {
		return undefined;
	}
}

function hasUnsafeStatePath(): boolean {
	const directoryStats = lexicalStats(KIT_STATE_DIR);
	if (directoryStats && (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())) return true;
	const fileStats = lexicalStats(KIT_STATE_PATH);
	return Boolean(fileStats && (!fileStats.isFile() || fileStats.isSymbolicLink()));
}

function readKitState(): KitState {
	try {
		if (hasUnsafeStatePath()) return {};
		const parsed = JSON.parse(fs.readFileSync(KIT_STATE_PATH, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as KitState : {};
	} catch {
		return {};
	}
}

function writeKitState(state: KitState): void {
	try {
		if (hasUnsafeStatePath()) return;
		fs.mkdirSync(KIT_STATE_DIR, { recursive: true, mode: 0o700 });
		try { fs.chmodSync(KIT_STATE_DIR, 0o700); } catch {}
		const temporary = `${KIT_STATE_PATH}.${process.pid}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
			try { fs.chmodSync(temporary, 0o600); } catch {}
			fs.renameSync(temporary, KIT_STATE_PATH);
			try { fs.chmodSync(KIT_STATE_PATH, 0o600); } catch {}
		} finally {
			try { fs.rmSync(temporary, { force: true }); } catch {}
		}
	} catch {
		// A setup hint must never prevent Pi startup.
	}
}

function startupHintSuppressed(): boolean {
	return /^(?:1|true|yes|on)$/i.test(process.env.YIMO_PI_KIT_HIDE_STARTUP_HINT?.trim() ?? "");
}

export default function (pi: ExtensionAPI) {
	let startupHintShown = false;

	pi.on("session_start", (_event, ctx) => {
		if (startupHintShown || ctx.mode !== "tui" || startupHintSuppressed()) return;
		const metadata = readPackageMetadata();
		const version = metadata.version;
		if (!version || readKitState().lastHintVersion === version) return;

		startupHintShown = true;
		const deepseekResponses = hasDeepseekResponsesModel();
		const graphConfigured = hasMcpAdapter() && codeReviewGraphStatus() === "pinned" && codeReviewSkillCount() === CODE_REVIEW_SKILLS.length;
		const graphHint = graphConfigured
			? " Local code-review graph workflows are configured; use /skill:build-graph or /skill:review-delta."
			: " Optional local code-review graph setup is available through /kit graph.";
		const message = deepseekResponses
			? `${metadata.name ?? "yimo-pi-kit"}@${version} installed/updated. DeepSeek V4 Flash Responses API is configured. Provider-side Web Search remains off by default; use /deepseek-websearch auto or /deepseek-search <query>.${graphHint} Run /kit doctor to verify the rest of the setup.`
			: `${metadata.name ?? "yimo-pi-kit"}@${version} installed/updated. Package installation does not change DeepSeek requests automatically: Flash remains on Pi's default Chat Completions until you review and run /kit deepseek. Provider-side Web Search is off by default.${graphHint} Run /kit doctor for status.`;
		ctx.ui.notify(message, deepseekResponses ? "info" : "warning");
		writeKitState({ lastHintVersion: version, hintedAt: new Date().toISOString() });
	});
	pi.registerCommand("kit", {
		description: "Show yimo-pi-kit status and setup hints (/kit [status|agents|doctor|setup|deepseek|graph])",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			const metadata = readPackageMetadata();
			const discovery = discoverAgents(ctx.cwd, "user");
			const missingSkills = [...new Set(discovery.agents.flatMap((agent) => agent.missingSkills ?? []))].sort();
			const mcpConfigPath = path.join(getAgentDir(), "mcp.json");

			if (action === "agents") {
				const names = discovery.agents.map((agent) => `${agent.name} (${agent.source})`).join(", ");
				ctx.ui.notify(`${discovery.agents.length} agents: ${names}`, "info");
				return;
			}

			if (action === "doctor") {
				const adapter = hasMcpAdapter();
				const config = fs.existsSync(mcpConfigPath);
				const deepseekResponses = hasDeepseekResponsesModel();
				const graphStatus = codeReviewGraphStatus();
				const graphSkills = codeReviewSkillCount();
				const subagentRegistered = pi.getAllTools().some((tool) => tool.name === "subagent");
				const status = [
					`${metadata.name ?? "yimo-pi-kit"}@${metadata.version ?? "unknown"}`,
					`${discovery.agents.length} agents`,
					`subagent tool ${subagentRegistered ? "ready" : "missing"}`,
					`DeepSeek Responses ${deepseekResponses ? "configured" : "not configured"}`,
					`code-review graph MCP ${graphStatus}`,
					`graph skills ${graphSkills}/${CODE_REVIEW_SKILLS.length}`,
					`MCP adapter ${adapter ? "available" : "missing"}`,
					`MCP config ${config ? "installed" : "not installed"}`,
					`${missingSkills.length} optional skills missing`,
				];
				ctx.ui.notify(status.join(" · "), subagentRegistered ? "info" : "error");
				return;
			}

			if (action === "setup") {
				const cliPath = path.join(PACKAGE_ROOT, "scripts", "cli.mjs");
				const setupCommand = `!node ${JSON.stringify(cliPath)} setup-mcp`;
				ctx.ui.setEditorText(setupCommand);
				ctx.ui.notify(
					`Setup command copied to the editor: ${setupCommand}. Install parent MCP first with pi install npm:pi-mcp-adapter@2.15.0.`,
					"info",
				);
				return;
			}

			if (action === "deepseek" || action === "setup-deepseek") {
				const cliPath = path.join(PACKAGE_ROOT, "scripts", "cli.mjs");
				const setupCommand = `!node ${JSON.stringify(cliPath)} setup-deepseek`;
				ctx.ui.setEditorText(setupCommand);
				ctx.ui.notify(
					`DeepSeek setup command copied to the editor: ${setupCommand}. Review it, then authenticate with /login or DEEPSEEK_API_KEY.`,
					"info",
				);
				return;
			}

			if (action === "graph" || action === "code-review" || action === "setup-code-review") {
				const cliPath = path.join(PACKAGE_ROOT, "scripts", "cli.mjs");
				const setupCommand = `!node ${JSON.stringify(cliPath)} setup-code-review`;
				ctx.ui.setEditorText(setupCommand);
				ctx.ui.notify(
					`Code review graph setup command copied to the editor: ${setupCommand}. Review it before running; it downloads pinned MIT-licensed third-party code and enables a local stdio MCP server.`,
					"info",
				);
				return;
			}

			if (action !== "status") {
				ctx.ui.notify("Usage: /kit [status|agents|doctor|setup|deepseek|graph]", "warning");
				return;
			}

			ctx.ui.notify(
				`${metadata.name ?? "yimo-pi-kit"}@${metadata.version ?? "unknown"} · ${discovery.agents.length} agents · DeepSeek Responses ${hasDeepseekResponsesModel() ? "configured" : "not configured"} · code-review graph ${codeReviewGraphStatus()} (${codeReviewSkillCount()}/${CODE_REVIEW_SKILLS.length} skills) · ${missingSkills.length} optional skills missing`,
				"info",
			);
		},
	});
}
