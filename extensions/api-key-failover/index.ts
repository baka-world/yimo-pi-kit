import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";

const streamSimpleOpenAICompletions = openAICompletionsApi().streamSimple;

interface ProviderFileConfig {
	baseUrl?: string;
	api?: Api;
	apiKey?: string;
	apiKeys?: string[];
	apiKeyFile?: string;
	failover?: {
		timeoutMs?: number;
		maxAttempts?: number;
	};
	models?: unknown[];
}

interface ModelsFile {
	providers?: Record<string, ProviderFileConfig>;
}

interface AttemptResult {
	events: AssistantMessageEvent[];
	message: AssistantMessage;
	emittedContent: boolean;
}

interface AttemptProgress {
	committed: boolean;
	forwardingEnabled: boolean;
}

const AGENT_DIR = getAgentDir();
const MODELS_PATH = path.join(AGENT_DIR, "models.json");
const CUSTOM_API = "openai-completions-key-failover";
const DEFAULT_TIMEOUT_MS = 120_000;
const TIMEOUT_PATTERN =
	/\b(?:request timed out|timed out|timeout|etimedout|esockettimedout|connecttimeouterror|headers timeout|body timeout|no stream activity)\b/i;

function loadProviderConfigs(): Record<string, ProviderFileConfig> {
	try {
		const parsed = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as ModelsFile;
		return parsed.providers ?? {};
	} catch {
		return {};
	}
}

function interpolateEnvironment(value: string): string {
	return value
		.replace(/\$\$/g, "\0DOLLAR\0")
		.replace(/\$!/g, "\0BANG\0")
		.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, plain) => {
			return process.env[braced || plain] ?? "";
		})
		.replace(/\0DOLLAR\0/g, "$")
		.replace(/\0BANG\0/g, "!");
}

function resolveKeyFilePath(configuredPath: string): string {
	const interpolated = interpolateEnvironment(configuredPath);
	return path.isAbsolute(interpolated) ? interpolated : path.resolve(AGENT_DIR, interpolated);
}

function readKeyFile(configuredPath: string): string[] {
	const keyPath = resolveKeyFilePath(configuredPath);
	const stats = lstatSync(keyPath);
	if (stats.isSymbolicLink()) throw new Error(`API key file must not be a symbolic link: ${keyPath}`);
	if (!stats.isFile()) throw new Error(`API key path is not a regular file: ${keyPath}`);
	const currentUid = process.getuid?.();
	if (currentUid !== undefined && stats.uid !== currentUid) {
		throw new Error(`API key file must be owned by the current user: ${keyPath}`);
	}
	if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
		throw new Error(`API key file permissions must be 0600 or stricter: ${keyPath}`);
	}

	return readFileSync(keyPath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

function resolveKeys(config: ProviderFileConfig): string[] {
	if (config.apiKeyFile) return [...new Set(readKeyFile(config.apiKeyFile))];

	const configured = Array.isArray(config.apiKeys) && config.apiKeys.length > 0
		? config.apiKeys
		: config.apiKey
			? [config.apiKey]
			: [];
	return [...new Set(configured.map(interpolateEnvironment).map((key) => key.trim()).filter(Boolean))];
}

function isTimeoutError(message: AssistantMessage): boolean {
	return message.stopReason === "error" && TIMEOUT_PATTERN.test(message.errorMessage ?? "");
}

function isAuthError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error") return false;
	return /\b(?:401|403|unauthorized|invalid.*(?:api.?key|key|token|auth)|auth.*(?:invalid|fail|denied|expired)|permission.?denied|forbidden)\b/i.test(
		message.errorMessage ?? "",
	);
}

function isContentEvent(event: AssistantMessageEvent): boolean {
	return (
		event.type === "text_start" ||
		event.type === "text_delta" ||
		event.type === "text_end" ||
		event.type === "thinking_start" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_end" ||
		event.type === "toolcall_start" ||
		event.type === "toolcall_delta" ||
		event.type === "toolcall_end"
	);
}

function rewriteMessageApi(message: AssistantMessage, api: Api): AssistantMessage {
	return message.api === api ? message : { ...message, api };
}

function rewriteEventApi(event: AssistantMessageEvent, api: Api): AssistantMessageEvent {
	if (event.type === "done") return { ...event, message: rewriteMessageApi(event.message, api) };
	if (event.type === "error") return { ...event, error: rewriteMessageApi(event.error, api) };
	return { ...event, partial: rewriteMessageApi(event.partial, api) };
}

function createTerminalMessage(model: Model<Api>, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: aborted ? "aborted" : "error",
		errorMessage: aborted ? "Request was aborted" : error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

async function collectAttempt(
	inner: AssistantMessageEventStream,
	modelApi: Api,
	outer: AssistantMessageEventStream,
	progress: AttemptProgress,
	onActivity?: () => void,
): Promise<AttemptResult> {
	const bufferedEvents: AssistantMessageEvent[] = [];
	let terminalEvent: AssistantMessageEvent | undefined;
	let message: AssistantMessage | undefined;
	let emittedContent = false;

	for await (const rawEvent of inner) {
		onActivity?.();
		const event = rewriteEventApi(rawEvent, modelApi);

		// Hold the terminal event until failover/error normalization is decided.
		// All earlier events stream live once the first content event commits this
		// attempt. Before that point they remain buffered so an auth failure can
		// safely rotate to another key without exposing a partial attempt.
		if (event.type === "done") {
			message = event.message;
			terminalEvent = event;
			continue;
		}
		if (event.type === "error") {
			message = event.error;
			terminalEvent = event;
			continue;
		}

		if (isContentEvent(event)) {
			emittedContent = true;
			if (!progress.committed) {
				progress.committed = true;
				if (progress.forwardingEnabled) {
					for (const bufferedEvent of bufferedEvents) outer.push(bufferedEvent);
				}
				bufferedEvents.length = 0;
			}
		}

		if (progress.committed) {
			if (progress.forwardingEnabled) outer.push(event);
		} else {
			bufferedEvents.push(event);
		}
	}

	message ??= rewriteMessageApi(await inner.result(), modelApi);
	if (terminalEvent) bufferedEvents.push(terminalEvent);
	return { events: bufferedEvents, message, emittedContent };
}

function createIdleTimeout(timeoutMs: number): {
	promise: Promise<"timeout">;
	reset: () => void;
	cancel: () => void;
} {
	let handle: ReturnType<typeof setTimeout> | undefined;
	let active = true;
	let resolveTimeout!: (value: "timeout") => void;
	const promise = new Promise<"timeout">((resolve) => {
		resolveTimeout = resolve;
	});
	const reset = () => {
		if (!active) return;
		if (handle) clearTimeout(handle);
		handle = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
	};
	const cancel = () => {
		active = false;
		if (handle) clearTimeout(handle);
		handle = undefined;
	};
	reset();
	return { promise, reset, cancel };
}

function withApiKeyFailover(
	keys: string[],
	timeoutMs: number,
	maxAttempts: number,
): (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
	let nextStartIndex = 0;

	return (model, context, options) => {
		const outer = createAssistantMessageEventStream();
		const startIndex = nextStartIndex++ % keys.length;

		void (async () => {
			let lastMessage: AssistantMessage | undefined;
			const attempts = Math.min(Math.max(1, maxAttempts), keys.length);

			try {
				for (let attempt = 0; attempt < attempts; attempt++) {
					if (options?.signal?.aborted) break;

					const apiKey = keys[(startIndex + attempt) % keys.length]!;
					const requestModel = { ...model, api: "openai-completions" as const };
					const effectiveTimeoutMs = timeoutMs;
					const timeoutController = new AbortController();
					const onParentAbort = () => timeoutController.abort(options?.signal?.reason);
					if (options?.signal) {
						if (options.signal.aborted) onParentAbort();
						else options.signal.addEventListener("abort", onParentAbort, { once: true });
					}

					const idleTimeout = createIdleTimeout(effectiveTimeoutMs);
					const progress: AttemptProgress = {
						committed: false,
						forwardingEnabled: true,
					};
					const inner = streamSimpleOpenAICompletions(requestModel, context, {
						...options,
						apiKey,
						signal: timeoutController.signal,
						// Treat failover.timeoutMs as an inactivity timeout. The SDK's total
						// request cap stays high so active long-running streams are not cut off.
						timeoutMs: Math.max(effectiveTimeoutMs * 10, 600_000),
						maxRetries: 0,
					});
					const attemptPromise = collectAttempt(
						inner,
						model.api,
						outer,
						progress,
						idleTimeout.reset,
					);
					const outcome = await Promise.race([attemptPromise, idleTimeout.promise]);
					idleTimeout.cancel();
					options?.signal?.removeEventListener("abort", onParentAbort);

					let result: AttemptResult;
					if (outcome === "timeout") {
						// Stop forwarding before aborting: the abandoned inner stream may
						// still emit its own terminal event while the abort propagates.
						progress.forwardingEnabled = false;
						timeoutController.abort(new Error(`Request had no stream activity for ${effectiveTimeoutMs}ms`));
						const message = createTerminalMessage(
							model,
							`Request had no stream activity for ${effectiveTimeoutMs}ms`,
							false,
						);
						result = {
							events: [{ type: "error", reason: "error", error: message }],
							message,
							emittedContent: progress.committed,
						};
						void attemptPromise.catch(() => undefined);
					} else {
						result = outcome;
					}
					lastMessage = result.message;

					// Authentication failures are key-specific, so rotate keys. A stalled
					// generation is normally model/upstream load and retrying the same large
					// prompt with another key only duplicates work and multiplies latency.
					const canRetry =
						isAuthError(result.message) &&
						!result.emittedContent &&
						!options?.signal?.aborted &&
						attempt + 1 < attempts;
					if (canRetry) continue;

					// Avoid a timeout-shaped final error here: Pi's outer auto-retry would
					// otherwise submit the entire large-context request again.
					if (isTimeoutError(result.message)) {
						const message: AssistantMessage = {
							...result.message,
							errorMessage: `Generation stalled for ${effectiveTimeoutMs}ms; key rotation skipped because the failure is not key-specific`,
						};
						result = {
							...result,
							message,
							events: [{ type: "error", reason: "error", error: message }],
						};
					}

					for (const event of result.events) outer.push(event);
					outer.end(result.message);
					return;
				}

				const message = lastMessage ?? createTerminalMessage(model, "Request was aborted", true);
				outer.push({ type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message });
				outer.end(message);
			} catch (error) {
				const message = createTerminalMessage(model, error, options?.signal?.aborted === true);
				outer.push({ type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message });
				outer.end(message);
			}
		})();

		return outer;
	};
}

export default function (pi: ExtensionAPI) {
	for (const [providerName, config] of Object.entries(loadProviderConfigs())) {
		if (config.api !== CUSTOM_API) continue;

		let keys: string[];
		try {
			keys = resolveKeys(config);
		} catch (error) {
			console.error(
				`API key failover disabled for ${providerName}: ${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}
		if (keys.length === 0) continue;

		const timeoutMs = Math.max(1_000, Math.floor(config.failover?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
		const maxAttempts = Math.max(1, Math.floor(config.failover?.maxAttempts ?? keys.length));

		pi.registerProvider(providerName, {
			baseUrl: config.baseUrl,
			api: CUSTOM_API,
			models: config.models as any,
			streamSimple: withApiKeyFailover(keys, timeoutMs, maxAttempts),
		});
	}
}
