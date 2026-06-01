import { Socket } from "net";
import { userInfo } from "os";
import { jsonToEditorState } from "../server/serialize.ts";
import type { EditorState } from "../core/types.ts";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export class RemoteEditor {
  private socket: Socket | null = null;
  private socketPath: string;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private cachedState!: EditorState;
  private _frameId: string | null = null;

  constructor(socketPath?: string) {
    this.socketPath = socketPath || `/tmp/tmax-${userInfo().uid}/server`;
  }

  async start(): Promise<void> {
    await this.connect();
    // Register as a new frame
    const frameResult = await this.sendRequest("connect-frame", {});
    this._frameId = frameResult.frameId;
    // Get initial state for our frame
    const stateJson = await this.sendRequest("render-state", { frameId: this._frameId });
    this.cachedState = jsonToEditorState(stateJson as Record<string, unknown>);
  }

  get frameId(): string | null {
    return this._frameId;
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
      this.socket.connect(this.socketPath, () => resolve());
      this.socket.on("error", reject);
    });
  }

  private onData(data: Buffer): void {
    try {
      const response = JSON.parse(data.toString().trim());
      const pending = this.pending.get(response.id);
      if (pending) {
        this.pending.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // Ignore malformed data
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
}
