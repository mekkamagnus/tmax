# Chore: Remove all Deno remnants

## Chore Description
The tmax project was migrated from Deno to Bun, but several active code files still reference Deno-specific APIs (`Deno.exit`, `Deno.stdin`, `Deno.args`, `Deno.remove`, `Deno.addSignalListener`), comments mention "Deno-ink" throughout the frontend layer, and documentation still references Deno. Remove or replace all Deno remnants so the codebase is fully Bun-native.

## Relevant Files

### Scripts using Deno APIs
- `scripts/test-keys.ts` — `Deno.stdin.isTerminal`, `Deno.exit(1)`, shebang `#!/usr/bin/env deno run`
- `scripts/repl.ts` — `Deno.addSignalListener("SIGINT")`, `Deno.exit(0)`, shebang `#!/usr/bin/env deno run`
- `scripts/test-commands.ts` — `Deno.remove()`
- `scripts/test-final-commands.ts` — `Deno.remove()`

### Test files using Deno APIs
- `test/unit/filesystem.test.ts` — `Deno.remove()` in cleanup test

### Example files referencing Deno
- `examples/task-either-usage.ts` — references `deno.json` in project validation example

### Frontend files with "Deno-ink" comments
- `src/frontend/ink-adapter.ts` — ~20 "Deno-ink" comment references
- `src/frontend/frontends/ink/ink-adapter.ts` — ~20 "Deno-ink" comment references (duplicate)
- `src/frontend/types.ts` — file description comment
- `src/frontend/components/Editor.tsx` — file description comment
- `src/frontend/frontends/ink/components/Editor.tsx` — file description comment

### Core files with Deno references
- `src/core/terminal.ts` — help text mentions `deno task start`
- `src/utils/debug-reporter.ts` — displays "Deno Version" in debug output

### Documentation with Deno references
- `README.md` — "React/Deno-ink based"
- `docs/examples/programming.tlisp` — example imports from `deno.land/std`
- `test/ui/TEST_STATUS.md` — extensive Deno-ink migration discussion
- `TEST_CONVERSION_GUIDE.md` — Deno-to-Bun conversion guide (stale)
- `TEST_CONVERSION_SUMMARY.md` — Deno migration summary (stale)

## Step by Step Tasks

### Fix shebangs in scripts
- Replace `#!/usr/bin/env deno run --allow-read --allow-write` with `#!/usr/bin/env bun` in `scripts/test-keys.ts` and `scripts/repl.ts`

### Fix Deno APIs in scripts/test-keys.ts
- Replace `Deno.stdin.isTerminal` / `Deno.stdin.isTerminal()` with `process.stdin.isTTY` (Bun/Node compatible)
- Replace `Deno.exit(1)` with `process.exit(1)`

### Fix Deno APIs in scripts/repl.ts
- Replace `Deno.addSignalListener("SIGINT", ...)` with `process.on("SIGINT", ...)`
- Replace `Deno.exit(0)` with `process.exit(0)`

### Fix Deno.remove in scripts/test-commands.ts and scripts/test-final-commands.ts
- Add `import * as fs from "fs"` and replace `Deno.remove(path)` with `fs.promises.unlink(path)`

### Fix Deno.remove in test/unit/filesystem.test.ts
- Replace `Deno.remove(testFilePath)` with `fs.unlinkSync(testFilePath)`
- Add `import * as fs from "fs"` if not already present

### Fix examples/task-either-usage.ts
- Replace `deno.json` reference with `bun.lock`

### Replace "Deno-ink" comments in frontend files
- Replace all "Deno-ink" with "Ink" in comments across all 5 frontend files using `replace_all`

### Fix src/core/terminal.ts
- Replace `deno task start --dev` with `bun run start --dev`

### Fix src/utils/debug-reporter.ts
- Replace Deno Version line with `Bun Version: ${Bun.version}`

### Update README.md
- Replace "React/Deno-ink based" with "React/Ink based"

### Update docs/examples/programming.tlisp
- Replace `deno.land/std` import and `Deno.test()` with Bun test examples

### Update test/ui/TEST_STATUS.md
- Replace "Deno-ink" with "Ink", replace `Deno.args` with `process.argv`

### Remove stale conversion docs
- Delete `TEST_CONVERSION_GUIDE.md`
- Delete `TEST_CONVERSION_SUMMARY.md`

## Validation Commands
- `bun test` — Run full test suite, expect 0 fail
- `grep -ri "deno" --include="*.ts" --include="*.tsx" src/ scripts/ test/ examples/ | grep -v node_modules` — No Deno refs in active code
- `grep -ri "deno" README.md docs/examples/ test/ui/TEST_STATUS.md | head -20` — Docs clean

## Notes
- The `ink-adapter.ts` files exist in two locations. Both need the same treatment.
- Do NOT touch files under `specs/` or `docs/manual/` — historical/archived records.
- Bun provides Node.js-compatible `process` API, so `process.exit()`, `process.stdin.isTTY`, `process.on("SIGINT")` all work.
- `Bun.version` is available globally in Bun runtime.
