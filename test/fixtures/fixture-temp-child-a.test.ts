import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

test.skipIf(process.env.TMAX_FIXTURE_CHILD !== "1")("fixture child A writes its log", async () => {
  const editor = await createStartedEditor();
  editor.logMessage("fixture-child-a-marker");
  await Bun.sleep(0);
  expect(readFileSync(process.env.TMAX_LOG_PATH!, "utf8")).toContain("fixture-child-a-marker");
});
