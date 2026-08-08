/**
 * Token Speed Extension — 当前对话 tokens 与实时生成速度 (tokens/s)
 *
 * 自定义 footer（复刻 pi 默认 footer 的全部内容），token-speed 显示在
 * **右下角**（最右端，模型名右侧）：
 *
 *   流式时:  ... deepseek-v4-flash · ⚡ 42.3 t/s ↓2.1k   ← 实时速率（accent）
 *   空闲时:  ... deepseek-v4-flash · ∑ ↑123.5k ↓2.3k   ← 累计 tokens（dim）
 *
 * 实现要点:
 *   - 实时速度: 监听 message_update 流式 delta（text/thinking/toolcall），
 *     用 chars/4 启发式估算 token 数（与 Pi 内置 estimateTokens 一致），
 *     以 3 秒滑动窗口计算 tokens/s，流式期间每 500ms 刷新一次
 *   - 累计 tokens: 从 session 分支条目汇总 assistant usage（权威值）
 *   - 空闲时保留最近一次速率；空会话显示 ∑ ↑0 ↓0，始终可见
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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

/** 与 pi 默认 footer 一致的紧凑 token 格式化 */
function fmtTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** 与 pi 默认 footer 一致：home 目录缩写为 ~ */
function fmtCwd(cwd: string, home: string): string {
  if (!home) return cwd;
  const rel = cwd.startsWith(home) ? cwd.slice(home.length) : cwd;
  if (rel === cwd) return cwd;
  return rel === "" ? "~" : `~${rel}`;
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

  /** 当前对话累计 tokens（精确 usage） */
  function totals(): { input: number; output: number } {
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
    return { input, output };
  }

  /** token-speed 文本（模型行下方，右对齐）；空闲无速率时返回 null（不占行） */
  function tokenSpeedText(now: number): string | null {
    if (streaming) {
      const rate = currentRate(now);
      if (rate > 0) lastRate = rate;
      return `⚡ ${rate.toFixed(1)} t/s · 本条 ↓${fmtTokens(Math.round(msgChars / CHARS_PER_TOKEN))}`;
    }
    if (lastRate > 0) return `⚡ ${lastRate.toFixed(1)} t/s`;
    return null;
  }

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

  // ── footer 渲染（复刻 pi 默认 footer + 右下角 token-speed）──

  function renderFooter(width: number, theme: any, footerData: any): string[] {
    const ctx = lastCtx;
    const state = ctx?.model;

    // 1. pwd 行：cwd (branch) • session
    const cwd = ctx?.sessionManager.getCwd() ?? ctx?.cwd ?? process.cwd();
    let pwd = fmtCwd(cwd, process.env.HOME || process.env.USERPROFILE || "");
    const branch = footerData.getGitBranch();
    if (branch) pwd = `${pwd} (${branch})`;
    const sessionName = ctx?.sessionManager.getSessionName?.();
    if (sessionName) pwd = `${pwd} • ${sessionName}`;

    // 2. 统计：↑↓R/W/CH%/$/context%
    const usageTotals = totals();
    const statsParts: string[] = [];
    if (usageTotals.input) statsParts.push(`↑${fmtTokens(usageTotals.input)}`);
    if (usageTotals.output) statsParts.push(`↓${fmtTokens(usageTotals.output)}`);
    if (!streaming) {
      // 流式中 usage 未定稿，跳过缓存/成本细节，聚焦速度
      const contextUsage = ctx?.getContextUsage();
      const contextWindow = contextUsage?.contextWindow ?? state?.contextWindow ?? 0;
      const contextPercent = contextUsage?.percent;
      const contextStr =
        contextPercent === undefined || contextPercent === null
          ? `?/${fmtTokens(contextWindow)}`
          : `${contextPercent.toFixed(1)}%/${fmtTokens(contextWindow)}`;
      if (contextPercent !== undefined && contextPercent !== null) {
        statsParts.push(
          contextPercent > 90 ? theme.fg("error", contextStr) : contextPercent > 70 ? theme.fg("warning", contextStr) : contextStr,
        );
      } else if (contextWindow > 0) {
        statsParts.push(contextStr);
      }
    }
    const statsLeft = statsParts.join(" ");

    // 3. 右侧：模型名（token-speed 独立一行，放在模型行下方）
    let modelStr = state?.id || "no-model";
    if (state?.reasoning) {
      const level = ctx?.thinkingLevel || "off";
      modelStr = level === "off" ? `${modelStr} • thinking off` : `${modelStr} • ${level}`;
    }
    const providerCount = footerData.getAvailableProviderCount();
    if (providerCount > 1 && state) {
      modelStr = `(${state.provider}) ${modelStr}`;
    }

    // 布局：statsLeft ... modelStr（pi 默认布局）
    const minPadding = 2;
    const leftWidth = visibleWidth(statsLeft);
    const rightWidth = visibleWidth(modelStr);
    const totalNeeded = leftWidth + minPadding + rightWidth;
    let statsLine;
    if (totalNeeded <= width) {
      const padding = " ".repeat(width - leftWidth - rightWidth);
      statsLine = statsLeft + padding + modelStr;
    } else {
      const availableForRight = width - leftWidth - minPadding;
      if (availableForRight > 0) {
        const truncatedRight = truncateToWidth(modelStr, availableForRight, "");
        const truncatedRightWidth = visibleWidth(truncatedRight);
        const padding = " ".repeat(Math.max(0, width - leftWidth - truncatedRightWidth));
        statsLine = statsLeft + padding + truncatedRight;
      } else {
        statsLine = statsLeft;
      }
    }

    // 4. token-speed 独立行：模型行下方，右对齐（只有速度，tokens 统计左侧已有）
    const tokenStr = tokenSpeedText(Date.now());
    const lines = [
      truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
      theme.fg("dim", statsLine),
    ];
    if (tokenStr !== null) {
      const tokenStyled = streaming
        ? theme.fg("accent", tokenStr)
        : theme.fg("dim", tokenStr);
      const tokenWidth = visibleWidth(tokenStyled);
      lines.push(
        tokenWidth >= width
          ? tokenStyled
          : " ".repeat(width - tokenWidth) + tokenStyled,
      );
    }
    const extensionStatuses: Map<string, string> = footerData.getExtensionStatuses();
    if (extensionStatuses.size > 0) {
      const sorted = Array.from(extensionStatuses.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
      lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
    }
    return lines;
  }

  // ── 事件 ──

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    streaming = false;
    window = [];
    msgChars = 0;
    lastRate = 0;
    stopTick();
    // 隐藏 pi 内置 working loader（输入框上方的 ⠋ Working...），
    // 避免与 footer 速度行重复；compaction/retry 等指示器不受影响
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render: (width: number) => renderFooter(width, theme, footerData),
      };
    });
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
