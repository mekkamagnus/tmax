/**
 * @file man-backend.ts
 * @description SPEC-114 (#181) — the `man`-binary wrapper backend.
 *   Spawns the system `man` to render a page (maximally accurate, fast), then
 *   strips nroff overstrike (backspace bold/underline) to plain text. Used when
 *   the `man` binary is present; the `woman` backend is the zero-dep fallback.
 */

/** Cached availability of the `man` binary (checked once per process). */
let manAvailable: boolean | null = null;

/** True if the system `man` binary runs (checked once, cached). */
export function isManAvailable(): boolean {
  if (manAvailable !== null) return manAvailable;
  try {
    // `man --version` is GNU-only; macOS `man` doesn't support it. `command -v`
    // is a portable existence check across macOS/Linux.
    const r = Bun.spawnSync(["sh", "-c", "command -v man"], { stdout: "ignore", stderr: "ignore" });
    manAvailable = r.exitCode === 0;
  } catch {
    manAvailable = false;
  }
  return manAvailable;
}

/**
 * Strip nroff overstrike encoding to plain text: bold is `c\bc`, underline is
 * `_\bc`. Removes the backspace control chars and the duplicated/underscore
 * glyph, leaving the readable character.
 */
export function stripOverstrike(s: string): string {
  let out = s.replace(/(.)\x08\1/g, "$1"); // bold: c\bc → c
  out = out.replace(/_\x08(.)/g, "$1");     // underline: _\bc → c
  out = out.replace(/(.)\x08/g, "");        // any remaining overstrike → drop prev char
  return out;
}

/**
 * Render TOPIC (optionally in SECTION) via the system `man` binary. Returns the
 * stripped text, or null if `man` fails (caller falls back to `woman`).
 */
export function formatWithMan(topic: string, section?: string): string | null {
  const argv = section ? ["man", section, topic] : ["man", topic];
  // Force a non-interactive pager so `man` writes formatted text to stdout and
  // exits instead of launching `less` (which would hang the spawn).
  const env = { ...process.env, MANPAGER: "cat", PAGER: "cat" };
  try {
    const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", env });
    if (r.exitCode !== 0) return null;
    return stripOverstrike(Buffer.from(r.stdout).toString("utf8"));
  } catch {
    return null;
  }
}
