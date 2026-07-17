import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";

describe("SPEC-004: legacy TS toggle functions removed", () => {
  test("toggle-line-numbers is no longer a registered primitive", async () => {
    const fixture = await createEditorFixture();
    try {
      const interpreter = fixture.editor.getInterpreter();

      // The old TS toggle should not exist — minor modes replace it
      const result = interpreter.execute("(toggle-line-numbers)");
      expect(result._tag).toBe("Left");
    } finally {
      fixture.dispose();
    }
  });

  test("toggle-relative-line-numbers is no longer a registered primitive", async () => {
    const fixture = await createEditorFixture();
    try {
      const interpreter = fixture.editor.getInterpreter();

      const result = interpreter.execute("(toggle-relative-line-numbers)");
      expect(result._tag).toBe("Left");
    } finally {
      fixture.dispose();
    }
  });

  test("line-numbers-mode minor mode works as replacement", async () => {
    const fixture = await createEditorFixture();
    try {
      const interpreter = fixture.editor.getInterpreter();

      // The minor mode should be available
      const result = interpreter.execute('(minor-mode-active-p "line-numbers")');
      expect(result._tag).toBe("Right");
    } finally {
      fixture.dispose();
    }
  });
});
