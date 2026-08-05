/**
 * latex-render — LaTeX formula rendering for Pi TUI.
 *
 * Zero external dependencies. Hand-written LaTeX → Unicode converter.
 *
 * Inline: $E = mc^2$  →  E = mc²
 * Display: $$ \sum_{i=1}^{n} x_i $$  →  ∑ᵢ₌₁ⁿ xᵢ
 * LaTeX: \( ... \) and \[ ... \]
 *
 * Supports:
 *   Greek letters, sub/superscripts, fractions, sqrt, sum/int limits,
 *   \operatorname, \mathbb, \mathbf, \left/\right, \begin{aligned},
 *   common math symbols.
 */

import type { ExtensionAPI, MessageEndEvent } from "@earendil-works/pi-coding-agent";

// ── Unicode Tables ────────────────────────────────────────────────────────────

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SUPER: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ",
  f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ",
  k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ",
  p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ",
  v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  α: "ᵅ", β: "ᵝ", γ: "ᵞ", δ: "ᵟ", φ: "ᶲ",
};

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ",
  k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ",
  p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ",
  v: "ᵥ", x: "ₓ",
  β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", φ: "ᵩ", χ: "ᵪ",
};

const MATH_FN = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc",
  "sinh", "cosh", "tanh", "coth",
  "arcsin", "arccos", "arctan",
  "log", "ln", "lg", "exp",
  "det", "dim", "ker", "coker",
  "max", "min", "sup", "inf", "lim", "limsup", "liminf",
  "arg", "deg", "gcd", "lcm",
  "Pr", "var", "cov", "corr",
]);

const SYM: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓",
  circ: "∘", bullet: "•", ast: "∗",
  cap: "∩", cup: "∪", wedge: "∧", vee: "∨",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙",
  sum: "∑", prod: "∏", coprod: "∐",
  int: "∫", iint: "∬", iiint: "∭", oint: "∮",
  nabla: "∇", partial: "∂", infty: "∞",
  ell: "ℓ", hbar: "ℏ", prime: "′", angle: "∠",
  triangle: "△", forall: "∀", exists: "∃",
  emptyset: "∅", varnothing: "∅",
  aleph: "ℵ", wp: "℘", im: "ℑ", re: "ℜ",
  le: "≤", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡",
  subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
  in: "∈", notin: "∉", ni: "∋",
  land: "∧", lor: "∨", lnot: "¬", top: "⊤", bot: "⊥",
  therefore: "∴", because: "∵",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉",
  lfloor: "⌊", rfloor: "⌋",
  to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔",
  mapsto: "↦", implies: "⇒", iff: "⇔", gets: "←",
  nearrow: "↗", searrow: "↘", nwarrow: "↖", swarrow: "↙",
  uparrow: "↑", downarrow: "↓",
  Uparrow: "⇑", Downarrow: "⇓",
  quad: "  ", qqquad: "    ",
  lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]",
  colon: ":", neg: "¬",
  mod: " mod ", bmod: " mod ",
  mid: "|", parallel: "∥",
  backslash: "\\", setminus: "\\",
  dagger: "†", ddagger: "‡",
  sharp: "♯", flat: "♭", natural: "♮",
};

// ── Hand-written LaTeX Parser ─────────────────────────────────────────────────

/**
 * Tokenize a LaTeX expression into tokens.
 * Handles: \commands, {braces}, ^ _ sub/superscript markers, letters/digits, operators.
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (expr[i] === "\\") {
      let j = i + 1;
      if (j < expr.length && /[a-zA-Z]/.test(expr[j])) {
        while (j < expr.length && /[a-zA-Z]/.test(expr[j])) j++;
        tokens.push(expr.slice(i, j));
        i = j;
      } else {
        tokens.push(expr.slice(i, i + 2));
        i += 2;
      }
      continue;
    }
    if (expr[i] === "{" || expr[i] === "}") { tokens.push(expr[i]); i++; continue; }
    if (expr[i] === "^" || expr[i] === "_") { tokens.push(expr[i]); i++; continue; }
    if (/[a-zA-Z0-9]/.test(expr[i])) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9]/.test(expr[j])) j++;
      tokens.push(expr.slice(i, j));
      i = j;
      continue;
    }
    tokens.push(expr[i]);
    i++;
  }
  return tokens;
}

/** Convert token to Unicode, consuming from tokens starting at index `start`. */
function parseTokens(tokens: string[], start: number): { result: string; end: number } {
  let result = "";
  let i = start;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok === "}") {
      return { result, end: i };
    }

    if (tok.startsWith("\\")) {
      const cmd = tok.slice(1);
      const r = parseCommand(cmd, tokens, i);
      result += r.result;
      i = r.end;
      continue;
    }

    if (tok === "^") {
      const r = parseSuper(tokens, i);
      result += r.result;
      i = r.end;
      continue;
    }

    if (tok === "_") {
      const r = parseSub(tokens, i);
      result += r.result;
      i = r.end;
      continue;
    }

    if (tok === "{") {
      const inner = parseTokens(tokens, i + 1);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        result += inner.result;
        i = inner.end + 1;
      } else {
        result += "{";
        i++;
      }
      continue;
    }

    // Regular character
    result += tok;
    i++;
  }

  return { result, end: i };
}

function parseCommand(cmd: string, tokens: string[], idx: number): { result: string; end: number } {
  const next = () => idx + 1 < tokens.length ? tokens[idx + 1] : null;
  // Greek letters
  if (GREEK[cmd] !== undefined) return { result: GREEK[cmd], end: idx + 1 };

  // Math symbols
  if (SYM[cmd] !== undefined) return { result: SYM[cmd], end: idx + 1 };

  // Math functions
  if (MATH_FN.has(cmd)) return { result: cmd, end: idx + 1 };

  // Fractions: \frac{a}{b}
  if (cmd === "frac") {
    const num = next() === "{" ? parseTokens(tokens, idx + 2) : { result: next() ?? "", end: idx + 2 };
    let ne = num.end;
    if (ne < tokens.length && tokens[ne] === "}") ne++;
    const den = ne < tokens.length && tokens[ne] === "{"
      ? parseTokens(tokens, ne + 1) : { result: tokens[ne] ?? "", end: ne + 1 };
    let de = den.end;
    if (de < tokens.length && tokens[de] === "}") de++;
    return { result: `${num.result}/${den.result}`, end: de };
  }

  // Square root: \sqrt{x} or \sqrt[n]{x}
  if (cmd === "sqrt") {
    let root = "", after = idx + 1;
    if (next() === "[") {
      const r = parseTokens(tokens, idx + 2);
      if (r.end < tokens.length && tokens[r.end] === "]") {
        root = r.result; after = r.end + 1;
      }
    }
    if (after < tokens.length && tokens[after] === "{") {
      const inner = parseTokens(tokens, after + 1);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        const r = root ? `√[${root}]` : "√";
        return { result: `${r}(${inner.result})`, end: inner.end + 1 };
      }
    }
    return { result: "√", end: after };
  }

  // Text: \text{...}
  if (cmd === "text" && next() === "{") {
    const inner = parseTokens(tokens, idx + 2);
    if (inner.end < tokens.length && tokens[inner.end] === "}") {
      return { result: inner.result, end: inner.end + 1 };
    }
    return { result: "", end: idx + 1 };
  }

  // \operatorname{...}
  if (cmd === "operatorname" && next() === "{") {
    const inner = parseTokens(tokens, idx + 2);
    if (inner.end < tokens.length && tokens[inner.end] === "}") {
      return { result: inner.result, end: inner.end + 1 };
    }
    return { result: "", end: idx + 1 };
  }

  // \mathbb{...}, \mathbf{...}, etc. — just render content
  if (["mathbb", "mathbf", "mathbfit", "mathrm", "mathcal",
       "mathfrak", "mathit", "mathsf", "mathtt", "mathscr"].includes(cmd)) {
    if (next() === "{") {
      const inner = parseTokens(tokens, idx + 2);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        return { result: inner.result, end: inner.end + 1 };
      }
    }
    return { result: "", end: idx + 1 };
  }

  // \left, \right, \bigl, \bigr, etc. — just render the next token
  if (["left", "right", "bigl", "bigr", "biggl", "biggr", "Bigl", "Bigr",
       "Biggl", "Biggr", "big", "Big", "bigg", "Bigg"].includes(cmd)) {
    const nxt = next();
    if (nxt === "{") {
      const inner = parseTokens(tokens, idx + 2);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        return { result: inner.result, end: inner.end + 1 };
      }
    }
    return { result: nxt ?? "", end: idx + 2 };
  }

  // Accents
  if (["hat", "widehat", "bar", "overline", "tilde", "widetilde",
       "dot", "ddot", "vec"].includes(cmd)) {
    if (next() === "{") {
      const inner = parseTokens(tokens, idx + 2);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        return { result: inner.result, end: inner.end + 1 };
      }
    }
    return { result: next() ?? "", end: idx + 2 };
  }

  // Limits: \lim_{x \to 0}
  if (cmd === "lim" || cmd === "limsup" || cmd === "liminf") {
    if (next() === "_") {
      const subR = parseSub(tokens, idx + 1);
      return { result: `${cmd} ${subR.result}`, end: subR.end };
    }
    return { result: cmd, end: idx + 1 };
  }

  // \binom{n}{k}
  if (cmd === "binom" || cmd === "choose") {
    const n0 = next() === "{" ? parseTokens(tokens, idx + 2) : { result: next() ?? "", end: idx + 2 };
    let n0e = n0.end; if (n0e < tokens.length && tokens[n0e] === "}") n0e++;
    const k = n0e < tokens.length && tokens[n0e] === "{"
      ? parseTokens(tokens, n0e + 1) : { result: tokens[n0e] ?? "", end: n0e + 1 };
    let ke = k.end; if (ke < tokens.length && tokens[ke] === "}") ke++;
    return { result: `C(${n0.result},${k.result})`, end: ke };
  }

  // \begin{aligned} ... \end{aligned}
  if (cmd === "begin") {
    // Skip environment name
    let j = idx + 1;
    if (next() === "{") {
      j = idx + 2;
      while (j < tokens.length && tokens[j] !== "}") j++;
      if (j < tokens.length) j++;
    }

    // Parse content until \end{...}
    let content = "", depth = 0;
    while (j < tokens.length) {
      if (tokens[j] === "{") { depth++; j++; continue; }
      if (tokens[j] === "}") {
        if (depth === 0) break;
        depth--; j++; continue;
      }
      if (tokens[j] === "\\\\") { content += "; "; j++; continue; }
      if (tokens[j] === "&") { content += " "; j++; continue; }
      if (tokens[j].startsWith("\\")) {
        if (tokens[j].slice(1) === "end") {
          j++;
          if (j < tokens.length && tokens[j] === "{") {
            while (j < tokens.length && tokens[j] !== "}") j++;
            if (j < tokens.length) j++;
          }
          break;
        }
        const r2 = parseCommand(tokens[j].slice(1), tokens, j);
        content += r2.result;
        j = r2.end;
        continue;
      }
      content += tokens[j];
      j++;
    }
    return { result: content.trim(), end: j };
  }

  if (cmd === "end") {
    // Skip environment name
    let j = idx + 1;
    if (next() === "{") {
      j = idx + 2;
      while (j < tokens.length && tokens[j] !== "}") j++;
      if (j < tokens.length) j++;
    }
    return { result: "", end: j };
  }

  // \overset{above}{base}, \underset{below}{base}
  if (cmd === "overset") {
    if (next() === "{") {
      const over = parseTokens(tokens, idx + 2);
      let oe = over.end; if (oe < tokens.length && tokens[oe] === "}") oe++;
      if (oe < tokens.length && tokens[oe] === "{") {
        const base = parseTokens(tokens, oe + 1);
        if (base.end < tokens.length && tokens[base.end] === "}") {
          return { result: `${base.result}${toSuper(over.result)}`, end: base.end + 1 };
        }
      }
    }
    return { result: "", end: idx + 1 };
  }

  if (cmd === "underset") {
    if (next() === "{") {
      const under = parseTokens(tokens, idx + 2);
      let ue = under.end; if (ue < tokens.length && tokens[ue] === "}") ue++;
      if (ue < tokens.length && tokens[ue] === "{") {
        const base = parseTokens(tokens, ue + 1);
        if (base.end < tokens.length && tokens[base.end] === "}") {
          return { result: `${base.result}${toSub(under.result)}`, end: base.end + 1 };
        }
      }
    }
    return { result: "", end: idx + 1 };
  }

  // \color, \textcolor — skip color arg(s), render the content
  if (cmd === "color" || cmd === "textcolor" || cmd === "textcolorrgb") {
    // First argument is the color name — skip it
    let j = idx + 1;
    if (j < tokens.length && tokens[j] === "{") {
      const inner = parseTokens(tokens, j + 1);
      if (inner.end < tokens.length && tokens[inner.end] === "}") {
        j = inner.end + 1;
        // Parse the remaining content
        return parseTokens(tokens, j);
      }
    }
    return { result: "", end: idx + 1 };
  }

  // Default: unknown command. If it has arguments, show them; otherwise show \cmd.
  if (next() === "{") {
    const inner = parseTokens(tokens, idx + 2);
    if (inner.end < tokens.length && tokens[inner.end] === "}") {
      return { result: inner.result, end: inner.end + 1 };
    }
  }
  return { result: `\\${cmd}`, end: idx + 1 };
}

function parseSuper(tokens: string[], start: number): { result: string; end: number } {
  const i = start + 1;
  if (i >= tokens.length) return { result: "²", end: i };
  if (tokens[i] === "{") {
    const inner = parseTokens(tokens, i + 1);
    if (inner.end < tokens.length && tokens[inner.end] === "}") {
      return { result: toSuper(inner.result), end: inner.end + 1 };
    }
    return { result: "^", end: i + 1 };
  }
  return { result: toSuper(tokens[i]), end: i + 1 };
}

function parseSub(tokens: string[], start: number): { result: string; end: number } {
  const i = start + 1;
  if (i >= tokens.length) return { result: "", end: i };
  if (tokens[i] === "{") {
    const inner = parseTokens(tokens, i + 1);
    if (inner.end < tokens.length && tokens[inner.end] === "}") {
      return { result: toSub(inner.result), end: inner.end + 1 };
    }
    return { result: "_", end: i + 1 };
  }
  return { result: toSub(tokens[i]), end: i + 1 };
}

function toSuper(s: string): string {
  return [...s].map(c => SUPER[c] ?? c).join("");
}
function toSub(s: string): string {
  return [...s].map(c => SUB[c] ?? c).join("");
}

// ── Formula Detection ──────────────────────────────────────────────────────────

/** Inline math $...$ */
const INLINE_RE = /(?:^|[\s([,:;])(\$(?!\$)(\S(?:.*?\S)?)\$)(?=[\s)\],.:;!?]|$)/gm;
/** Display math $$...$$ or \[...\] */
const DISPLAY_RE = /\$\$(.+?)\$\$|\\\[(.+?)\\\]/gs;
/** Inline \(...\) */
const PAREN_INLINE_RE = /\\\((.+?)\\\)/gs;

// ── Main Converter ────────────────────────────────────────────────────────────

function toUnicode(expr: string): string {
  try {
    const tokens = tokenize(expr);
    return parseTokens(tokens, 0).result;
  } catch {
    return expr;
  }
}

function convertAll(text: string): string {
  if (!text.includes("$") && !text.includes("\\[") && !text.includes("\\(")) return text;

  let r = text;

  // Display math $$...$$ or \[...\]
  r = r.replace(DISPLAY_RE, (_m: string, d1: string | undefined, d2: string | undefined) => {
    return `\n  ${toUnicode((d1 ?? d2 ?? "").trim())}\n`;
  });

  // Inline \(...\)
  r = r.replace(PAREN_INLINE_RE, (_m: string, expr: string) => {
    return toUnicode(expr.trim());
  });

  // Inline $...$
  r = r.replace(INLINE_RE, (_m: string, full: string, content: string) => {
    if (/^\d[\d,.\s]*$/.test(content.trim())) return full;
    return toUnicode(content.trim());
  });

  return r;
}

// ── Extension ──────────────────────────────────────────────────────────────────

export default function latexRender(pi: ExtensionAPI) {
  pi.on("message_end", (event: MessageEndEvent, _ctx) => {
    const msg = event.message;
    let mod = false;
    const cv = (s: string) => { const c = convertAll(s); if (c !== s) mod = true; return c; };

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const nc = msg.content.map((b) => {
        if (b.type === "text") return { ...b, text: cv(b.text) };
        if (b.type === "thinking") return { ...b, thinking: cv(b.thinking) };
        return b;
      });
      if (mod) return { message: { ...msg, content: nc } };
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        const c = convertAll(msg.content);
        if (c !== msg.content) return { message: { ...msg, content: c } };
      } else if (Array.isArray(msg.content)) {
        const nc = msg.content.map((b) => {
          if (b.type === "text") return { ...b, text: cv(b.text) };
          return b;
        });
        if (mod) return { message: { ...msg, content: nc } };
      }
    }

    return;
  });
}
