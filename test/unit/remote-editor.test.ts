import { describe, expect, test } from "bun:test";
import { RemoteEditor } from "../../src/editor/remote-editor.ts";

describe("RemoteEditor response framing", () => {
  test("waits for and processes complete newline-delimited responses", async () => {
    const remote = new RemoteEditor("/tmp/not-used");
    const first = new Promise(resolve => {
      (remote as any).pending.set(1, { resolve, reject: () => undefined });
    });
    const second = new Promise(resolve => {
      (remote as any).pending.set(2, { resolve, reject: () => undefined });
    });

    (remote as any).onData(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"large":"'));
    expect((remote as any).pending.has(1)).toBe(true);

    (remote as any).onData(Buffer.from('value"}}\n{"jsonrpc":"2.0","id":2,"result":"done"}\n'));

    expect(await first).toEqual({ large: "value" });
    expect(await second).toBe("done");
    expect((remote as any).pending.size).toBe(0);
  });
});
