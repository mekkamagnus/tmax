/**
 * @file woman.ts
 * @description SPEC-114 (#181) — pure-TS nroff/troff renderer ("woman" backend).
 *   Parses man-page *source* and renders the common classic-man AND mdoc macro
 *   subsets to structured plain text. Zero-dependency: needs no `man` binary.
 *
 *   Classic-man: .TH/.SH/.SS/.LP/.PP/.TP/.RS/.RE/.br/.nf/.fi + inline font
 *   macros (.B/.I/.BI/…). mdoc: .Dt/.Sh/.Ss/.Pp/.Nm/.Nd/.Sy/.Fl/.Ar/.Li/.Cm/
 *   .Op/.Dl/.Bd/.Ed/.Bl/.It/.El/.Xr. Font escapes (`\fB` etc.) are consumed;
 *   output is plain text (styling lives in the highlight layer).
 *
 *   Inline macros append to a paragraph buffer (so mdoc's one-macro-per-line
 *   source reflows into sentences); block macros flush it. Targets readability,
 *   not pixel accuracy — uncommon macros fall through best-effort.
 */

/** Special-char escapes `\(xx` → their rendered glyph. */
const SPECIAL_CHARS: Record<string, string> = {
  lq: "“", rq: "”", em: "—", en: "–", bu: "•",
  mi: "-", pl: "+", dg: "°", fm: "'", sq: "'", oq: "‘", cq: "’",
  aa: "´", ga: "`", co: "©", rg: "®", rs: "\\", ti: "~",
  sc: "§", "+-": "±", ">>": "»", "<<": "«",
};

/** Process roff escape sequences; font info discarded (plain text). */
export function processEscapes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { out += s[i] ?? ""; continue; }
    const n = s[i + 1];
    if (n === undefined) { out += "\\"; break; }
    if (n === "f") {
      if (s[i + 2] === "(") i += 4; else i += 2; // \fX or \f(XX — drop
      continue;
    }
    switch (n) {
      case "-": out += "-"; i += 1; continue;
      case "\\": out += "\\"; i += 1; continue;
      case "&": case "|": i += 1; continue;
      case " ": case "0": out += " "; i += 1; continue;
      case "e": out += "\\"; i += 1; continue;
      case "*": i += 2; continue;
      case "(": {
        const tok = s.slice(i + 2, i + 4);
        out += SPECIAL_CHARS[tok] ?? "";
        i += 3; continue;
      }
      default:
        out += n; i += 1; continue;
    }
  }
  return out;
}

/** Classic-man inline font macros whose args render as plain joined text. */
const MAN_INLINE = new Set(["B", "I", "SB", "SM", "BI", "IB", "BR", "RB", "IR", "RI"]);

/**
 * Render the args of an inline mdoc macro as text. `.Fl` prepends `-`;
 * `.Op` wraps in [ ]; `.Xr name (sec)` → `name(sec)`; bare `.Nm` → the default.
 */
function mdocInline(macro: string, args: string[], nmDefault: string): string {
  const a = args.map((x) => processEscapes(x));
  switch (macro) {
    case "Nm": return processEscapes(a.join(" ").trim() || nmDefault);
    case "Nd": return "— " + a.join(" ").trim();
    case "Fl": return a.length ? "-" + a.join(" -") : "-";
    case "Ar": return a.length ? a.join(" ") : "arg";
    case "Op": return "[" + a.join(" ") + "]";
    case "Xr": {
      const name = a[0] ?? "";
      const sec = a[1] ?? "";
      return sec ? `${name}(${sec})` : name;
    }
    case "Px": return "POSIX";
    case "St": return a.join(" ");
    default: return a.join(" ").trim(); // Sy/Em/Li/Cm/Dv/Fa/Va/Vt/Cd/Ad/Pa/Ms/Tn/Fn…
  }
}

/** Render man-page SOURCE to structured plain text (classic-man + mdoc). */
export function formatRoff(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let buf: string[] = [];       // current paragraph fragments
  let indent = 0;
  let nmDefault = "";
  let pendingTag = false;
  let blank = true;

  const flush = (): void => {
    if (buf.length === 0) return;
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (text.length === 0) return;
    if (pendingTag) {
      emit("    " + text);
      pendingTag = false;
    } else {
      emit((indent > 0 ? " ".repeat(indent) : "") + text);
    }
  };
  const emit = (line: string): void => {
    if (line === "") { if (!blank) { out.push(""); blank = true; } return; }
    out.push(line); blank = false;
  };
  const push = (frag: string): void => {
    const f = frag.trim();
    if (f.length > 0) buf.push(f);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith(".\\\"") || line.startsWith("'\\\"")) continue; // comment
    const isControl = line.startsWith(".") || line.startsWith("'");
    if (!isControl) {
      push(processEscapes(line));
      continue;
    }
    const body = line.slice(1);
    const sp = body.search(/\s/);
    const macro = sp < 0 ? body : body.slice(0, sp);
    const rest = sp < 0 ? "" : body.slice(sp + 1);
    const args = rest.length > 0 ? rest.split(/\s+/).filter(Boolean) : [];

    // mdoc inline (append to paragraph buffer) — checked before block macros.
    if (macro === "Nm" || macro === "Nd" || macro === "Sy" || macro === "Em" ||
        macro === "Fl" || macro === "Ar" || macro === "Li" || macro === "Cm" ||
        macro === "Op" || macro === "Pa" || macro === "Fa" || macro === "Va" ||
        macro === "Vt" || macro === "Cd" || macro === "Ad" || macro === "Dv" ||
        macro === "Ms" || macro === "Tn" || macro === "Fn" || macro === "Xr" ||
        macro === "St" || macro === "Px" || macro === "Ic") {
      if (macro === "Nm" && args.length > 0 && !nmDefault) nmDefault = args[0] ?? "";
      push(mdocInline(macro, args, nmDefault));
      continue;
    }
    // classic-man inline font macros.
    if (MAN_INLINE.has(macro)) {
      push(processEscapes(args.join(" ")));
      continue;
    }

    // Block macros — flush the paragraph buffer first.
    switch (macro) {
      case "TH": {
        flush();
        const title = args[0] ?? "";
        const sec = args[1] ?? "";
        nmDefault = title.toLowerCase();
        emit(`${title.toUpperCase()}${sec ? "(" + sec + ")" : ""}`.trim());
        emit("");
        break;
      }
      case "Dt": {
        flush();
        const title = args[0] ?? "";
        const sec = args[1] ?? "";
        nmDefault = title.toLowerCase();
        emit(`${title}${sec ? "(" + sec + ")" : ""}`.trim());
        emit("");
        break;
      }
      case "SH": case "Sh":
        flush(); emit(""); emit(processEscapes(rest).toUpperCase()); emit(""); break;
      case "SS": case "Ss":
        flush(); emit(""); emit(processEscapes(rest)); emit(""); break;
      case "LP": case "PP": case "P": case "Pp":
        flush(); emit(""); break;
      case "TP": case "Tp":
        flush(); pendingTag = true; break;
      case "It":
        flush(); pendingTag = true; push(mdocInline("Op", args, nmDefault)); break;
      case "RS": case "Rs":
        flush(); indent += 4; break;
      case "RE": case "Re":
        flush(); indent = Math.max(0, indent - 4); break;
      case "br": case "sp": case "Bd": case "Ed": case "Bl": case "El": case "BE":
        flush(); emit(""); break;
      case "Dl": case "D1":
        flush(); emit("    " + processEscapes(rest)); break;
      case "nf": case "fi": case "Os": case "Dd":
        break; // tracked loosely / ignored
      case "de": case "ig": {
        flush();
        while (++i < lines.length && !((lines[i] ?? "") === "." || (lines[i] ?? "").startsWith(".."))) { /* skip */ }
        break;
      }
      default:
        // Unknown control macro — best-effort: if it has text args, treat as
        // inline (append); else skip (block).
        if (args.length > 0) push(processEscapes(args.join(" ")));
    }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
