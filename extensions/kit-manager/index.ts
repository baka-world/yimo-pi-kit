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
		const message = deepseekResponses
			? `${metadata.name ?? "yimo-pi-kit"}@${version} installed/updated. DeepSeek V4 Flash Responses API is configured. Provider-side Web Search remains off by default; use /deepseek-websearch auto or /deepseek-search <query>. Run /kit doctor to verify the rest of the setup.`
			: `${metadata.name ?? "yimo-pi-kit"}@${version} installed/updated. Package installation does not change DeepSeek requests automatically: Flash remains on Pi's default Chat Completions until you review and run /kit deepseek. Provider-side Web Search is off by default. Run /kit doctor for status.`;
		ctx.ui.notify(message, deepseekResponses ? "info" : "warning");
		writeKitState({ lastHintVersion: version, hintedAt: new Date().toISOString() });
	});
	pi.registerCommand("kit", {
		description: "Show yimo-pi-kit status and setup hints (/kit [status|agents|doctor|setup|deepseek])",
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
				const subagentRegistered = pi.getAllTools().some((tool) => tool.name === "subagent");
				const status = [
					`${metadata.name ?? "yimo-pi-kit"}@${metadata.version ?? "unknown"}`,
					`${discovery.agents.length} agents`,
					`subagent tool ${subagentRegistered ? "ready" : "missing"}`,
					`DeepSeek Responses ${deepseekResponses ? "configured" : "not configured"}`,
					`MCP adapter ${adapter ? "available" : "missing"}`,
					`MCP config ${config ? "installed" : "not installed"}`,
					`${missingSkills.length} optional skills missing`,
				];
				ctx.ui.notify(status.join(" · "), subagentRegistered ? "info" : "error");
				return;
			}

			if (action === "setup") {
				const cliPath = path.join(PACKAGE_ROOT, "scripts", "cli.mjs");
				const setupCommand = `node ${JSON.stringify(cliPath)} setup-mcp`;
				ctx.ui.setEditorText(setupCommand);
				ctx.ui.notify(
					`Setup command copied to the editor: ${setupCommand}. Install parent MCP first with pi install npm:pi-mcp-adapter@2.15.0.`,
					"info",
				);
				return;
			}

			if (action === "deepseek" || action === "setup-deepseek") {
				const cliPath = path.join(PACKAGE_ROOT, "scripts", "cli.mjs");
				const setupCommand = `node ${JSON.stringify(cliPath)} setup-deepseek`;
				ctx.ui.setEditorText(setupCommand);
				ctx.ui.notify(
					`DeepSeek setup command copied to the editor: ${setupCommand}. Review it, then authenticate with /login or DEEPSEEK_API_KEY.`,
					"info",
				);
				return;
			}

			if (action !== "status") {
				ctx.ui.notify("Usage: /kit [status|agents|doctor|setup|deepseek]", "warning");
				return;
			}

			ctx.ui.notify(
				`${metadata.name ?? "yimo-pi-kit"}@${metadata.version ?? "unknown"} · ${discovery.agents.length} agents · DeepSeek Responses ${hasDeepseekResponsesModel() ? "configured" : "not configured"} · ${missingSkills.length} optional skills missing`,
				"info",
			);
		},
	});
}
