import { defaultSocketPath } from '../core/socket-path.ts';import { Socket } from "net";
import { userInfo } from "os";
import { jsonToEditorState } from "../server/serialize.ts";
import { PROTOCOL_VERSION } from "../server/rpc/types.ts";
import type { EditorState } from "../core/contracts/editor.ts";

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RemoteEditor {
  private socket: Socket | null = null;
  private socketPath: string;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private responseBuffer = "";
  private cachedState!: EditorState;
  /** Last `bufferRevision` seen from the daemon (issue #46). The TUI's 200ms
   *  poll diffs this instead of `JSON.stringify`-ing the whole state — O(1). */
  private _lastBufferRevision = 0;
  private _frameId: string | null = null;
  private _clientId: string | null = null;
  private workspaceId?: string;

  constructor(socketPath?: string, workspaceId?: string) {
    this.socketPath = socketPath || defaultSocketPath();
    this.workspaceId = workspaceId;
  }

  /** The most recent daemon-side buffer revision (issue #46). O(1) change
   *  signal for the TUI poll loop. */
  get lastBufferRevision(): number {
    return this._lastBufferRevision;
  }

  async start(): Promise<void> {
    await this.connect();
    // Register as a new frame
    const frameResult = await this.sendRequest("connect-frame", {
      clientType: "tui",
      clientName: "tmax-tui",
      ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
    });
    this._clientId = frameResult.clientId ?? null;
    this._frameId = frameResult.frameId;
    // Get initial state for our frame
    const stateJson = await this.sendRequest("render-state", { frameId: this._frameId });
    this.applyStateJson(stateJson as Record<string, unknown>);
  }

  get frameId(): string | null {
    return this._frameId;
  }

  get clientId(): string | null {
    return this._clientId;
  }

  /** False once the daemon socket has dropped (close/error) — the TUI checks
   *  this to render a disconnect banner and quit locally instead of freezing.
   *  BUG-36 / #54. */
  get isConnected(): boolean {
    return this.socket !== null;
  }

  async sendEvent(event: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.sendRequest("client-event", {
      event,
      clientId: this._clientId,
      frameId: this._frameId,
      clientType: "tui",
      clientName: "tmax-tui",
      ...params,
    });
  }

  async handleKey(key: string): Promise<EditorState> {
    const json = await this.sendRequest("keypress", { key, frameId: this._frameId });
    if (json.quitSignal) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    this.applyStateJson(json as Record<string, unknown>);
    return this.cachedState;
  }

  getEditorState(): EditorState {
    return this.cachedState;
  }

  async refreshState(): Promise<EditorState> {
    const stateJson = await this.sendRequest("render-state", { frameId: this._frameId });
    this.applyStateJson(stateJson as Record<string, unknown>);
    return this.cachedState;
  }

  /** Build the cached EditorState from a render-state response and record the
   *  daemon-side `bufferRevision` for O(1) poll change detection (issue #46). */
  private applyStateJson(stateJson: Record<string, unknown>): void {
    this.cachedState = jsonToEditorState(stateJson);
    const rev = stateJson.bufferRevision;
    this._lastBufferRevision = typeof rev === "number" ? rev : this._lastBufferRevision;
  }

  updateTerminalSize(_width: number, _height: number): void {
    // No-op for remote — daemon manages its own terminal size
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;
      socket.on("data", (data: Buffer) => this.onData(data));
      // Null the socket on close/error so later sendRequest calls fail FAST via
      // the !this.socket guard (was: wrote to the dead socket and waited 30s).
      // Identity-guard: only null if this is still the active socket, so a stale
      // close/error cannot clobber a newer reconnect. BUG-36 / #54.
      const onLost = (reason: Error): void => {
        if (this.socket === socket) this.socket = null;
        this.rejectAllPending(reason);
      };
      socket.on("close", () => onLost(new Error("Socket closed")));
      socket.on("error", (err) => onLost(err));
      socket.connect(this.socketPath, () => resolve());
      // Reject connect on error before connection established
      socket.once("error", reject);
    });
  }

  private rejectAllPending(reason: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.pending.delete(id);
    }
  }

  private onData(data: Buffer): void {
    this.responseBuffer += data.toString();

    let newline = this.responseBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.responseBuffer.slice(0, newline).trim();
      this.responseBuffer = this.responseBuffer.slice(newline + 1);
      newline = this.responseBuffer.indexOf("\n");
      if (!line) continue;

      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) continue;

        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      } catch {
        // Ignore malformed complete response lines.
      }
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params, protocolVersion: PROTOCOL_VERSION }) + "\n");
    });
  }
}
