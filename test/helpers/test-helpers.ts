/**
 * @file test-helpers.ts
 * @description Common helper functions for tests
 */

import { MockFileSystem } from "../mocks/filesystem.ts";

/**
 * Binding file paths that need to be loaded for tests
 */
const BINDING_FILES = [
  "src/tlisp/core/bindings/normal.tlisp",
  "src/tlisp/core/bindings/insert.tlisp",
  "src/tlisp/core/bindings/visual.tlisp",
  "src/tlisp/core/bindings/command.tlisp",
];

/**
 * Populates a MockFileSystem with the binding file contents
 * Call this before calling editor.start() in tests
 *
 * @param mockFileSystem - The MockFileSystem to populate
 */
export async function loadBindingFilesIntoMock(
  mockFileSystem: MockFileSystem
): Promise<void> {
  for (const path of BINDING_FILES) {
    try {
      // Use the real filesystem to read the binding file content
      const content = await Bun.file(path).text();
      mockFileSystem.setFile(path, content);
    } catch (error) {
      console.warn(`Failed to load binding file ${path} for test:`, error);
    }
  }
}

/**
 * Sets up an editor with binding files pre-loaded
 * This is useful for tests that call editor.start()
 *
 * @param mockFileSystem - The MockFileSystem to populate
 */
export async function setupEditorWithBindings(
  mockFileSystem: MockFileSystem
): Promise<void> {
  await loadBindingFilesIntoMock(mockFileSystem);
}
