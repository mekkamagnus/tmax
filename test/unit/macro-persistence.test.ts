/**
 * @file macro-persistence.test.ts
 * @description Tests for macro persistence functionality (US-2.4.2)
 * Macros should persist across tmax restarts via ~/.config/tmax/macros.tlisp
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetMacroRecordingState, getMacros, getMacro, startRecording, stopRecording, recordKey } from "../../src/editor/api/macro-recording.ts";
import { saveMacrosToFile, loadMacrosFromFile, getMacrosFilePath } from "../../src/editor/api/macro-persistence.ts";

// Save original HOME env var
const originalHome = process.env.HOME;

describe("Macro Persistence (US-2.4.2)", () => {
  let mockFs: MockFileSystem;

  beforeEach(() => {
    // Set HOME to test directory
    process.env.HOME = "/Users/test";

    // Reset macro state before each test
    resetMacroRecordingState();

    // Create mock filesystem
    mockFs = new MockFileSystem();

    // Set up default directories
    mockFs.setDirectory("/Users/test/.config/tmax");
  });

  afterEach(() => {
    // Clean up after each test
    resetMacroRecordingState();
    // Restore original HOME
    process.env.HOME = originalHome;
  });

  describe("getMacrosFilePath", () => {
    test("returns correct path for macros.tlisp", () => {
      const path = getMacrosFilePath();
      expect(path).toBe("/Users/test/.config/tmax/macros.tlisp");
    });
  });

  describe("saveMacrosToFile", () => {
    test("saves recorded macros to file", async () => {
      // Record a macro
      startRecording("a");
      recordKey("i");
      recordKey("H");
      recordKey("e");
      recordKey("l");
      recordKey("l");
      recordKey("o");
      recordKey("Escape");
      stopRecording();

      // Record another macro
      startRecording("b");
      recordKey("i");
      recordKey("W");
      recordKey("o");
      recordKey("r");
      recordKey("l");
      recordKey("d");
      recordKey("Escape");
      stopRecording();

      // Save to file
      const result = await saveMacrosToFile(mockFs);
      expect(result).toBe(true);

      // Check file was created
      const fileContent = mockFs.getFile("/Users/test/.config/tmax/macros.tlisp");
      expect(fileContent).toBeDefined();

      // Check content format - should be T-Lisp code
      expect(fileContent).toContain("defmacro");
      expect(fileContent).toContain("macro-a");
      expect(fileContent).toContain("macro-b");
    });

    test("saves macro keys as T-Lisp code", async () => {
      // Record a macro with specific keys
      startRecording("x");
      recordKey("i");
      recordKey("T");
      recordKey("e");
      recordKey("x");
      recordKey("t");
      recordKey("Escape");
      stopRecording();

      // Save to file
      const result = await saveMacrosToFile(mockFs);
      expect(result).toBe(true);

      // Check file contains proper T-Lisp macro definition
      const fileContent = mockFs.getFile("/Users/test/.config/tmax/macros.tlisp");
      expect(fileContent).toContain("(defmacro macro-x");
      expect(fileContent).toContain("'");
      expect(fileContent).toContain("\"i\"");
      expect(fileContent).toContain("\"T\"");
      expect(fileContent).toContain("\"Escape\"");
    });

    test("creates directory if it doesn't exist", async () => {
      // Remove the directory
      mockFs.setDirectory("/Users/test/.config");

      // Record a macro
      startRecording("c");
      recordKey("i");
      recordKey("T");
      recordKey("e");
      recordKey("s");
      recordKey("t");
      recordKey("Escape");
      stopRecording();

      // Save should create directory
      const result = await saveMacrosToFile(mockFs);
      expect(result).toBe(true);

      // Check directory was created
      const dirExists = await mockFs.exists("/Users/test/.config/tmax");
      expect(dirExists).toBe(true);
    });

    test("overwrites existing file", async () => {
      // Create existing file with old content
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", ";; Old macros");

      // Record new macro
      startRecording("d");
      recordKey("i");
      recordKey("N");
      recordKey("e");
      recordKey("w");
      recordKey("Escape");
      stopRecording();

      // Save should overwrite
      const result = await saveMacrosToFile(mockFs);
      expect(result).toBe(true);

      // Check file was overwritten
      const fileContent = mockFs.getFile("/Users/test/.config/tmax/macros.tlisp");
      expect(fileContent).toContain("defmacro");
      expect(fileContent).not.toContain("Old macros");
    });

    test("handles empty macros gracefully", async () => {
      // Don't record any macros

      // Save should handle empty state
      const result = await saveMacrosToFile(mockFs);
      expect(result).toBe(true);

      // Check file was created with empty content
      const fileContent = mockFs.getFile("/Users/test/.config/tmax/macros.tlisp");
      expect(fileContent).toBeDefined();
    });
  });

  describe("loadMacrosFromFile", () => {
    test("loads macros from file", async () => {
      // Create a macros file in the format that saveMacrosToFile generates
      const macroFileContent = `;; tmax macros file
;; Auto-generated from recorded macros

(defmacro macro-a
  '("i" "H" "e" "l" "l" "o" "Escape"))

(defmacro macro-b
  '("i" "W" "o" "r" "l" "d" "Escape"))
`;
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", macroFileContent);

      // Load macros
      const result = await loadMacrosFromFile(mockFs);
      expect(result).toBe(true);

      // Check macros were loaded
      const macroA = getMacro("a");
      const macroB = getMacro("b");

      expect(macroA._tag).toBe("Right");
      expect(macroB._tag).toBe("Right");

      if (macroA._tag === "Right" && macroB._tag === "Right") {
        expect(macroA.right).toEqual(["i", "H", "e", "l", "l", "o", "Escape"]);
        expect(macroB.right).toEqual(["i", "W", "o", "r", "l", "d", "Escape"]);
      }
    });

    test("returns false when file doesn't exist", async () => {
      // Don't create the file

      // Load should return false (no error, just no file)
      const result = await loadMacrosFromFile(mockFs);
      expect(result).toBe(false);
    });

    test("handles malformed T-Lisp gracefully", async () => {
      // Create file with invalid T-Lisp (missing closing paren on next line)
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", "(defmacro macro-a 'broken");

      // Load should handle error gracefully by skipping malformed entries
      const result = await loadMacrosFromFile(mockFs);
      expect(result).toBe(true); // Returns true because file was read successfully

      // Macros should be empty since the entry was malformed
      const macros = getMacros();
      expect(macros.size).toBe(0);
    });

    test("appends to existing macros in memory", async () => {
      // Record a macro in memory
      startRecording("x");
      recordKey("i");
      recordKey("M");
      recordKey("e");
      recordKey("m");
      recordKey("Escape");
      stopRecording();

      // Create file with another macro in the correct format
      const macroFileContent = `(defmacro macro-a
  '("i" "H" "e" "l" "l" "o" "Escape"))`;
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", macroFileContent);

      // Load macros
      const result = await loadMacrosFromFile(mockFs);
      expect(result).toBe(true);

      // Check both macros exist
      const macroA = getMacro("a");
      const macroX = getMacro("x");

      expect(macroA._tag).toBe("Right");
      expect(macroX._tag).toBe("Right");

      if (macroA._tag === "Right" && macroX._tag === "Right") {
        expect(macroA.right).toEqual(["i", "H", "e", "l", "l", "o", "Escape"]);
        expect(macroX.right).toEqual(["i", "M", "e", "m", "Escape"]);
      }
    });

    test("handles comments and whitespace in file", async () => {
      // Create file with comments and formatting
      // Note: Register names must be single characters (a-z or 0-9)
      const macroFileContent = `
;; My custom macros
;; Generated on 2024-02-03

(defmacro macro-t
  '("i" "T" "e" "s" "t" "Escape"))

;; Another comment
(defmacro macro-d
  '("i" "D" "e" "m" "o" "Escape"))
`;
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", macroFileContent);

      // Load macros
      const result = await loadMacrosFromFile(mockFs);
      expect(result).toBe(true);

      // Check macros were loaded
      const macroT = getMacro("t");
      const macroD = getMacro("d");

      expect(macroT._tag).toBe("Right");
      expect(macroD._tag).toBe("Right");

      if (macroT._tag === "Right" && macroD._tag === "Right") {
        expect(macroT.right).toEqual(["i", "T", "e", "s", "t", "Escape"]);
        expect(macroD.right).toEqual(["i", "D", "e", "m", "o", "Escape"]);
      }
    });
  });

  describe("Round-trip persistence", () => {
    test("macros persist through save/load cycle", async () => {
      // Record multiple macros
      startRecording("a");
      recordKey("i");
      recordKey("O");
      recordKey("n");
      recordKey("e");
      recordKey("Escape");
      stopRecording();

      startRecording("b");
      recordKey("i");
      recordKey("T");
      recordKey("w");
      recordKey("o");
      recordKey("Escape");
      stopRecording();

      startRecording("c");
      recordKey("i");
      recordKey("T");
      recordKey("h");
      recordKey("r");
      recordKey("e");
      recordKey("e");
      recordKey("Escape");
      stopRecording();

      // Save to file
      const saveResult = await saveMacrosToFile(mockFs);
      expect(saveResult).toBe(true);

      // Clear macro state
      resetMacroRecordingState();

      // Verify macros are cleared
      const macrosBeforeLoad = getMacros();
      expect(macrosBeforeLoad.size).toBe(0);

      // Load from file
      const loadResult = await loadMacrosFromFile(mockFs);
      expect(loadResult).toBe(true);

      // Verify all macros were restored
      const macroA = getMacro("a");
      const macroB = getMacro("b");
      const macroC = getMacro("c");

      expect(macroA._tag).toBe("Right");
      expect(macroB._tag).toBe("Right");
      expect(macroC._tag).toBe("Right");

      if (macroA._tag === "Right" && macroB._tag === "Right" && macroC._tag === "Right") {
        expect(macroA.right).toEqual(["i", "O", "n", "e", "Escape"]);
        expect(macroB.right).toEqual(["i", "T", "w", "o", "Escape"]);
        expect(macroC.right).toEqual(["i", "T", "h", "r", "e", "e", "Escape"]);
      }
    });

    test("edited file updates loaded macros", async () => {
      // Create initial file with one macro
      const initialContent = `(defmacro macro-a
  '("i" "O" "r" "i" "g" "i" "n" "a" "l" "Escape"))`;
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", initialContent);

      // Load macros
      await loadMacrosFromFile(mockFs);

      // Verify original macro
      const macroA = getMacro("a");
      expect(macroA._tag).toBe("Right");
      if (macroA._tag === "Right") {
        expect(macroA.right).toEqual(["i", "O", "r", "i", "g", "i", "n", "a", "l", "Escape"]);
      }

      // Edit the file (simulate user editing)
      const editedContent = `(defmacro macro-a
  '("i" "M" "o" "d" "i" "f" "i" "e" "d" "Escape"))`;
      mockFs.setFile("/Users/test/.config/tmax/macros.tlisp", editedContent);

      // Clear and reload
      resetMacroRecordingState();
      await loadMacrosFromFile(mockFs);

      // Verify macro was updated
      const macroANew = getMacro("a");
      expect(macroANew._tag).toBe("Right");
      if (macroANew._tag === "Right") {
        expect(macroANew.right).toEqual(["i", "M", "o", "d", "i", "f", "i", "e", "d", "Escape"]);
      }
    });
  });

  describe("Edge cases", () => {
    test("handles special characters in macro keys", async () => {
      // Record macro with special keys
      startRecording("z");
      recordKey("i");
      recordKey("C-v");  // Ctrl+v
      recordKey("Escape");
      recordKey("M-x");  // Meta+x
      recordKey("Enter");
      recordKey("Escape");
      stopRecording();

      // Save and load
      await saveMacrosToFile(mockFs);
      resetMacroRecordingState();
      await loadMacrosFromFile(mockFs);

      // Verify special keys were preserved
      const macroZ = getMacro("z");
      expect(macroZ._tag).toBe("Right");
      if (macroZ._tag === "Right") {
        expect(macroZ.right).toContain("C-v");
        expect(macroZ.right).toContain("M-x");
        expect(macroZ.right).toContain("Enter");
      }
    });

    test("handles very long macros", async () => {
      // Record a macro with many keys
      startRecording("l");
      for (let i = 0; i < 100; i++) {
        recordKey("i");
        recordKey("x");
        recordKey("Escape");
      }
      stopRecording();

      // Save and load
      await saveMacrosToFile(mockFs);
      resetMacroRecordingState();
      await loadMacrosFromFile(mockFs);

      // Verify all keys were preserved
      const macroL = getMacro("l");
      expect(macroL._tag).toBe("Right");
      if (macroL._tag === "Right") {
        expect(macroL.right.length).toBe(300); // 100 * (i + x + Escape)
      }
    });

    test("handles macros with numbers as register names", async () => {
      // Record macros with numeric registers
      startRecording("1");
      recordKey("i");
      recordKey("O");
      recordKey("n");
      recordKey("e");
      recordKey("Escape");
      stopRecording();

      startRecording("9");
      recordKey("i");
      recordKey("N");
      recordKey("i");
      recordKey("n");
      recordKey("e");
      recordKey("Escape");
      stopRecording();

      // Save and load
      await saveMacrosToFile(mockFs);
      resetMacroRecordingState();
      await loadMacrosFromFile(mockFs);

      // Verify numeric register macros were preserved
      const macro1 = getMacro("1");
      const macro9 = getMacro("9");

      expect(macro1._tag).toBe("Right");
      expect(macro9._tag).toBe("Right");

      if (macro1._tag === "Right" && macro9._tag === "Right") {
        expect(macro1.right).toEqual(["i", "O", "n", "e", "Escape"]);
        expect(macro9.right).toEqual(["i", "N", "i", "n", "e", "Escape"]);
      }
    });
  });
});
