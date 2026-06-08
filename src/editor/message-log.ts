/**
 * @file message-log.ts
 * @description Ring-buffer message log with severity levels for the *Messages* buffer.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MessageEntry {
  timestamp: string;
  level: LogLevel;
  text: string;
  command?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export class MessageLog {
  private entries: MessageEntry[] = [];
  private _maxSize: number = 1000;
  private _minLevel: LogLevel = 'info';

  log(level: LogLevel, text: string, command?: string): void {
    if (this._maxSize === 0) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._minLevel]) return;

    this.entries.push({ timestamp: timestamp(), level, text, command });
    if (this.entries.length > this._maxSize) {
      this.entries.splice(0, this.entries.length - this._maxSize);
    }
  }

  render(): string {
    return this.entries.map(e => {
      const cmd = e.command ? ` [${e.command}]` : '';
      return `[${e.timestamp}] [${e.level}]${cmd} ${e.text}`;
    }).join('\n');
  }

  getEntries(options?: { level?: LogLevel; last?: number }): MessageEntry[] {
    let result = this.entries;
    if (options?.level) {
      const min = LEVEL_ORDER[options.level];
      result = result.filter(e => LEVEL_ORDER[e.level] >= min);
    }
    if (options?.last && options.last < result.length) {
      result = result.slice(-options.last);
    }
    return result;
  }

  clear(): void {
    this.entries = [];
  }

  get maxSize(): number { return this._maxSize; }
  set maxSize(n: number) { this._maxSize = Math.max(0, n); }

  get minLevel(): LogLevel { return this._minLevel; }
  set minLevel(level: LogLevel) { this._minLevel = level; }
}
