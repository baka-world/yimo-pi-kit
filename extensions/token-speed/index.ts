/**
 * Token Speed Extension — 当前对话 tokens 与实时生成速度 (tokens/s)
 *
 * 显示在输入框上方的 widget 行（不占用 footer 左下角，不替换 pi 内置 footer）：
 *
 *   流式时:  ⚡ 42.3 t/s · 本条 ↓2.1k     ← 实时速率（accent 高亮）
 *   空闲时:  ∑ ↑123.4k ↓45.6k            ← 当前对话累计 tokens（精确 usage）
 *
 * 实现要点:
 *   - 实时速度: 监听 message_update 流式 delta（text/thinking/toolcall），
 *     用 chars/4 启发式估算 token 数（与 Pi 内置 estimateTokens 一致），
 *     以 3 秒滑动窗口计算 tokens/s，流式期间每 500ms 刷新一次
 *   - 累计 tokens: 从 session 分支条目汇总 assistant usage（权威值）
 *   - 空闲时保留最近一次速率，便于回看本条消息的生成速度
 *   - 始终可见：空会话也显示 ∑ ↑0 ↓0，重启后立即可见
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

// 与 pi 内置 estimateTokens 的启发式一致（chars/4，偏保守）
const CHARS_PER_TOKEN = 4;
// 速率滑动窗口
const WINDOW_MS = 3000;
// 流式期间的刷新间隔
const TICK_MS = 500;
// widget 显示位置：输入框上方
const WIDGET_KEY = "token-speed";

interface DeltaSample {
  t: number;
  chars: number;
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function (pi: ExtensionAPI) {
  // ── 状态 ──
  let streaming = false;
  let window: DeltaSample[] = [];
  let msgStart = 0; // 本条消息开始时间
  let msgChars = 0; // 本条消息累计字符数
  let lastRate = 0; // 最近一次速率（空闲时回看）
  let tick: NodeJS.Timeout | undefined;
  let lastCtx: ExtensionContext | undefined;
  let tuiRef: { requestRender(): void } | undefined;

  /** 滑动窗口实时速率 (tokens/s)；delta 稀疏时按窗口活跃时长折算 */
  function currentRate(now: number): number {
    if (window.length === 0) return 0;
    const span = Math.max((now - window[0].t) / 1000, 0.3);
    const chars = window.reduce((sum, w) => sum + w.chars, 0);
    return chars / CHARS_PER_TOKEN / span;
  }

  /** 计算空闲态显示行 */
  function totalsLine(): string {
    let input = 0;
    let output = 0;
    if (lastCtx) {
      for (const entry of lastCtx.sessionManager.getBranch()) {
        if (entry.type === "message" && entry.message.role === "assistant") {
          const usage = (entry.message as AssistantMessage).usage;
          input += usage?.input ?? 0;
          output += usage?.output ?? 0;
        }
      }
    }
    const parts: string[] = [];
    if (lastRate > 0) parts.push(`⚡ ${lastRate.toFixed(1)} t/s`);
    parts.push(`∑ ↑${fmtTokens(input)} ↓${fmtTokens(output)}`);
    return parts.join(" · ");
  }

  /** 计算流式态显示行 */
  function streamingLine(now: number): string {
    const rate = currentRate(now);
    if (rate > 0) lastRate = rate;
    return `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`;
  }

  /** 触发 TUI 重绘（widget render 会读取最新状态） */
  function refresh() {
    tuiRef?.requestRender();
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(() => {
      if (streaming) refresh();
    }, TICK_MS);
    tick.unref?.();
  }

  function stopTick() {
    if (tick) {
      clearInterval(tick);
      tick = undefined;
    }
  }

  /** 消息结束时：回到累计显示（并保留最近速率） */
  function finishMessage(ctx: ExtensionContext) {
    streaming = false;
    stopTick();
    window = [];
    // 消息平均速率作为"最近一次速率"（比窗口瞬时值更稳）
    const elapsed = (Date.now() - msgStart) / 1000;
    if (msgChars > 0 && elapsed >= 0.5) {
      lastRate = msgChars / CHARS_PER_TOKEN / elapsed;
    }
    lastCtx = ctx;
    refresh();
  }

  // ── 事件 ──

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    streaming = false;
    window = [];
    msgChars = 0;
    lastRate = 0;
    stopTick();
    // 注册 widget（输入框上方），始终可见
    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        tuiRef = tui;
        return {
          render: () => [
            streaming
              ? theme.fg("accent", streamingLine(Date.now()))
              : theme.fg("dim", totalsLine()),
          ],
          invalidate: () => {},
          dispose: () => {
            tuiRef = undefined;
          },
        };
      },
      { placement: "aboveEditor" },
    );
    refresh();
  });

  pi.on("message_start", (event, ctx) => {
    lastCtx = ctx;
    if (event.message.role !== "assistant") return;
    msgStart = Date.now();
    msgChars = 0;
    window = [];
    streaming = true;
    startTick();
    refresh();
  });

  pi.on("message_update", (event, ctx) => {
    lastCtx = ctx;
    const ev = event.assistantMessageEvent;
    if (ev.type !== "text_delta" && ev.type !== "thinking_delta" && ev.type !== "toolcall_delta") {
      return;
    }
    const now = Date.now();
    if (!streaming) {
      msgStart = now;
      streaming = true;
      startTick();
    }
    window.push({ t: now, chars: ev.delta.length });
    msgChars += ev.delta.length;
    // 修剪窗口，控制内存
    const cutoff = now - WINDOW_MS;
    while (window.length > 0 && window[0].t < cutoff) window.shift();
    refresh();
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    finishMessage(ctx);
  });

  // 用户中断 / 异常结束时兜底清理
  pi.on("agent_end", (_event, ctx) => {
    if (streaming) finishMessage(ctx);
  });
}
