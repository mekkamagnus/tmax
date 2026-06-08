/**
 * @file ansi-to-html.ts
 * @description Converts ANSI escape sequences (24-bit, 256-color, attributes) to HTML.
 */

interface StyleState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

// XTERM-256 color cube (6x6x6) + grayscale ramp
const color256: string[] = [];
for (let r = 0; r < 6; r++) {
  for (let g = 0; g < 6; g++) {
    for (let b = 0; b < 6; b++) {
      const toHex = (v: number) => Math.round(v * 255 / 5);
      color256.push(`rgb(${toHex(r)},${toHex(g)},${toHex(b)})`);
    }
  }
}
// Grayscale ramp (232-255)
for (let i = 0; i < 24; i++) {
  const v = Math.round(8 + i * 10);
  color256.push(`rgb(${v},${v},${v})`);
}

function resolve256(index: number): string {
  if (index < 16) {
    // Standard 16 colors — map to reasonable approximations
    const standard16 = [
      "rgb(0,0,0)", "rgb(128,0,0)", "rgb(0,128,0)", "rgb(128,128,0)",
      "rgb(0,0,128)", "rgb(128,0,128)", "rgb(0,128,128)", "rgb(192,192,192)",
      "rgb(128,128,128)", "rgb(255,0,0)", "rgb(0,255,0)", "rgb(255,255,0)",
      "rgb(0,0,255)", "rgb(255,0,255)", "rgb(0,255,255)", "rgb(255,255,255)",
    ];
    return standard16[index] ?? "inherit";
  }
  return color256[index - 16] ?? "inherit";
}

function styleToCss(s: StyleState): string | null {
  const parts: string[] = [];
  if (s.fg) parts.push(`color:${s.fg}`);
  if (s.bg) parts.push(`background:${s.bg}`);
  if (s.bold) parts.push("font-weight:bold");
  if (s.dim) parts.push("opacity:0.6");
  return parts.length > 0 ? parts.join(";") : null;
}

/**
 * Convert a single ANSI-encoded string to HTML with inline styles.
 */
export function ansiToHtml(text: string): string {
  const parts: string[] = [];
  const state: StyleState = { fg: null, bg: null, bold: false, dim: false };
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  function flushOpenSpan(): string {
    const css = styleToCss(state);
    return css ? `<span style="${css}">` : "<span>";
  }

  function closeSpan(): void {
    if (parts.length > 0 && parts[parts.length - 1] !== "") {
      parts.push("</span>");
    }
  }

  parts.push(flushOpenSpan());

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }

    const params = match[1] ? match[1].split(";").map(Number) : [0];

    closeSpan();

    if (params.length === 1 && params[0] === 0) {
      // Reset
      state.fg = null;
      state.bg = null;
      state.bold = false;
      state.dim = false;
    } else if (params.length === 1 && params[0] === 1) {
      state.bold = true;
    } else if (params.length === 1 && params[0] === 2) {
      state.dim = true;
    } else if (params.length === 1 && params[0] === 22) {
      state.bold = false;
      state.dim = false;
    } else if (params.length >= 3 && params[0] === 38 && params[1] === 2) {
      // 24-bit fg: 38;2;R;G;B
      state.fg = `rgb(${params[2]},${params[3]},${params[4]})`;
    } else if (params.length >= 3 && params[0] === 48 && params[1] === 2) {
      // 24-bit bg: 48;2;R;G;B
      state.bg = `rgb(${params[2]},${params[3]},${params[4]})`;
    } else if (params.length >= 3 && params[0] === 38 && params[1] === 5) {
      // 256-color fg
      state.fg = resolve256(params[2] ?? 0);
    } else if (params.length >= 3 && params[0] === 48 && params[1] === 5) {
      // 256-color bg
      state.bg = resolve256(params[2] ?? 0);
    }
    // Other sequences (39 default fg, 49 default bg) — ignore for now

    parts.push(flushOpenSpan());
    lastIndex = ANSI_RE.lastIndex;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }
  closeSpan();

  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert an array of ANSI-encoded lines into a standalone HTML document.
 */
export function ansiLinesToHtmlDocument(lines: string[], width?: number): string {
  const htmlLines = lines.map(l => {
    const html = ansiToHtml(l);
    const stripped = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
    return `      <div style="min-height:1.2em">${stripped.length === 0 ? "&nbsp;" : html}</div>`;
  });
  const body = htmlLines.join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>tmax frame capture</title>
  <style>
    body {
      background: #282c34;
      color: #abb2bf;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.4;
      margin: 0;
      padding: 4px 8px;
      overflow: auto;
    }
    div {
      white-space: pre;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
