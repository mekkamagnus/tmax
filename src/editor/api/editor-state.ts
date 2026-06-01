import type { TerminalIO, FileSystem, FunctionalTextBuffer, LSPDiagnostic, Window } from "../../core/types.ts";

export type EditorMode = "normal" | "insert" | "visual" | "command" | "mx";

export interface EditorStateAccess {
  cursor: {
    getLine(): number;
    setLine(line: number): void;
    getColumn(): number;
    setColumn(column: number): void;
  };
  buffer: {
    getCurrent(): FunctionalTextBuffer | null;
    setCurrent(buffer: FunctionalTextBuffer | null): void;
    getAll(): Map<string, FunctionalTextBuffer>;
  };
  mode: {
    get(): EditorMode;
    set(mode: EditorMode): void;
  };
  status: {
    getMessage(): string;
    setMessage(message: string): void;
  };
  terminal: TerminalIO;
  filesystem: FileSystem;
  commandLine: {
    get(): string;
    set(command: string): void;
  };
  mxCommand: {
    get(): string;
    set(command: string): void;
  };
  spacePressed: {
    get(): boolean;
    set(pressed: boolean): void;
  };
  cursorFocus: {
    get(): 'buffer' | 'command';
    set(focus: 'buffer' | 'command'): void;
  };
  viewportTop: {
    get(): number;
    set(top: number): void;
  };
  lspDiagnostics: {
    get(): LSPDiagnostic[];
    set(diagnostics: LSPDiagnostic[]): void;
  };
  operations?: {
    saveFile(filename?: string): Promise<void>;
    openFile(filename: string): Promise<void>;
  };
  updateVisualSelection?(): void;
}
