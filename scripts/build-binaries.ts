#!/usr/bin/env bun
/**
 * Binary Build Orchestration Script
 *
 * Compiles tmax into standalone binaries for multiple platforms.
 * Generates SHA256 checksums for verification.
 */

import { $ } from "bun";

const VERSION = JSON.parse(
  await Bun.file("package.json").text()
).version as string;

// Platform detection
const PLATFORM = process.platform;
const ARCH = process.arch;

// Build configurations
const BUILD_TARGETS = {
  "darwin": {
    arm64: { target: "bun-macos-aarch64", output: "tmax-macos-arm64" },
    x64: { target: "bun-macos-x64", output: "tmax-macos-x64" },
  },
  "linux": {
    x64: { target: "bun-linux-x64", output: "tmax-linux-x64" },
    arm64: { target: "bun-linux-aarch64", output: "tmax-linux-arm64" },
  },
} as const;

type Platform = keyof typeof BUILD_TARGETS;
type Arch = keyof typeof BUILD_TARGETS[Platform];

/**
 * Get the bun target for the current platform
 */
function getCurrentTarget(): string {
  if (PLATFORM === "darwin") {
    return ARCH === "arm64" ? "bun-macos-aarch64" : "bun-macos-x64";
  }
  if (PLATFORM === "linux") {
    return ARCH === "arm64" ? "bun-linux-aarch64" : "bun-linux-x64";
  }
  throw new Error(`Unsupported platform: ${PLATFORM}`);
}

/**
 * Get the output filename for the current platform
 */
function getCurrentOutput(): string {
  if (PLATFORM === "darwin") {
    return ARCH === "arm64" ? "tmax-macos-arm64" : "tmax-macos-x64";
  }
  if (PLATFORM === "linux") {
    return ARCH === "arm64" ? "tmax-linux-arm64" : "tmax-linux-x64";
  }
  throw new Error(`Unsupported platform: ${PLATFORM}`);
}

/**
 * Compile a binary for a specific target
 */
async function buildBinary(
  target: string,
  output: string
): Promise<{ success: boolean; path: string; size: number }> {
  const startTime = Date.now();
  console.log(`\n🔨 Building ${output}...`);
  console.log(`   Target: ${target}`);

  try {
    await $`bun build --compile --target=${target} ./src/main.tsx --outfile ./dist/${output}`;

    const path = `./dist/${output}`;
    const stat = Bun.file(path);
    const size = stat.size;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`   ✅ Built ${path}`);
    console.log(`   📦 Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   ⏱️  Duration: ${duration}s`);

    // Make executable on Unix
    if (PLATFORM !== "win32") {
      await $`chmod +x ${path}`;
    }

    return { success: true, path, size };
  } catch (error) {
    console.error(`   ❌ Failed to build ${output}`);
    console.error(`   ${error}`);
    return { success: false, path: "", size: 0 };
  }
}

/**
 * Generate SHA256 checksum for a file
 */
async function generateChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

/**
 * Generate checksums file for all binaries
 */
async function generateChecksumsFile(): Promise<void> {
  console.log("\n🔐 Generating checksums...");

  const distFiles = Array.from(
    new Bun.Glob("tmax-*").scanSync("./dist")
  ).filter((f) => !f.includes("SHA256SUMS"));

  const checksums: string[] = [];

  for (const file of distFiles) {
    const checksum = await generateChecksum(`./dist/${file}`);
    checksums.push(`${checksum}  ${file}`);
    console.log(`   ${checksum}  ${file}`);
  }

  const checksumsPath = "./dist/SHA256SUMS";
  await Bun.write(checksumsPath, checksums.join("\n") + "\n");
  console.log(`\n   ✅ Checksums written to ${checksumsPath}`);
}

/**
 * Build binary for current platform
 */
async function buildCurrent(): Promise<void> {
  console.log("🚀 Building tmax v" + VERSION);
  console.log(`📍 Platform: ${PLATFORM} (${ARCH})`);

  // Ensure dist directory exists
  await $`mkdir -p dist`;

  const target = getCurrentTarget();
  const output = getCurrentOutput();

  const result = await buildBinary(target, output);

  if (result.success) {
    await generateChecksumsFile();
    console.log("\n✅ Build complete!");
    console.log(`\nRun: ./dist/${output} --help`);
  } else {
    console.error("\n❌ Build failed");
    process.exit(1);
  }
}

/**
 * Build binaries for all platforms
 */
async function buildAll(): Promise<void> {
  console.log("🚀 Building tmax v" + VERSION + " for all platforms");

  // Ensure dist directory exists
  await $`mkdir -p dist`;

  const results: Array<{ success: boolean; path: string; size: number }> = [];

  for (const [platform, archs] of Object.entries(BUILD_TARGETS)) {
    for (const [arch, config] of Object.entries(archs)) {
      const result = await buildBinary(config.target, config.output);
      results.push(result);
    }
  }

  const successful = results.filter((r) => r.success).length;
  const totalSize = results.reduce((sum, r) => sum + r.size, 0);

  await generateChecksumsFile();

  console.log("\n" + "─".repeat(50));
  console.log(`📊 Build Summary:`);
  console.log(`   ✅ Successful: ${successful}/${results.length}`);
  console.log(`   📦 Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log("─".repeat(50));

  if (successful === results.length) {
    console.log("\n✅ All builds successful!");
  } else {
    console.log(`\n⚠️  ${results.length - successful} builds failed`);
    process.exit(1);
  }
}

/**
 * Clean build artifacts
 */
async function clean(): Promise<void> {
  console.log("🧹 Cleaning build artifacts...");
  await $`rm -rf dist`;
  console.log("✅ Cleaned dist/");
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "all":
  case "--all":
    await buildAll();
    break;
  case "clean":
  case "--clean":
    await clean();
    break;
  default:
    await buildCurrent();
}
