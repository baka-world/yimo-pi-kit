import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INLINE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TITLE_INTERVAL_MS = 100;

function sanitizeDisplayText(text: string): string {
	return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
	const normalized = sanitizeDisplayText(text);
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDuration(startedAt: number | null): string {
	if (!startedAt) return "";
	const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function getProjectName(ctx: ExtensionContext): string {
	return sanitizeDisplayText(path.basename(ctx.cwd)) || "workspace";
}

function getBaseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const session = sanitizeDisplayText(pi.getSessionName() || "");
	const project = getProjectName(ctx);
	return session ? `π · ${session} · ${project}` : `π · ${project}`;
}

function sanitizeOscNotificationText(text: string): string {
	return text
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/;/g, ",")
		.replace(/\s+/g, " ")
		.trim();
}

function sendGhosttyNotification(summary: string, body: string): boolean {
	if (!process.stdout.isTTY) return false;
	if (process.env.TERM_PROGRAM !== "ghostty" && !process.env.TERM?.includes("ghostty")) return false;

	const title = sanitizeOscNotificationText(summary);
	const detail = sanitizeOscNotificationText(body);
	// Ghostty associates OSC 777 notifications with the originating surface. Clicking
	// the notification therefore focuses the exact window/tab/split instead of merely
	// activating the Ghostty application.
	process.stdout.write(`\u001b]777;notify;${title};${detail}\u0007`);
	return true;
}

function sendDesktopNotification(summary: string, body: string, urgency: "normal" | "critical"): void {
	// Only the interactive parent process should notify. RPC/JSON subagents have piped stdout.
	if (!process.stdout.isTTY || process.platform !== "linux") return;

	// Prefer the terminal-native notification protocol because it preserves the
	// originating Ghostty surface and can return directly to its tab when clicked.
	if (sendGhosttyNotification(summary, body)) return;

	try {
		const child = spawn(
			"notify-send",
			[
				"--app-name=pi",
				`--urgency=${urgency}`,
				"--expire-time=8000",
				summary,
				body,
			],
			{
				detached: true,
				stdio: "ignore",
			},
		);
		child.unref();
	} catch {
		// Desktop notifications are best-effort; the in-TUI notification still fires.
	}
}

export default function (pi: ExtensionAPI) {
	let titleTimer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;
	let startedAt: number | null = null;
	let currentTask = "Task";
	let lastStopReason: string | undefined;
	let lastError: string | undefined;

	const stopTitleAnimation = (ctx: ExtensionContext, finalMarker?: string) => {
		if (titleTimer) {
			clearInterval(titleTimer);
			titleTimer = null;
		}
		frameIndex = 0;
		const baseTitle = getBaseTitle(pi, ctx);
		ctx.ui.setTitle(finalMarker ? `${finalMarker} ${baseTitle}` : baseTitle);
	};

	const startTitleAnimation = (ctx: ExtensionContext) => {
		stopTitleAnimation(ctx);
		const update = () => {
			const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]!;
			const project = getProjectName(ctx);
			const session = pi.getSessionName();
			const label = session ? `${session} · ${project}` : project;
			ctx.ui.setTitle(`${frame} Working · ${label}`);
			ctx.ui.setStatus(
				"task-progress",
				ctx.ui.theme.fg("accent", frame) + ctx.ui.theme.fg("dim", ` Working · ${truncate(currentTask, 42)}`),
			);
			frameIndex++;
		};
		update();
		titleTimer = setInterval(update, TITLE_INTERVAL_MS);
	};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWorkingIndicator({
			frames: INLINE_FRAMES.map((frame) => ctx.ui.theme.fg("accent", frame)),
			intervalMs: TITLE_INTERVAL_MS,
		});
		ctx.ui.setTitle(getBaseTitle(pi, ctx));
		ctx.ui.setStatus("task-progress", ctx.ui.theme.fg("dim", "Ready"));
	});

	pi.on("before_agent_start", (event) => {
		currentTask = truncate(event.prompt || "Task", 100);
		startedAt = Date.now();
		lastStopReason = undefined;
		lastError = undefined;
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!startedAt) startedAt = Date.now();
		startTitleAnimation(ctx);
	});

	pi.on("agent_end", (event) => {
		for (let index = event.messages.length - 1; index >= 0; index--) {
			const message: any = event.messages[index];
			if (message?.role !== "assistant") continue;
			lastStopReason = message.stopReason;
			lastError = message.errorMessage;
			break;
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		// Do not emit desktop/TUI completion notifications from RPC/JSON child agents.
		if (ctx.mode !== "tui") {
			stopTitleAnimation(ctx);
			startedAt = null;
			return;
		}
		const failed = lastStopReason === "error" || lastStopReason === "aborted" || Boolean(lastError);
		const duration = formatDuration(startedAt);
		const marker = failed ? "✗" : "✓";
		const summary = failed ? "Pi task needs attention" : "Pi task complete";
		const taskLabel = truncate(currentTask, 120);
		const detail = [taskLabel, duration ? `Completed in ${duration}` : "", lastError ? truncate(lastError, 180) : ""]
			.filter(Boolean)
			.join("\n");

		stopTitleAnimation(ctx, marker);
		ctx.ui.setStatus(
			"task-progress",
			ctx.ui.theme.fg(failed ? "error" : "success", marker) +
				ctx.ui.theme.fg("dim", ` ${failed ? "Needs attention" : "Complete"}${duration ? ` · ${duration}` : ""}`),
		);
		ctx.ui.notify(`${summary}${duration ? ` (${duration})` : ""}`, failed ? "error" : "info");
		sendDesktopNotification(summary, detail, failed ? "critical" : "normal");

		// Audible terminal fallback for environments where desktop notifications are unavailable.
		if (process.stdout.isTTY) process.stdout.write("\u0007");
		startedAt = null;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopTitleAnimation(ctx);
		ctx.ui.setStatus("task-progress", undefined);
		ctx.ui.setWorkingIndicator();
	});
}
