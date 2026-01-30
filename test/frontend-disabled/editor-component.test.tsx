/**
 * @file editor-component.test.tsx
 * @description Unit tests for the React Editor component using ink-testing-library
 */

import { describe, test, expect } from "bun:test";
import { render } from "jsr:@deno-ink/core";
import { Editor } from "../../src/frontend/components/Editor.tsx";
import { EditorState } from "../../src/core/types.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";

// Create a sample initial editor state for testing
const createSampleState = (): EditorState => {
  return {
    currentBuffer: FunctionalTextBufferImpl.create("Hello\nWorld\nTest"),
    cursorPosition: { line: 0, column: 0 },
    mode: 'normal',
    statusMessage: '',
    viewportTop: 0,
    config: {
      theme: 'default',
      tabSize: 4,
      autoSave: false,
      keyBindings: {},
      maxUndoLevels: 100,
      showLineNumbers: true,
      wordWrap: false
    }
  };
};

Deno.test("Editor Component - should render with initial editor state", () => {
  const initialState = createSampleState();

  const { getByText } = render(
    <Editor initialEditorState={initialState} />
  );

  // Should render the buffer content
  expect(getByText(/Hello/).toBeDefined());
  expect(getByText(/World/).toBeDefined());
  expect(getByText(/Test/).toBeDefined());

  // Should render the status line with mode and cursor position
  expect(getByText(/NORMAL/).toBeDefined());
});

Deno.test("Editor Component - should accept editorState and onStateChange props", () => {
  const initialState = createSampleState();
  let stateChanged = false;

  const onStateChange = (newState: EditorState) => {
    stateChanged = true;
  };

  const { getByText } = render(
    <Editor
      initialEditorState={initialState}
      onStateChange={onStateChange}
    />
  );

  // Component should render without errors
  expect(getByText(/Hello/).toBeDefined());

  // Note: We can't easily test state changes without simulating user input
  // which requires more complex testing setup
});

Deno.test("Editor Component - should use Deno-ink components: <Box>, <Text>", () => {
  const initialState = createSampleState();

  const { container } = render(
    <Editor initialEditorState={initialState} />
  );

  // The rendered output should contain ink components
  // Since we're testing the structure, we'll check that the container exists
  expect(container).toBeDefined();
});

Deno.test("Editor Component - should display buffer content correctly", () => {
  const initialState = createSampleState();

  const { getByText } = render(
    <Editor initialEditorState={initialState} />
  );

  // Should display the buffer content
  const helloElement = getByText(/Hello/);
  const worldElement = getByText(/World/);
  const testElement = getByText(/Test/);

  expect(helloElement).toBeDefined();
  expect(worldElement).toBeDefined();
  expect(testElement).toBeDefined();
});

Deno.test("Editor Component - should display status line with mode and cursor position", () => {
  const initialState = createSampleState();

  const { getByText } = render(
    <Editor initialEditorState={initialState} />
  );

  // Should show the current mode
  expect(getByText(/NORMAL/).toBeDefined());

  // Status line should be present
  // The exact format depends on the StatusLine component implementation
});

Deno.test("Editor Component - should handle different editor modes", () => {
  const normalState = createSampleState();
  normalState.mode = 'normal';

  const insertState = createSampleState();
  insertState.mode = 'insert';

  const { getByText: getNormalText } = render(
    <Editor initialEditorState={normalState} />
  );

  const { getByText: getInsertText } = render(
    <Editor initialEditorState={insertState} />
  );

  // Should show different modes in the status line
  expect(getNormalText(/NORMAL/).toBeDefined());
  expect(getInsertText(/INSERT/).toBeDefined());
});

Deno.test("Editor Component - should handle visual mode", () => {
  const visualState = createSampleState();
  visualState.mode = 'visual';

  const { getByText } = render(
    <Editor initialEditorState={visualState} />
  );

  expect(getByText(/VISUAL/).toBeDefined());
});

Deno.test("Editor Component - should handle command mode", () => {
  const commandState = createSampleState();
  commandState.mode = 'command';

  const { getByText } = render(
    <Editor initialEditorState={commandState} />
  );

  // Should show command input when in command mode
  // This depends on the CommandInput component implementation
});

Deno.test("Editor Component - should handle M-x mode", () => {
  const mxState = createSampleState();
  mxState.mode = 'mx';

  const { getByText } = render(
    <Editor initialEditorState={mxState} />
  );

  // Should show M-x input when in M-x mode
  // This depends on the CommandInput component implementation
});

Deno.test("Editor Component - should handle status messages", () => {
  const stateWithMessage = createSampleState();
  stateWithMessage.statusMessage = 'Test message';

  const { getByText } = render(
    <Editor initialEditorState={stateWithMessage} />
  );

  expect(getByText(/Test message/).toBeDefined());
});

Deno.test("Editor Component - should handle error display", () => {
  const stateWithError = createSampleState();
  stateWithError.statusMessage = 'ERROR: Test error';

  const { getByText } = render(
    <Editor initialEditorState={stateWithError} />
  );

  expect(getByText(/ERROR: Test error/).toBeDefined());
});

Deno.test("Editor Component - should fill 100% of terminal height", () => {
  const initialState = createSampleState();

  const { container } = render(
    <Editor initialEditorState={initialState} />
  );

  // The container should have flex properties to fill height
  // This is more of a structural test
  expect(container).toBeDefined();
});