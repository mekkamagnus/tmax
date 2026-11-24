import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createEditorAfterFixture, createStartedEditor } from "../helpers/editor-fixture.ts";

test.skipIf(process.env.TMAX_FIXTURE_CHILD !== "1")("fixture child B and direct editor write their log", async () => {
  const editor = await createStartedEditor();
  editor.logMessage("fixture-child-b-marker");
  const direct = createEditorAfterFixture();
  direct.logMessage("fixture-child-direct-marker");
  await Bun.sleep(0);
  const log = readFileSync(process.env.TMAX_LOG_PATH!, "utf8");
  expect(log).toContain("fixture-child-b-marker");
  expect(log).toContain("fixture-child-direct-marker");
});
