import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "auto-context";
const MAX_AUTO_CONTINUES_PER_USER_TURN = 3;

const CONTINUATION_PROMPT = `The context was automatically compacted. Continue the current user task autonomously from the compaction summary and recent messages. Do not restart the task, repeat completed work, or ask the user to say "continue". Execute the next unfinished step using tools when appropriate. If every requested step is already complete, provide only the concise final result and stop.`;

/**
 * Keep long-running tasks moving after Pi performs threshold/overflow compaction.
 *
 * Pi already retries automatically when an overflow aborts a model turn. This
 * extension only queues a continuation when Pi says it will not retry. Manual
 * /compact remains manual and does not unexpectedly start another model turn.
 */
export default function (pi: ExtensionAPI) {
	let enabled = true;
	let autoContinuesSinceUserMessage = 0;
	let lastHandledCompactionId: string | undefined;

	const clearStatus = (ctx: ExtensionContext) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	pi.on("session_start", (_event, ctx) => {
		autoContinuesSinceUserMessage = 0;
		lastHandledCompactionId = undefined;
		clearStatus(ctx);
	});

	// A real user-role message starts a new continuation budget. The extension's
	// own continuation is a hidden custom message, so it does not reset this guard.
	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			autoContinuesSinceUserMessage = 0;
		}
	});

	pi.on("session_compact", (event, ctx) => {
		if (lastHandledCompactionId === event.compactionEntry.id) return;
		lastHandledCompactionId = event.compactionEntry.id;

		// Overflow recovery already has a built-in retry. A manual /compact should
		// also stay idle until the user explicitly asks for more work.
		if (!enabled || event.reason === "manual" || event.willRetry) return;

		// Pi may compact immediately before accepting a newly submitted prompt (for
		// example after an aborted response). In that path the session is idle and
		// the real user prompt will be sent as soon as compaction returns, so starting
		// a second agent run here would race with it.
		if (ctx.isIdle()) {
			if (ctx.hasUI) {
				ctx.ui.notify("上下文已在发送新消息前自动压缩，将继续处理该用户消息", "info");
			}
			return;
		}

		// A queued steering/follow-up user message is already the best continuation.
		if (ctx.hasPendingMessages()) {
			if (ctx.hasUI) {
				ctx.ui.notify("上下文已自动压缩；检测到排队消息，将直接处理该消息", "info");
			}
			return;
		}

		if (autoContinuesSinceUserMessage >= MAX_AUTO_CONTINUES_PER_USER_TURN) {
			ctx.ui.setStatus(STATUS_KEY, "AutoCtx paused");
			if (ctx.hasUI) {
				ctx.ui.notify(
					`自动继续已暂停：同一用户任务已连续触发 ${MAX_AUTO_CONTINUES_PER_USER_TURN} 次压缩，请检查任务状态后再继续`,
					"warning",
				);
			}
			return;
		}

		autoContinuesSinceUserMessage++;
		ctx.ui.setStatus(STATUS_KEY, `AutoCtx continuing ${autoContinuesSinceUserMessage}/${MAX_AUTO_CONTINUES_PER_USER_TURN}`);
		if (ctx.hasUI) {
			ctx.ui.notify("上下文已自动压缩，正在从摘要继续当前任务", "info");
		}

		// session_compact fires while Pi's agent run is still active. Queueing a
		// hidden follow-up here lets Pi continue inside the same run, before it emits
		// agent_settled, and avoids a false intermediate "task complete" signal.
		pi.sendMessage(
			{
				customType: "auto-context-continuation",
				content: CONTINUATION_PROMPT,
				display: false,
				details: {
					compactionId: event.compactionEntry.id,
					reason: event.reason,
					sequence: autoContinuesSinceUserMessage,
				},
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});

	pi.on("agent_settled", (_event, ctx) => {
		clearStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearStatus(ctx);
	});

	pi.registerCommand("auto-context", {
		description: "查看或临时切换压缩后的自动继续 (/auto-context [on|off|status])",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "on") {
				enabled = true;
				autoContinuesSinceUserMessage = 0;
				ctx.ui.notify("压缩后的自动继续已开启", "info");
				return;
			}
			if (action === "off") {
				enabled = false;
				clearStatus(ctx);
				ctx.ui.notify("压缩后的自动继续已关闭（Pi 自动压缩仍保持开启）", "warning");
				return;
			}
			if (action !== "status") {
				ctx.ui.notify("用法：/auto-context [on|off|status]", "warning");
				return;
			}

			ctx.ui.notify(
				`Pi 自动压缩：已通过 settings.json 开启；压缩后自动继续：${enabled ? "开启" : "关闭"}；单个用户任务保护上限：${MAX_AUTO_CONTINUES_PER_USER_TURN} 次`,
				"info",
			);
		},
	});
}
