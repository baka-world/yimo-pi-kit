import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Compaction status extension.
 *
 * Do not implement summarization here. Pi's built-in compactor already handles:
 * - split turns with separate history and turn-prefix summaries
 * - a dedicated summarization system prompt
 * - previous-summary merging
 * - file-operation tracking
 * - provider errors and empty/error responses
 *
 * Returning undefined from session_before_compact deliberately delegates the
 * operation to that built-in implementation.
 */
export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", (event, ctx) => {
		const model = ctx.model;
		const { preparation, reason } = event;
		const splitTurn = preparation.isSplitTurn ? "，含超长单轮拆分" : "";
		const modelLabel = model ? `${model.provider}/${model.id}` : "当前模型";

		ctx.ui.notify(
			`使用 Pi 内置压缩器：${preparation.tokensBefore.toLocaleString()} tokens${splitTurn}，${modelLabel}（${reason}）`,
			"info",
		);

		return undefined;
	});
}
