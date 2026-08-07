/**
 * Worklog Extension — 跨项目工作日志（使用 Pi compaction 机制）
 *
 * 用法:
 *   /worklog                    → 今天的工作日志
 *   /worklog yesterday          → 昨天
 *   /worklog 2026-07-13         → 指定日期
 *   /worklog 2026-07-11..2026-07-13 → 日期区间
 *
 * 实现思路:
 *   1. SessionManager.listAll() 获取全部会话
 *   2. 按活动时间筛选目标日期范围的会话
 *   3. 读取会话条目，只保留 user/assistant 消息，丢弃工具调用结果
 *   4. 利用 LLM 将每个会话压缩为一句工作描述（类似 compaction）
 *   5. 汇总所有描述，发送给 LLM 生成最终工作日志
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai/compat";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

interface RawEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: { input?: number; output?: number; cost?: { total?: number } };
  };
}

interface SessionDigest {
  project: string;
  sessionId: string;
  timeStart: string;
  timeEnd: string;
  durationMin: number;
  messages: { role: string; text: string }[];
  tokens: number;
  cost: number;
}

// ─── 日期 ──────────────────────────────────────────────────────────────────

function fmtLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function localDateFromIso(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : fmtLocalDate(d);
}

function parseDateArg(input: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const s = (input || "").trim();
  if (!s || s === "today") return { start: today, end: new Date(today.getTime() + 86400000), label: "今天" };
  if (s === "yesterday") {
    const yd = new Date(today.getTime() - 86400000);
    return { start: yd, end: today, label: "昨天" };
  }
  const range = s.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const a = new Date(range[1] + "T00:00:00");
    const lastDay = new Date(range[2] + "T00:00:00");
    const b = new Date(lastDay.getTime() + 86400000);
    return { start: a, end: b, label: `${range[1]} ~ ${range[2]}` };
  }
  const single = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (single) {
    const d = new Date(single[1] + "T00:00:00");
    return { start: d, end: new Date(d.getTime() + 86400000), label: single[1] };
  }
  return { start: today, end: new Date(today.getTime() + 86400000), label: "今天" };
}

// ─── 文本提取 ──────────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

// ─── 会话摘要提取 ──────────────────────────────────────────────────────────

function parseSessionDigest(filePath: string, range: { start: Date; end: Date }): SessionDigest | null {
  let raw: string;
  try { raw = readFileSync(filePath, "utf8"); } catch { return null; }

  const lines = raw.split("\n");
  const entries: RawEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip */ }
  }
  if (entries.length === 0 || entries[0].type !== "session") return null;

  const header = entries[0] as any;
  const cwd: string = header.cwd || "";

  // 筛选目标日期范围内的消息
  const ranged: RawEntry[] = [];
  let tokens = 0, cost = 0;

  for (const e of entries) {
    if (e.type !== "message" || !e.timestamp) continue;
    const ld = localDateFromIso(e.timestamp);
    if (!ld) continue;
    const d = new Date(ld + "T00:00:00");
    if (d < range.start || d >= range.end) continue;
    ranged.push(e);
    if (e.message?.usage) {
      tokens += (e.message.usage.input || 0) + (e.message.usage.output || 0);
      cost += e.message.usage.cost?.total || 0;
    }
  }

  if (ranged.length === 0) return null;

  // 只保留 user 和 assistant 消息，丢弃工具调用结果
  const messages: { role: string; text: string }[] = [];
  for (const e of ranged) {
    const msg = e.message;
    if (!msg) continue;
    if (msg.role === "user") {
      const text = extractText(msg.content).trim();
      if (text) messages.push({ role: "user", text: text.slice(0, 200) });
    } else if (msg.role === "assistant") {
      // 只保留文本内容，忽略 toolCall
      const text = extractText(msg.content).trim();
      if (text) messages.push({ role: "assistant", text: text.slice(0, 300) });
    }
    // 跳过 toolResult、bashExecution 等
  }

  if (messages.length === 0) return null;

  const times = ranged.map(e => e.timestamp!).filter(Boolean).sort();
  const duration = times.length >= 2
    ? Math.round((new Date(times[times.length - 1]).getTime() - new Date(times[0]).getTime()) / 60000)
    : 0;

  return {
    project: basename(cwd) || cwd,
    sessionId: header.id?.slice(0, 8) || "",
    timeStart: fmtLocalTime(times[0]),
    timeEnd: fmtLocalTime(times[times.length - 1]),
    durationMin: duration,
    messages,
    tokens,
    cost,
  };
}

// ─── LLM 压缩单个会话为一句描述 ────────────────────────────────────────────

function compactHeaders(headers: Record<string, string | null> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== null) output[key] = value;
  }
  return output;
}

async function compressSession(
  digest: SessionDigest,
  model: any,
  apiKey: string,
  headers: Record<string, string> | undefined,
  env: Record<string, string> | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  const conversation = digest.messages
    .map(m => `[${m.role === "user" ? "用户" : "助手"}]: ${m.text}`)
    .join("\n");

  // 判断是否跨天片段：第一条消息是"继续"类说明是承接前一天
  const firstUserMsg = digest.messages.find(m => m.role === "user")?.text || "";
  const isContinuation = /^(继续|接着|下一步|go on|continue)\b/i.test(firstUserMsg);
  const contextHint = isContinuation
    ? "注意：这是承接前一天的延续会话，用户首条消息为「继续」，请从助手回复中推断本日实际工作内容。"
    : "";

  const prompt = `将以下AI编程会话压缩为一句15字内中文工作描述（只输出描述本身）：\n项目: ${digest.project}\n时长: ${digest.durationMin}分钟\n${contextHint}\n${conversation.slice(0, 3000)}\n\n工作描述:`;

  try {
    const resp = await complete(
      model,
      {
        messages: [{
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        }],
      },
      {
        apiKey,
        headers,
        env,
        maxTokens: 100,
        signal,
      },
    );

    const text = resp.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map(c => c.text)
      .join("")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

// ─── 扩展入口 ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("worklog", {
    description: "生成工作日志 (/worklog [today|yesterday|日期|日期..日期])",
    handler: async (args, ctx) => {
      const range = parseDateArg(args || "");

      if (!ctx.hasUI) {
        ctx.ui.notify("为避免静默读取并发送跨项目会话内容，/worklog 仅支持交互模式", "warning");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "生成跨项目工作日志？",
        `将读取 ${range.label} 的 Pi 会话摘要，并把最多 50 个候选会话的截断文本发送给当前模型进行压缩。请确认当前模型和网关适合处理这些内容。`,
      );
      if (!confirmed) return;

      // ── 1. 扫描会话 ──
      ctx.ui.setStatus("worklog", `扫描 ${range.label} 会话…`);

      const allSessions = await SessionManager.listAll();
      const candidates = allSessions.filter(
        s => s.modified.getTime() >= range.start.getTime()
      );
      candidates.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      const digests: SessionDigest[] = [];
      const seen = new Set<string>();

      for (const s of candidates.slice(0, 50)) {
        const d = parseSessionDigest(s.path, range);
        if (!d) continue;
        const key = `${d.project}:${d.messages[0]?.text?.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        digests.push(d);
      }

      ctx.ui.setStatus("worklog", undefined);

      if (digests.length === 0) {
        ctx.ui.notify(`未找到 ${range.label} 的会话记录`, "warning");
        return;
      }

      // ── 2. 用 LLM 压缩每个会话 ──
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("没有可用的模型", "error");
        return;
      }

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        ctx.ui.notify("无法获取 API key", "error");
        return;
      }

      ctx.ui.setStatus("worklog", `正在压缩 ${digests.length} 个会话…`);

      const controller = new AbortController();
      const summaries: string[] = [];

      for (let i = 0; i < digests.length; i++) {
        const d = digests[i];
        const summary = await compressSession(
          d, model, auth.apiKey, compactHeaders(auth.headers), auth.env, controller.signal
        );
        if (summary && summary.length >= 4) {
          summaries.push(`${summary}（${d.project}）`);
        } else {
          // fallback: 用第一条用户消息
          const firstUser = d.messages.find(m => m.role === "user");
          const fallback = firstUser?.text?.slice(0, 30) || "无记录";
          summaries.push(`${fallback}（${d.project}）`);
        }
      }

      // ── 3. 组装最终日志（同项目多条保留，不合并）──
      const today = new Date();
      const dateLabel = range.label === "今天"
        ? `${today.getMonth() + 1}.${today.getDate()}`
        : range.label.replace(/~/g, "至");

      ctx.ui.setStatus("worklog", undefined);

      // ── 4. 保存文件 ──
      const logText = [
        `# ${dateLabel}工作日志`,
        ...summaries.map((s, i) => `${i + 1}. ${s}`),
      ].join("\n");

      const safeName = range.label.replace(/[\/\\:\s~]+/g, "-").replace(/-+/g, "-");
      const outPath = join(ctx.cwd || process.cwd(), `worklog-${safeName}.md`);
      if (existsSync(outPath)) {
        const overwrite = await ctx.ui.confirm("覆盖现有工作日志？", outPath);
        if (!overwrite) return;
      }
      writeFileSync(outPath, logText, { encoding: "utf8", mode: 0o600 });
      try { chmodSync(outPath, 0o600); } catch { /* best effort on non-Unix filesystems */ }

      ctx.ui.notify(`💾 ${outPath}`, "info");

      ctx.ui.notify(
        `已提取 ${digests.length} 个会话（${summaries.filter(s => !s.includes("无记录")).length} 个已压缩）`,
        "info",
      );
    },
  });
}
