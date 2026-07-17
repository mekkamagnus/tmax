/**
 * @file logging-runtime.ts
 * @description CHORE-44 Change 3 — logging collaborator delegated by `Editor`.
 *
 * Owns the unified `Log` store, the on-disk log path + append persistence, the
 * legacy message-line ring, and the log→buffer rendering/formatting. `Editor`
 * constructs one `LoggingRuntime` and delegates `logMessage` / `logDaemonEvent`
 * / `logProgram` / `flushLog` / `getMessageLog` / `getDaemonLog` /
 * `getUnifiedLog` here, passing `setBuffer` / `updateBufferMetadata` callbacks
 * so buffer side-effects stay with the Editor (AC3.4: no log file formatting in
 * `Editor`). This module does NOT import the concrete `Editor` class (AC3.3).
 */

import { Log, ViewBoundLog } from "../log-store.ts";
import { appendEntry, defaultLogPath, tailLoad } from "../log-persist.ts";
import type { LogEntry, LogCategory } from "../log-entry.ts";
import type { LogLevel } from "../message-log.ts";

export interface LoggingRuntimeDeps {
  /** Write rendered log text into a named (virtual) buffer. */
  setBuffer: (name: string, text: string) => void;
  /** Update a buffer's metadata (e.g. mark unmodified after a log render). */
  updateBufferMetadata: (name: string, meta: { modified: boolean }) => void;
}

type ProgramEntry = Omit<LogEntry, "ts" | "category"> & { ts?: number };

export class LoggingRuntime {
  readonly log = new Log();
  logPath: string;
  private readonly messages: string[] = [];

  constructor(private readonly deps: LoggingRuntimeDeps, logPath?: string) {
    this.logPath = logPath ?? defaultLogPath();
  }

  /** SPEC-055: tail-load prior-session entries so a fresh daemon shows context. */
  loadPrior(): void {
    for (const e of tailLoad(this.logPath, this.log.maxSize)) this.log.log(e);
  }

  /** Log a user-facing message; renders *Messages* and marks it unmodified. */
  logMessage(msg: string, level: LogLevel = "info", command?: string, frameId?: string): void {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    this.messages.push(`[${ts}] ${msg}`);
    const e = this.log.log({ level, category: "editor", text: msg, command, frameId });
    if (e) queueMicrotask(() => appendEntry(this.logPath, e));
    this.deps.setBuffer("*Messages*", this.log.render("messages", { fullDate: true }));
    this.deps.updateBufferMetadata("*Messages*", { modified: false });
  }

  /** Log a daemon lifecycle event; renders *daemon* (SPEC-047). */
  logDaemonEvent(event: string, detail?: string): void {
    const text = detail ? `${event} ${detail}` : event;
    const e = this.log.log({ level: "info", category: "daemon", text });
    if (e) queueMicrotask(() => appendEntry(this.logPath, e));
    this.deps.setBuffer("*daemon*", this.log.render("daemon", { fullDate: true }));
    this.deps.updateBufferMetadata("*daemon*", { modified: false });
  }

  /** Log a program-run event; renders its category buffer + mirrors failures. */
  logProgram(category: "shell" | "process" | "test" | "autosave", entry: ProgramEntry): void {
    const e = this.log.log({ category, ...entry });
    if (e) queueMicrotask(() => appendEntry(this.logPath, e));
    const view = category as "shell" | "process" | "test";
    if (view === "shell" || view === "process" || view === "test") {
      const bufName = view === "shell" ? "*Shell Output*" : view === "process" ? "*Async Output*" : "*Tests*";
      this.deps.setBuffer(bufName, this.log.render(view, { fullDate: true }));
      this.deps.updateBufferMetadata(bufName, { modified: false });
    }
    // Mirrored failures surface in *Messages* automatically (warn/error from any category).
    this.deps.setBuffer("*Messages*", this.log.render("messages", { fullDate: true }));
    this.deps.updateBufferMetadata("*Messages*", { modified: false });
  }

  /** Shutdown hook (append-per-write already persists; reserved for future flush). */
  flushLog(): void {
    // appendEntry is called per-write, so nothing is buffered to flush here.
  }

  getMessageLog(): ViewBoundLog { return new ViewBoundLog(this.log, "messages"); }
  getDaemonLog(): ViewBoundLog { return new ViewBoundLog(this.log, "daemon"); }
  getUnifiedLog(): Log { return this.log; }
}

export type { LogCategory };
