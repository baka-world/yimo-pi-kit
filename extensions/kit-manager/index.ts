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
const requireFromHere = createRequire(import.meta.url);

interface PackageMetadata {
	name?: string;
	version?: string;
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

export default function (pi: ExtensionAPI) {
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
