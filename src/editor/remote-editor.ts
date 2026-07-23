import { Socket } from "net";
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
  private _frameId: string | null = null;
  private _clientId: string | null = null;
  private workspaceId?: string;

  constructor(socketPath?: string, workspaceId?: string) {
    this.socketPath = socketPath || process.env.TMAX_SOCKET || `/tmp/tmax-${userInfo().uid}/server`;
    this.workspaceId = workspaceId;
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
    this.cachedState = jsonToEditorState(stateJson as Record<string, unknown>);
  }

  get frameId(): string | null {
    return this._frameId;
  }

  get clientId(): string | null {
    return this._clientId;
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
    this.cachedState = jsonToEditorState(json as Record<string, unknown>);
    return this.cachedState;
  }

  getEditorState(): EditorState {
    return this.cachedState;
  }

  async refreshState(): Promise<EditorState> {
    const stateJson = await this.sendRequest("render-state", { frameId: this._frameId });
    this.cachedState = jsonToEditorState(stateJson as Record<string, unknown>);
    return this.cachedState;
  }

  updateTerminalSize(_width: number, _height: number): void {
    // No-op for remote — daemon manages its own terminal size
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.on("data", (data: Buffer) => this.onData(data));
      this.socket.on("close", () => this.rejectAllPending(new Error("Socket closed")));
      this.socket.on("error", (err) => this.rejectAllPending(err));
      this.socket.connect(this.socketPath, () => resolve());
      // Reject connect on error before connection established
      this.socket.once("error", reject);
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
