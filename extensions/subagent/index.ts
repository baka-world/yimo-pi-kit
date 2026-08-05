/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	type AgentConfig,
	type AgentScope,
	type AgentThinkingLevel,
	discoverAgents,
} from "./agents.ts";

const MAX_PARALLEL_TASKS = 8;
const configuredConcurrency = Number(process.env.YIMO_PI_SUBAGENT_CONCURRENCY ?? 2);
const MAX_CONCURRENCY = Number.isFinite(configuredConcurrency)
	? Math.max(1, Math.min(MAX_PARALLEL_TASKS, Math.floor(configuredConcurrency)))
	: 2;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;
const RETRY_FEEDBACK_CAP = 12 * 1024;
const DEFAULT_SUBAGENT_TOOLS = ["read", "grep", "find", "ls", "bash", "write", "edit"];
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_FAILOVER_EXTENSION_PATH = path.join(PACKAGE_ROOT, "extensions", "api-key-failover", "index.ts");
const USER_FAILOVER_EXTENSION_PATH = path.join(getAgentDir(), "extensions", "api-key-failover", "index.ts");
const requireFromHere = createRequire(import.meta.url);

function resolveMcpAdapterExtensionPath(): string | null {
	const override = process.env.YIMO_PI_MCP_ADAPTER_EXTENSION?.trim();
	if (override) return path.resolve(override);
	try {
		return requireFromHere.resolve("pi-mcp-adapter");
	} catch {
		const userInstalled = path.join(getAgentDir(), "npm", "node_modules", "pi-mcp-adapter", "index.ts");
		return fs.existsSync(userInstalled) ? userInstalled : null;
	}
}

function resolveFailoverExtensionPath(): string | null {
	const override = process.env.YIMO_PI_FAILOVER_EXTENSION?.trim();
	if (override) return path.resolve(override);
	if (fs.existsSync(PACKAGE_FAILOVER_EXTENSION_PATH)) return PACKAGE_FAILOVER_EXTENSION_PATH;
	return fs.existsSync(USER_FAILOVER_EXTENSION_PATH) ? USER_FAILOVER_EXTENSION_PATH : null;
}
const DEFAULT_MAX_WAIT_SECONDS = 600;
const DEFAULT_CONCLUSION_GRACE_SECONDS = 90;
const DEFAULT_MAX_RETRIES = 1;
const MAX_CONFIGURED_RETRIES = 3;
const RPC_EXIT_GRACE_MS = 5000;
const RPC_ABORT_GRACE_MS = 1500;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const SAFE_TMPDIR = process.env.PI_TMPDIR?.trim()
	|| path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "tmp");
type ThinkingLevel = AgentThinkingLevel;

function applyThinkingLevel(model: string | undefined, thinking: ThinkingLevel | undefined): string | undefined {
	if (!model || !thinking) return model;
	const suffixPattern = new RegExp(`:(${THINKING_LEVELS.join("|")})$`);
	return `${model.replace(suffixPattern, "")}:${thinking}`;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "package" | "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	timedOut?: boolean;
	conclusionRequested?: boolean;
	attempt?: number;
	maxAttempts?: number;
}

interface BillingSummary {
	invocationSubagentCost: number;
	sessionSubagentCost: number;
	sessionParentCost: number;
	sessionTotalCost: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	billing?: BillingSummary;
}

function sumResultCosts(results: SingleResult[]): number {
	return results.reduce((total, result) => total + (result.usage.cost || 0), 0);
}

function mergeAttemptUsage(target: SingleResult, attempts: SingleResult[]): SingleResult {
	if (attempts.length <= 1) return target;
	const aggregate: UsageStats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: target.usage.contextTokens,
		turns: 0,
	};
	for (const attempt of attempts) {
		aggregate.input += attempt.usage.input;
		aggregate.output += attempt.usage.output;
		aggregate.cacheRead += attempt.usage.cacheRead;
		aggregate.cacheWrite += attempt.usage.cacheWrite;
		aggregate.cost += attempt.usage.cost;
		aggregate.turns += attempt.usage.turns;
	}
	return { ...target, usage: aggregate };
}

function getAssistantText(message: Message): string {
	if (message.role !== "assistant") return "";
	const texts: string[] = [];
	for (const part of message.content) {
		if (part.type === "text") texts.push(part.text);
	}
	return texts.join("\n").trim();
}

function getFinalOutput(messages: Message[]): string {
	// Prefer a genuinely completed assistant turn. If a provider aborts during a
	// later cleanup/conclusion turn, fall back to the latest non-empty text rather
	// than letting an empty aborted message hide an already-produced answer.
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant" || (msg.stopReason !== "stop" && msg.stopReason !== "length")) continue;
		const text = getAssistantText(msg);
		if (text) return text;
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = getAssistantText(messages[i]);
		if (text) return text;
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function isSatisfactoryResult(result: SingleResult): boolean {
	return !isFailedResult(result) && getFinalOutput(result.messages).length > 0;
}

function clampRetries(value: number): number {
	return Math.max(0, Math.min(MAX_CONFIGURED_RETRIES, Math.floor(value)));
}

function truncateRetryFeedback(output: string): string {
	if (Buffer.byteLength(output, "utf8") <= RETRY_FEEDBACK_CAP) return output;
	let truncated = output.slice(-RETRY_FEEDBACK_CAP);
	while (Buffer.byteLength(truncated, "utf8") > RETRY_FEEDBACK_CAP) truncated = truncated.slice(1);
	return `[Earlier failure output omitted]\n${truncated}`;
}

function getResultOutput(result: SingleResult): string {
	const finalOutput = getFinalOutput(result.messages);
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || finalOutput || "(no output)";
	}
	return finalOutput || "(no output)";
}

function shouldRetryResult(result: SingleResult): boolean {
	if (isSatisfactoryResult(result)) return false;
	// A hard task timeout may have produced files or launched external work. Do
	// not replay it automatically and risk duplicate side effects.
	if (result.timedOut) return false;
	const diagnostic = `${result.errorMessage ?? ""}\n${result.stderr}`;
	// Retrying deterministic configuration/schema failures only repeats the same
	// request and doubles cost. Transient provider failures and empty successful
	// turns remain retryable.
	if (
		/Unknown agent:|Unknown option: --mcp-config|Invalid schema for function|No API provider registered|No API key available|Model not found|401\b|403\b/i.test(
			diagnostic,
		)
	) {
		return false;
	}
	return true;
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	await fs.promises.mkdir(SAFE_TMPDIR, { recursive: true, mode: 0o700 });
	const tmpDir = await fs.promises.mkdtemp(path.join(SAFE_TMPDIR, "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	thinking: ThinkingLevel | undefined,
	maxWaitSeconds: number | undefined,
	conclusionGraceSeconds: number | undefined,
	maxRetries: number | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const effectiveThinking = thinking ?? agent.thinking;
	const effectiveModel = applyThinkingLevel(agent.model, effectiveThinking);
	const effectiveMaxWaitSeconds = maxWaitSeconds ?? agent.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS;
	const effectiveConclusionGraceSeconds =
		conclusionGraceSeconds ?? agent.conclusionGraceSeconds ?? DEFAULT_CONCLUSION_GRACE_SECONDS;
	const effectiveMaxRetries = clampRetries(maxRetries ?? agent.maxRetries ?? DEFAULT_MAX_RETRIES);
	const maxAttempts = effectiveMaxRetries + 1;

	const runAttempt = async (attempt: number, attemptTask: string): Promise<SingleResult> => {
		const configuredTools = agent.tools ?? DEFAULT_SUBAGENT_TOOLS;
		const directMcpSelectors = configuredTools
			.filter((tool) => tool.startsWith("mcp:"))
			.map((tool) => tool.slice("mcp:".length).replace(":", "/"))
			.filter(Boolean);
		const allowedTools = configuredTools.filter((tool) => !tool.startsWith("mcp:"));
		const needsMcpAdapter = Boolean(agent.mcpConfig || directMcpSelectors.length > 0 || allowedTools.includes("mcp"));
		const mcpAdapterExtensionPath = needsMcpAdapter ? resolveMcpAdapterExtensionPath() : null;
		const mcpAvailable = Boolean(mcpAdapterExtensionPath && fs.existsSync(mcpAdapterExtensionPath));
		const runnableTools = mcpAvailable ? allowedTools : allowedTools.filter((tool) => tool !== "mcp");
		const args: string[] = [
			"--mode",
			"rpc",
			"--no-session",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
		];
		const failoverExtensionPath = resolveFailoverExtensionPath();
		if (failoverExtensionPath && fs.existsSync(failoverExtensionPath)) {
			args.push("--extension", failoverExtensionPath);
		}
		if (mcpAvailable && mcpAdapterExtensionPath) {
			args.push("--extension", mcpAdapterExtensionPath);
		}
		if (mcpAvailable && agent.mcpConfig) {
			if (!fs.existsSync(agent.mcpConfig)) {
				return {
					agent: agentName,
					agentSource: agent.source,
					task: attemptTask,
					exitCode: 1,
					messages: [],
					stderr: `MCP config does not exist: ${agent.mcpConfig}`,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					model: effectiveModel ?? (effectiveThinking ? `default:${effectiveThinking}` : agent.model),
					step,
					attempt,
					maxAttempts,
				};
			}
			args.push("--mcp-config", agent.mcpConfig);
		}
		for (const skill of agent.skills ?? []) args.push("--skill", skill);
		if (effectiveModel) args.push("--model", effectiveModel);
		else if (effectiveThinking) args.push("--thinking", effectiveThinking);
		if (runnableTools.length > 0) args.push("--tools", runnableTools.join(","));

		let tmpPromptDir: string | null = null;
		let tmpPromptPath: string | null = null;
		const currentResult: SingleResult = {
			agent: agentName,
			agentSource: agent.source,
			task: attemptTask,
			exitCode: 0,
			messages: [],
			stderr: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			model: effectiveModel ?? (effectiveThinking ? `default:${effectiveThinking}` : agent.model),
			step,
			attempt,
			maxAttempts,
		};

		const emitUpdate = (status?: string) => {
			if (!onUpdate) return;
			onUpdate({
				content: [{ type: "text", text: status ?? (getFinalOutput(currentResult.messages) || "(running...)") }],
				details: makeDetails([currentResult]),
			});
		};

		try {
			const missingSkillNotice = agent.missingSkills?.length
				? `\n\nOptional skills not installed and therefore not supplied for this run: ${agent.missingSkills.join(", ")}. Do not claim to have read them; continue with the available instructions and tools.`
				: "";
			const missingMcpNotice = needsMcpAdapter && !mcpAvailable
				? "\n\nMCP is not available in this child process because pi-mcp-adapter is not installed. Do not claim to use MCP; continue with the available local tools and state this limitation when it materially affects the answer."
				: "";
			const effectiveSystemPrompt = `${agent.systemPrompt.trim()}${missingSkillNotice}${missingMcpNotice}`.trim();
			if (effectiveSystemPrompt) {
				const tmp = await writePromptToTempFile(agent.name, effectiveSystemPrompt);
				tmpPromptDir = tmp.dir;
				tmpPromptPath = tmp.filePath;
				args.push("--append-system-prompt", tmpPromptPath);
			}

			let externallyAborted = false;
			let conclusionRequested = false;
			let forceKilled = false;
			let completionAfterConclusion = false;
			const exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const childEnv = {
					...process.env,
					TMPDIR: SAFE_TMPDIR,
					TMP: SAFE_TMPDIR,
					TEMP: SAFE_TMPDIR,
					PI_TMPDIR: SAFE_TMPDIR,
					PI_SUBAGENT: "1",
					MCP_DIRECT_TOOLS:
						mcpAvailable && directMcpSelectors.length > 0 ? directMcpSelectors.join(",") : "__none__",
				};
				const proc = spawn(invocation.command, invocation.args, {
					cwd: cwd ?? defaultCwd,
					env: childEnv,
					shell: false,
					stdio: ["pipe", "pipe", "pipe"],
				});
				const decoder = new StringDecoder("utf8");
				let buffer = "";
				let processClosed = false;
				let agentSettled = false;
				let resolved = false;
				let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
				let conclusionTimer: ReturnType<typeof setTimeout> | undefined;
				let gracefulExitTimer: ReturnType<typeof setTimeout> | undefined;
				let abortTimer: ReturnType<typeof setTimeout> | undefined;
				let killTimer: ReturnType<typeof setTimeout> | undefined;
				let abortFromParent: (() => void) | undefined;

				const clearTimers = () => {
					if (maxWaitTimer) clearTimeout(maxWaitTimer);
					if (conclusionTimer) clearTimeout(conclusionTimer);
					if (gracefulExitTimer) clearTimeout(gracefulExitTimer);
					if (abortTimer) clearTimeout(abortTimer);
					if (killTimer) clearTimeout(killTimer);
				};
				const finish = (code: number) => {
					if (resolved) return;
					resolved = true;
					clearTimers();
					if (signal && abortFromParent) signal.removeEventListener("abort", abortFromParent);
					resolve(code);
				};
				const sendRpc = (payload: Record<string, unknown>): boolean => {
					if (processClosed || proc.stdin.destroyed || proc.stdin.writableEnded) return false;
					try {
						proc.stdin.write(`${JSON.stringify(payload)}\n`);
						return true;
					} catch {
						return false;
					}
				};
				const terminateProcess = () => {
					if (processClosed) return;
					try {
						if (!proc.stdin.writableEnded) proc.stdin.end();
					} catch {
						/* ignore */
					}
					proc.kill("SIGTERM");
					killTimer = setTimeout(() => {
						if (!processClosed) proc.kill("SIGKILL");
					}, RPC_EXIT_GRACE_MS);
				};
				const forceStop = () => {
					if (processClosed || forceKilled) return;
					forceKilled = true;
					sendRpc({ type: "abort" });
					abortTimer = setTimeout(terminateProcess, RPC_ABORT_GRACE_MS);
				};
				const requestConclusion = () => {
					if (processClosed || agentSettled || conclusionRequested) return;
					conclusionRequested = true;
					currentResult.conclusionRequested = true;
					emitUpdate(`Time limit reached; asked ${agentName} to stop exploring and give its best concise conclusion.`);
					sendRpc({
						type: "steer",
						message:
							"Time limit reached. Stop starting new tool calls or research. Immediately synthesize the evidence already collected and return your best concise final conclusion in the required output format. Explicitly state uncertainties and missing evidence. Do not continue exploring.",
					});
					conclusionTimer = setTimeout(forceStop, Math.max(0, effectiveConclusionGraceSeconds) * 1000);
				};
				const appendMessage = (msg: Message) => {
					currentResult.messages.push(msg);
					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
						if (
							conclusionRequested &&
							(msg.stopReason === "stop" || msg.stopReason === "length") &&
							getAssistantText(msg).length > 0
						) {
							completionAfterConclusion = true;
						}
					}
					emitUpdate();
				};
				const processLine = (line: string) => {
					if (!line.trim()) return;
					let event: any;
					try {
						event = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line);
					} catch {
						currentResult.stderr += `Malformed RPC output: ${line.slice(0, 500)}\n`;
						return;
					}
					if (event.type === "message_end" && event.message) appendMessage(event.message as Message);
					if (event.type === "tool_result_end" && event.message) appendMessage(event.message as Message);
					if (event.type === "extension_error") {
						currentResult.stderr += `Extension error (${event.extensionPath ?? "unknown"}): ${event.error ?? "unknown error"}\n`;
					}
					if (event.type === "response" && event.id === "subagent-prompt" && event.success === false) {
						currentResult.stopReason = "error";
						currentResult.errorMessage = event.error || "Subagent prompt was rejected";
						terminateProcess();
					}
					if (event.type === "agent_settled") {
						agentSettled = true;
						if (maxWaitTimer) clearTimeout(maxWaitTimer);
						if (conclusionTimer) clearTimeout(conclusionTimer);
						try {
							if (!proc.stdin.writableEnded) proc.stdin.end();
						} catch {
							/* ignore */
						}
						// RPC mode is a long-lived server. EOF should shut it down cleanly;
						// SIGTERM is only a fallback and must not turn a completed task into 143.
						gracefulExitTimer = setTimeout(terminateProcess, RPC_EXIT_GRACE_MS);
					}
				};
				const consumeStdout = (chunk: string) => {
					buffer += chunk;
					while (true) {
						const newline = buffer.indexOf("\n");
						if (newline < 0) break;
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						processLine(line);
					}
				};

				proc.stdout.on("data", (data) => consumeStdout(decoder.write(data)));
				proc.stdout.on("end", () => {
					consumeStdout(decoder.end());
					if (buffer.trim()) processLine(buffer);
					buffer = "";
				});
				proc.stderr.on("data", (data) => {
					currentResult.stderr += data.toString();
				});
				proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
					if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_WRITE_AFTER_END") {
						currentResult.stderr += `RPC stdin error: ${error.message}\n`;
					}
				});
				proc.on("spawn", () =>
					sendRpc({ id: "subagent-prompt", type: "prompt", message: `Task: ${attemptTask}` }),
				);
				proc.on("close", (code, closeSignal) => {
					processClosed = true;
					if (buffer.trim()) processLine(buffer);
					const signalCode = closeSignal === "SIGTERM" ? 143 : closeSignal === "SIGKILL" ? 137 : 1;
					// A settled RPC session is complete even if the long-lived server needed
					// a cleanup signal to exit. Preserve genuine startup/provider failures.
					finish(agentSettled && !externallyAborted ? 0 : (code ?? signalCode));
				});
				proc.on("error", (error) => {
					currentResult.stderr += `Failed to spawn subagent: ${error.message}\n`;
					finish(1);
				});

				maxWaitTimer =
					effectiveMaxWaitSeconds > 0
						? setTimeout(requestConclusion, effectiveMaxWaitSeconds * 1000)
						: undefined;
				if (signal) {
					abortFromParent = () => {
						externallyAborted = true;
						forceStop();
					};
					if (signal.aborted) abortFromParent();
					else signal.addEventListener("abort", abortFromParent, { once: true });
				}
			});

			currentResult.exitCode = exitCode;
			const hasCompletedOutput = currentResult.messages.some(
				(message) =>
					message.role === "assistant" &&
					(message.stopReason === "stop" || message.stopReason === "length") &&
					getAssistantText(message).length > 0,
			);
			currentResult.timedOut = forceKilled && !hasCompletedOutput;
			if (forceKilled && !hasCompletedOutput) {
				currentResult.exitCode = 124;
				currentResult.stopReason = "error";
				currentResult.errorMessage = `Timed out after ${effectiveMaxWaitSeconds}s plus ${effectiveConclusionGraceSeconds}s conclusion grace period.`;
			} else if (hasCompletedOutput || completionAfterConclusion) {
				currentResult.exitCode = 0;
				currentResult.stopReason = "stop";
				currentResult.errorMessage = undefined;
			}
			if (externallyAborted) throw new Error("Subagent was aborted");
			return currentResult;
		} finally {
			if (tmpPromptPath)
				try {
					fs.unlinkSync(tmpPromptPath);
				} catch {
					/* ignore */
				}
			if (tmpPromptDir)
				try {
					fs.rmdirSync(tmpPromptDir);
				} catch {
					/* ignore */
				}
		}
	};

	const attempts: SingleResult[] = [];
	let result = await runAttempt(1, task);
	attempts.push(result);
	for (let attempt = 2; attempt <= maxAttempts && shouldRetryResult(result); attempt++) {
		const failure = truncateRetryFeedback(getResultOutput(result));
		const retryTask = `${task}\n\nRETRY ${attempt - 1}/${effectiveMaxRetries}: The previous attempt was unsatisfactory. Reason/output:\n${failure}\n\nReturn a complete, concrete final answer. Prioritize the required deliverable; do not repeat the same failure.`;
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: `${agentName} attempt ${attempt - 1} was unsatisfactory; retrying (${attempt}/${maxAttempts})...` }],
				details: makeDetails([result]),
			});
		}
		result = await runAttempt(attempt, retryTask);
		attempts.push(result);
	}
	result = mergeAttemptUsage(result, attempts);
	result.task = task;
	if (!isSatisfactoryResult(result)) {
		const lastOutput = getFinalOutput(result.messages).trim();
		const lastDiagnostic = (result.errorMessage || result.stderr).trim();
		const details = lastDiagnostic
			? ` Last failure:\n${truncateRetryFeedback(lastDiagnostic)}`
			: lastOutput
				? ` Last output:\n${truncateRetryFeedback(lastOutput)}`
				: "";
		result.exitCode = result.exitCode === 0 ? 1 : result.exitCode;
		result.stopReason = "error";
		result.errorMessage = `Unsatisfactory after ${attempts.length} attempt(s).${details}`;
	}
	return result;
}

const USER_AGENT_NAMES = discoverAgents(process.cwd(), "user").agents.map((agent) => agent.name);
const USER_AGENT_HINT = USER_AGENT_NAMES.length > 0 ? USER_AGENT_NAMES.join(", ") : "none discovered";

const ThinkingLevelSchema = StringEnum(THINKING_LEVELS, {
	description: "Optional reasoning intensity override for this invocation. Choose based on task difficulty.",
});

const ExecutionControls = {
	maxWaitSeconds: Type.Optional(
		Type.Number({ minimum: 0, description: "Seconds before asking the agent to stop exploring and conclude. 0 disables." }),
	),
	conclusionGraceSeconds: Type.Optional(
		Type.Number({ minimum: 0, description: "Seconds allowed to produce a conclusion after the timeout warning." }),
	),
	maxRetries: Type.Optional(
		Type.Integer({ minimum: 0, maximum: MAX_CONFIGURED_RETRIES, description: "Retries after timeout, failure, or empty output." }),
	),
};

const TaskItem = Type.Object({
	agent: Type.String({ description: `Name of the agent to invoke. User agents: ${USER_AGENT_HINT}` }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	thinking: Type.Optional(ThinkingLevelSchema),
	...ExecutionControls,
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: `Name of the agent to invoke. User agents: ${USER_AGENT_HINT}` }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	thinking: Type.Optional(ThinkingLevelSchema),
	...ExecutionControls,
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["package", "user", "project", "both"] as const, {
	description:
		'Which agents to use. "user" (default) loads bundled agents plus user overrides; "package" uses only bundled agents; "both" also enables trusted project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({ description: `Name of the agent to invoke (for single mode). User agents: ${USER_AGENT_HINT}` }),
	),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	thinking: Type.Optional(ThinkingLevelSchema),
	...ExecutionControls,
	tasks: Type.Optional(
		Type.Array(TaskItem, { description: "Parallel tasks; each may independently override thinking intensity" }),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, { description: "Sequential steps; each may independently override thinking intensity" }),
	),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

export default function (pi: ExtensionAPI) {
	let sessionSubagentCost = 0;

	pi.on("session_start", (_event, ctx) => {
		// Restore the latest cumulative subagent charge when resuming or reloading a session.
		sessionSubagentCost = ctx.sessionManager.getBranch().reduce((latest, entry: any) => {
			const restored = entry.message?.details?.billing?.sessionSubagentCost;
			return typeof restored === "number" && Number.isFinite(restored) ? Math.max(latest, restored) : latest;
		}, 0);
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Available user agents: ${USER_AGENT_HINT}.`,
			"Set optional thinking and execution controls per invocation or task/chain step. On maxWaitSeconds, the parent steers the child to conclude; after conclusionGraceSeconds it aborts, and unsatisfactory attempts retry up to maxRetries.",
			'Default agent scope is "user": bundled package agents with optional overrides from the Pi user agents directory.',
			`To enable trusted project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const parentCostAtStart = ctx.sessionManager
				.getBranch()
				.reduce((total, entry: any) => total + (entry.message?.role === "assistant" ? entry.message.usage?.cost?.total || 0 : 0), 0);
			const agentScope: AgentScope = params.agentScope ?? "user";
			if ((agentScope === "project" || agentScope === "both") && !ctx.isProjectTrusted()) {
				return {
					content: [{ type: "text", text: "Canceled: project-local agents require a trusted project." }],
					details: {
						mode: params.chain?.length ? "chain" : params.tasks?.length ? "parallel" : "single",
						agentScope,
						projectAgentsDir: null,
						results: [],
					},
				};
			}
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => {
					const invocationSubagentCost = sumResultCosts(results);
					return {
						mode,
						agentScope,
						projectAgentsDir: discovery.projectAgentsDir,
						results,
						billing: {
							invocationSubagentCost,
							sessionSubagentCost: sessionSubagentCost + invocationSubagentCost,
							sessionParentCost: parentCostAtStart,
							sessionTotalCost: parentCostAtStart + sessionSubagentCost + invocationSubagentCost,
						},
					};
				};

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						step.thinking,
						step.maxWaitSeconds,
						step.conclusionGraceSeconds,
						step.maxRetries,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						const chainDetails = makeDetails("chain")(results);
						sessionSubagentCost += sumResultCosts(results);
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: chainDetails,
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				const chainDetails = makeDetails("chain")(results);
				sessionSubagentCost += sumResultCosts(results);
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: chainDetails,
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						t.thinking,
						t.maxWaitSeconds,
						t.conclusionGraceSeconds,
						t.maxRetries,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				const parallelDetails = makeDetails("parallel")(results);
				sessionSubagentCost += sumResultCosts(results);
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: parallelDetails,
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					params.thinking,
					params.maxWaitSeconds,
					params.conclusionGraceSeconds,
					params.maxRetries,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					const singleDetails = makeDetails("single")([result]);
					sessionSubagentCost += result.usage.cost;
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: singleDetails,
						isError: true,
					};
				}
				const singleDetails = makeDetails("single")([result]);
				sessionSubagentCost += result.usage.cost;
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: singleDetails,
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						(step.thinking ? theme.fg("warning", ` [${step.thinking}]`) : "") +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${t.thinking ? theme.fg("warning", ` [${t.thinking}]`) : ""}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`) +
				(args.thinking ? theme.fg("warning", ` [thinking:${args.thinking}]`) : "");
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const billingLine = details.billing
				? `Cost: subagent $${details.billing.invocationSubagentCost.toFixed(4)} · session subagents $${details.billing.sessionSubagentCost.toFixed(4)} · total $${details.billing.sessionTotalCost.toFixed(4)}`
				: "";

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = isFailedResult(r);
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					if (billingLine) container.addChild(new Text(theme.fg("warning", billingLine), 0, 0));
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				if (billingLine) text += `\n${theme.fg("warning", billingLine)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Subagents: ${usageStr}`), 0, 0));
					}
					if (billingLine) container.addChild(new Text(theme.fg("warning", billingLine), 0, 0));
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Subagents: ${usageStr}`)}`;
				if (billingLine) text += `\n${theme.fg("warning", billingLine)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Subagents: ${usageStr}`), 0, 0));
					}
					if (billingLine) container.addChild(new Text(theme.fg("warning", billingLine), 0, 0));
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Subagents: ${usageStr}`)}`;
				if (billingLine) text += `\n${theme.fg("warning", billingLine)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
