import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SPILL_PREFIXES = ["pi-bash-", "pi-output-", "pi-mcp-output-", "pi-subagent-", "pi-editor-"];

function configureSafeTemp(): string {
  const base = process.env.PI_TMPDIR?.trim()
    || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "tmp");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  try { chmodSync(base, 0o700); } catch { /* best effort */ }
  process.env.TMPDIR = base;
  process.env.TMP = base;
  process.env.TEMP = base;
  return base;
}

function cleanupOldSpills(base: string): void {
  const cutoff = Date.now() - RETENTION_MS;
  let entries: string[];
  try { entries = readdirSync(base); } catch { return; }
  for (const name of entries) {
    if (!SPILL_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const target = path.join(base, name);
    try {
      if (statSync(target).mtimeMs < cutoff) rmSync(target, { recursive: true, force: true });
    } catch { /* never block Pi startup for cache cleanup */ }
  }
}

export default function (_pi: ExtensionAPI) {
  const base = configureSafeTemp();
  cleanupOldSpills(base);
}
