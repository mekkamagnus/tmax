import { render } from "ink";
import { Duplex } from "stream";
import type { Editor as EditorClass } from "../../../editor/editor.ts";
import type { EditorState } from "../../../core/types.ts";
import type { Frontend } from "../types.ts";
import { Editor } from "./components/Editor.tsx";

function enterFullScreen() {
  const testMode = process.env.TMAX_TEST_MODE === "true";

  if (!testMode) {
    process.stdout.write("\x1b[?1049h");
  }

  process.stdout.write("\x1b[2J");
  process.stdout.write("\x1b[H");
  process.stdout.write("\x1b[?25l");
}

function exitFullScreen() {
  process.stdout.write("\x1b[?25h");

  const testMode = process.env.TMAX_TEST_MODE === "true";
  if (!testMode) {
    process.stdout.write("\x1b[?1049l");
  }
}

function setupCleanupHandlers() {
  const cleanup = () => {
    exitFullScreen();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);
}

export class InkFrontend implements Frontend {
  constructor(private readonly devMode: boolean) {}

  async run(editor: EditorClass, initialState: EditorState, filename?: string): Promise<void> {
    enterFullScreen();
    setupCleanupHandlers();

    const inkOptions: any = {};

    if (this.devMode && !process.stdin.isTTY) {
      const mockStdin = new Duplex({
        read() {},
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      (mockStdin as any).isTTY = true;
      inkOptions.stdin = mockStdin;
    }

    try {
      const { waitUntilExit } = render(
        <Editor
          initialEditorState={initialState}
          editor={editor}
          filename={filename}
          onError={(error: Error) => {
            console.error("Editor error:", error.message);
          }}
        />,
        inkOptions,
      );

      await waitUntilExit();
    } finally {
      exitFullScreen();
    }
  }
}
