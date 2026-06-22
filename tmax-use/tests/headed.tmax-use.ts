/**
 * @file headed.tmax-use.ts
 * @description Integration test for headed (tmux) mode. Verifies the
 *   lifecycle: spawn session → launch TUI → send keys → capture pane →
 *   kill session. Skipped automatically when tmux is not on PATH.
 *
 * Run explicitly:
 *   bin/tmax-use test tmax-use/tests/headed.tmax-use.ts --headed
 */
import { test } from '../test/index.ts';
import { tmuxAvailable, startHeadedSession, killHeadedSession, sendKeys, capturePane, paneDimensions } from '../test/headed.ts';

const skipped = !tmuxAvailable();

test('headed session captures the tmax TUI via tmux capture-pane', async ({ instance, tmpDir }) => {
  if (skipped) {
    // Spec: integration test runs only when tmux is present.
    return;
  }
  const socketPath = (instance as unknown as { deps?: { socketPath?: string } }).deps?.socketPath;
  const session = await startHeadedSession({
    sessionName: `tmax-use-test-${process.pid}-${Date.now()}`,
    socketPath,
    width: 80,
    height: 24,
  }).run().then((r) => {
    if ('left' in r) throw new Error(`startHeadedSession failed: ${r.left.message}`);
    return r.right;
  });

  try {
    // Give the TUI a moment to attach + render.
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Pane dimensions should match what we asked for.
    const dims = await paneDimensions(session).run();
    if ('left' in dims) throw new Error(`paneDimensions failed: ${dims.left.message}`);
    if (dims.right.width !== 80 || dims.right.height !== 24) {
      throw new Error(`unexpected dimensions: ${dims.right.width}x${dims.right.height}`);
    }

    // Capture should produce non-empty ANSI content (TUI is rendering).
    const cap = await capturePane(session, { ansi: true }).run();
    if ('left' in cap) throw new Error(`capturePane failed: ${cap.left.message}`);
    if (cap.right.length === 0) throw new Error('capturePane returned empty output');

    // Send a quit key to exercise send-keys. We don't assert on the result —
    // the goal here is to verify the dispatch path doesn't error.
    const send = await sendKeys(session, 'q').run();
    if ('left' in send) throw new Error(`sendKeys failed: ${send.left.message}`);
  } finally {
    await killHeadedSession(session).run();
  }
});
