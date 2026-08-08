/**
 * Token Speed Extension — 当前对话 tokens 与实时生成速度 (tokens/s)
 *
 * 显示在默认 footer 的扩展状态行（不替换 pi 内置 footer，内置 footer
 * 已展示 ↑输入/↓输出/R缓存/W缓存/$成本/上下文占用）：
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
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

// 与 pi 内置 estimateTokens 的启发式一致（chars/4，偏保守）
const CHARS_PER_TOKEN = 4;
// 速率滑动窗口
const WINDOW_MS = 3000;
// 流式期间的刷新间隔
const TICK_MS = 500;

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
  // ── 实时速率状态 ──
  let streaming = false;
  let window: DeltaSample[] = [];
  let msgStart = 0; // 本条消息开始时间
  let msgChars = 0; // 本条消息累计字符数
  let lastRate = 0; // 最近一次速率（空闲时回看）
  let tick: NodeJS.Timeout | undefined;
  let lastCtx: ExtensionContext | undefined;

  /** 滑动窗口实时速率 (tokens/s)；delta 稀疏时按窗口活跃时长折算 */
  function currentRate(now: number): number {
    if (window.length === 0) return 0;
    const span = Math.max((now - window[0].t) / 1000, 0.3);
    const chars = window.reduce((sum, w) => sum + w.chars, 0);
    return chars / CHARS_PER_TOKEN / span;
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(() => {
      if (streaming && lastCtx) {
        const now = Date.now();
        const rate = currentRate(now);
        if (rate > 0) lastRate = rate;
        lastCtx.ui.setStatus(
          "token-speed",
          lastCtx.ui.theme?.fg("accent", `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`) ??
            `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`,
        );
      }
    }, TICK_MS);
    tick.unref?.();
  }

  function stopTick() {
    if (tick) {
      clearInterval(tick);
      tick = undefined;
    }
  }

  /** 空闲状态：始终显示当前对话累计 tokens（精确 usage）+ 最近一次速率，保证扩展可见 */
  function showTotals(ctx: ExtensionContext) {
    let input = 0;
    let output = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        const usage = (entry.message as AssistantMessage).usage;
        input += usage?.input ?? 0;
        output += usage?.output ?? 0;
      }
    }
    const parts: string[] = [];
    if (lastRate > 0) parts.push(`⚡ ${lastRate.toFixed(1)} t/s`);
    parts.push(`∑ ↑${fmtTokens(input)} ↓${fmtTokens(output)}`);
    ctx.ui.setStatus(
      "token-speed",
      ctx.ui.theme?.fg("dim", parts.join(" · ")) ?? parts.join(" · "),
    );
  }

  // ── 事件 ──

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    streaming = false;
    window = [];
    msgChars = 0;
    lastRate = 0;
    stopTick();
    showTotals(ctx);
  });

  pi.on("message_start", (event, ctx) => {
    lastCtx = ctx;
    if (event.message.role !== "assistant") return;
    msgStart = Date.now();
    msgChars = 0;
    window = [];
    streaming = true;
    startTick();
    ctx.ui.setStatus(
      "token-speed",
      ctx.ui.theme?.fg("accent", `⚡ 0.0 t/s · 本条 ↓0`) ?? `⚡ 0.0 t/s · 本条 ↓0`,
    );
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

    const rate = currentRate(now);
    if (rate > 0) lastRate = rate;
    ctx.ui.setStatus(
      "token-speed",
      ctx.ui.theme?.fg("accent", `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`) ??
        `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`,
    );
  });

  pi.on("message_end", (event, ctx) => {
    lastCtx = ctx;
    if (event.message.role !== "assistant") return;
    streaming = false;
    stopTick();
    window = [];
    // 消息平均速率作为"最近一次速率"（比窗口瞬时值更稳）
    const elapsed = (Date.now() - msgStart) / 1000;
    if (msgChars > 0 && elapsed >= 0.5) {
      lastRate = msgChars / CHARS_PER_TOKEN / elapsed;
    }
    showTotals(ctx);
  });

  // 用户中断 / 异常结束时兜底清理
  pi.on("agent_end", (_event, ctx) => {
    lastCtx = ctx;
    if (streaming) {
      streaming = false;
      stopTick();
      window = [];
      showTotals(ctx);
    }
  });
}
