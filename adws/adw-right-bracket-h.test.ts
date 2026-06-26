#!/usr/bin/env bun
/**
 * E2E test for ']h' keybinding in markdown-mode.
 * Tests cursor navigation to next heading.
 *
 * Workflow:
 * - Stop any stale daemon
 * - Start the tmax daemon
 * - Create test markdown file with multiple headings
 * - Open test file via daemon
 * - Verify markdown mode is active
 * - Move cursor to first heading (line 0)
 * - Send ']h' key sequence to navigate to next heading
 * - Assert cursor moved to line 4 (## Second Heading)
 * - Send ']h' again to navigate to third heading
 * - Assert cursor moved to line 8 (### Third Heading)
 * - Send ']h' at last heading (boundary test)
 * - Assert cursor stays at last heading
 * - Kill buffer and remove test file
 * - Stop daemon
 */

import { spawn, Readable } from "child_process";
import { realpathSync, promises as fs, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const CLIENT_CMD = join(PROJECT_ROOT, "bin", "tmaxclient");
const TMAX_UID = process.getuid?.() ?? 501; // Fallback for testing
const SOCKET_PATH = `/tmp/tmax-${TMAX_UID}/server`;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Daemon control
// ---------------------------------------------------------------------------

async function startDaemon(): Promise<Result<void>> {
  console.log("Starting daemon...");

  // Ensure no stale daemon is squatting on the socket: stop it, then wait for
  // the socket to disappear before spawning a fresh one. Without this, a
  // zombie daemon from a previous run answers on the same socket and the test
  // connects to stale state (e.g. "(editor-quit)" mode).
  await stopDaemon();
  for (let i = 0; i < 30; i++) {
    if (!existsSync(SOCKET_PATH)) break;
    await sleep(100);
  }
  // Force-remove a lingering socket file if the daemon never cleaned it up.
  try { await fs.unlink(SOCKET_PATH); } catch {}

  const daemon = spawn("bun", ["run", "daemon"], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    env: { ...process.env, TMAX_SOCKET: SOCKET_PATH },
  });
  daemon.on("error", () => {});

  // Wait for socket to appear
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (!existsSync(SOCKET_PATH)) continue;
      // Test daemon is responsive (retry briefly while it initializes).
      let ready = false;
      for (let r = 0; r < 10; r++) {
        const testResult = await evalExpr("(+ 1 1)");
        if (testResult.ok && testResult.value === "2") { ready = true; break; }
        await sleep(100);
      }
      if (!ready) {
        return { ok: false, error: "Daemon started but not responsive" };
      }
      console.log(`✓ Daemon started and responsive (socket: ${SOCKET_PATH})`);
      return { ok: true, value: undefined };
    } catch {
      // Socket not ready yet
    }
  }

  return { ok: false, error: "Daemon failed to start" };
}

async function stopDaemon(): Promise<void> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, "eval", "(editor-quit)"], {
      stdio: "ignore",
    });
    await waitForExit(proc);
  } catch {
    // Ignore errors (no daemon to stop)
  }
  // Wait for the socket to actually disappear so the next startDaemon does
  // not race a shutting-down daemon.
  for (let i = 0; i < 30; i++) {
    if (!existsSync(SOCKET_PATH)) return;
    await sleep(100);
  }
}

async function openFile(filePath: string): Promise<Result<void>> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, filePath], {
      stdio: "pipe",
    });
    const stdout = await streamToText(proc.stdout!);
    const stderr = await streamToText(proc.stderr!);
    await waitForExit(proc);
    console.log(`openFile stdout: ${stdout.trim()}`);
    if (stderr.includes("ERROR") || stderr.includes("Failed")) {
      return { ok: false, error: stderr };
    }
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Client operations
// ---------------------------------------------------------------------------

async function sendKey(key: string): Promise<Result<string>> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, "--key", key], {
      stdio: "pipe",
    });
    const stdout = await streamToText(proc.stdout!);
    const stderr = await streamToText(proc.stderr!);
    await waitForExit(proc);

    if (stderr.includes("ERROR") || stderr.includes("Failed")) {
      return { ok: false, error: stderr };
    }
    return { ok: true, value: stdout };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Send a multi-key sequence as a single string (e.g., "] h" or "g h")
async function sendKeySequence(sequence: string): Promise<Result<void>> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, "--key", sequence], {
      stdio: "pipe",
    });
    const stdout = await streamToText(proc.stdout!);
    const stderr = await streamToText(proc.stderr!);
    await waitForExit(proc);

    console.log(`  sendKeySequence("${sequence}"): stdout="${stdout.trim()}", stderr="${stderr.trim()}"`);

    if (stderr.includes("ERROR") || stderr.includes("Failed")) {
      return { ok: false, error: stderr };
    }
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function sendKeys(...keys: string[]): Promise<Result<void>> {
  for (const key of keys) {
    const result = await sendKey(key);
    if (!result.ok) return result;
    await sleep(100);  // Increased delay for multi-key sequences
  }
  return { ok: true, value: undefined };
}

async function evalExpr(expr: string): Promise<Result<string>> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, "--eval", expr], {
      stdio: "pipe",
    });
    const stdout = (await streamToText(proc.stdout!)).trim();
    const stderr = await streamToText(proc.stderr!);
    await waitForExit(proc);

    if (stderr.includes("ERROR")) {
      return { ok: false, error: stderr };
    }
    return { ok: true, value: stdout };
  } catch (e) {
    return { ok: false, error: `Exception: ${String(e)}` };
  }
}

async function getMode(): Promise<Result<string>> {
  return evalExpr("(major-mode-get)");
}

async function getCursorLine(): Promise<Result<number>> {
  const result = await evalExpr("(cursor-line)");
  if (!result.ok) return result;
  return { ok: true, value: parseInt(result.value, 10) };
}

async function getCursorLineText(): Promise<Result<string>> {
  return evalExpr("(buffer-get-line (cursor-line))");
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function waitForExit(proc: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    proc.on("close", (code) => resolve(code));
    proc.on("error", reject);
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

// ---------------------------------------------------------------------------
// Test: ]h keybinding
// ---------------------------------------------------------------------------

async function testMarkdownNextHeading() {
  console.log("=== Test: ]h (markdown-next-heading) ===\n");

  // Create test markdown file
  const testContent = `# First Heading

Some content here

## Second Heading

More content

### Third Heading

Final content
`;

  const testFile = join(PROJECT_ROOT, "test-markdown-heading.md");
  await Bun.write(testFile, testContent);

  // Open file via daemon client
  console.log("Opening test file...");
  console.log(`Test file path: ${testFile}`);
  console.log(`File exists: ${await Bun.file(testFile).exists()}`);

  const openResult = await openFile(testFile);
  if (!openResult.ok) {
    console.error(`Failed to open file: ${openResult.error}`);
    process.exit(1);
  }

  // Wait for file to load
  await sleep(500);

  // Check if buffer was created
  const bufferName = await evalExpr("(buffer-current)");
  console.log(`Current buffer: ${bufferName.value}`);

  // Verify we're in markdown mode. Under full-suite load the daemon's
  // file-extension → mode detection can lag the socket-readiness check above,
  // so poll for up to ~3s (ADR-0105 robustness — fixed sleeps flake under load).
  let modeValue = "";
  for (let i = 0; i < 15; i++) {
    const modeResult = await getMode();
    assert(modeResult.ok === true, "Mode query successful");
    modeValue = modeResult.value;
    if (modeValue === "markdown") break;
    await sleep(200);
  }
  console.log(`Current mode: "${modeValue}"`);
  console.log(`Buffer filename: ${(await evalExpr("(buffer-filename)")).value}`);
  console.log(`Major modes: ${(await evalExpr("(major-mode-list)")).value}`);
  assert(modeValue === "markdown", "Should be in markdown mode after retry");

  // Test the function directly to verify it works
  console.log("\nTesting markdown-next-heading function directly...");
  // The cursor may be left at a non-zero position after opening (daemon
  // workspace state), so reset to the first heading before testing.
  await evalExpr("(cursor-move 0 0)");
  await evalExpr("(markdown-next-heading)");
  await sleep(200);
  const directTestLine = await getCursorLine();
  console.log(`After direct call, cursor at line ${directTestLine.value}`);
  assert(directTestLine.ok === true && directTestLine.value === 4, "Direct function call should move to line 4");

  // Move back to first heading
  await evalExpr("(cursor-move 0 0)");

  // Move to first heading (line 0)
  console.log("\nMoving to first heading...");
  await evalExpr("(cursor-move 0 0)");
  const line1 = await getCursorLine();
  assert(line1.ok === true && line1.value === 0, "Cursor at line 0 (first heading)");

  // Verify the ]h keybinding is registered for markdown major mode.
  // markdown-mode.tlisp binds "] h" → (markdown-next-heading) scoped to the
  // markdown major mode. resolveMapping should pick it up for the current
  // buffer (editor mode "normal" + major mode "markdown").
  console.log("\nVerifying ]h keybinding is resolvable for markdown...");
  const resolveResult = await evalExpr('(describe-key "] h" "normal")');
  console.log(`describe-key for "]h": ${resolveResult.value}`);

  // Press ]h to go to next heading (sent as the two-key sequence ] then h)
  console.log("\nPressing ]h (via key sequence) to go to next heading...");
  const press1 = await sendKeys("]", "h");
  assert(press1.ok === true, "]h key sequence accepted");
  await sleep(200);

  const line2 = await getCursorLine();
  const text2 = await getCursorLineText();
  console.log(`Cursor now at line ${line2.value}: "${text2.value}"`);

  // Should be at line 4 (## Second Heading)
  assert(line2.ok === true && line2.value === 4, `Cursor at line 4 (## Second Heading), got ${line2.value}`);
  assert(text2.ok === true && text2.value.startsWith("##"), "Line is a heading");

  // Press ]h again to go to third heading
  console.log("\nPressing ]h again to go to third heading...");
  const press2 = await sendKeys("]", "h");
  assert(press2.ok === true, "]h key sequence accepted");
  await sleep(200);

  const line3 = await getCursorLine();
  const text3 = await getCursorLineText();
  console.log(`Cursor now at line ${line3.value}: "${text3.value}"`);

  // Should be at line 8 (### Third Heading)
  assert(line3.ok === true && line3.value === 8, `Cursor at line 8 (### Third Heading), got ${line3.value}`);
  assert(text3.ok === true && text3.value.startsWith("###"), "Line is a heading");

  // Press ]h at last heading should keep cursor at last heading (boundary)
  console.log("\nPressing ]h at last heading (boundary case)...");
  const press3 = await sendKeys("]", "h");
  assert(press3.ok === true, "]h key sequence accepted");
  await sleep(200);

  const line4 = await getCursorLine();
  assert(line4.ok === true && line4.value === 8, "Cursor stays at last heading when no next heading");

  // Cleanup
  console.log("\nCleaning up...");
  await evalExpr("(kill-buffer)");
  await fs.unlink(testFile);

  console.log("\n✅ All tests passed!");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await stopDaemon(); // Clean up any stale daemon
    await startDaemon();

    await testMarkdownNextHeading();
  } finally {
    await stopDaemon();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
