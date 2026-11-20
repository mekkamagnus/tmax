import { test } from "bun:test";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

test("SPC leader in major-mode buffers", async () => {
  for (const file of ["x.md", "x.ts", "plain"]) {
    const editor = await createStartedEditor("hello\n");
    if (file !== "plain") {
      await (editor as any).openFile?.(`/tmp/leader-${file}`);
    }
    // force major mode like the TUI would
    const e = editor as any;
    await e.handleKey(" ");
    const s1 = e.getState();
    console.log(`[${file}] after SPACE: whichKey=${s1.whichKeyActive} prefix=${JSON.stringify(s1.whichKeyPrefix)}`);
    await e.handleKey("a");
    const s2 = e.getState();
    console.log(`[${file}] after a: mode=${s2.mode} status=${JSON.stringify(String(s2.statusMessage).slice(0, 40))}`);
  }
});
