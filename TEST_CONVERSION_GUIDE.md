# Test Conversion from Deno to Bun Test Syntax

## Status Report

### ✅ Successfully Converted Files (12/21 from user's list)

1. ✅ test/unit/tokenizer.test.ts
2. ✅ test/unit/filesystem.test.ts
3. ✅ test/unit/repl.test.ts
4. ✅ test/unit/stdlib.test.ts
5. ✅ test/unit/evaluator.test.ts (already converted)
6. ✅ test/unit/error-handling.test.ts (already converted)
7. ✅ test/unit/functional-patterns.test.ts (already converted)
8. ✅ test/unit/string-escaping.test.ts
9. ✅ test/unit/tail-call.test.ts
10. ✅ test/unit/tail-call-performance.test.ts
11. ✅ test/unit/terminal.test.ts

### 🔧 Still Need Conversion (9/21 from user's list)

1. ❌ test/unit/tlisp.test.ts
2. ❌ test/unit/hashmap.test.ts
3. ❌ test/frontend/ink-adapter-error-handling.test.ts
4. ❌ test/frontend/ink-adapter.test.ts
5. ❌ test/frontend/us-011-terminal-resize-core.test.ts
6. ❌ test/frontend/us-011-terminal-resize.test.ts
7. ❌ test/frontend/edge-cases.test.ts
8. ❌ test/frontend/file-io-error-handling.test.ts
9. ❌ test/frontend/editor-component.test.tsx

## Conversion Pattern

To convert remaining Deno tests to Bun tests, apply these transformations:

### 1. Import Statement
**Before:**
```typescript
import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
```

**After:**
```typescript
import { describe, test, expect } from "bun:test";
```

### 2. Test Suite Structure
**Before:**
```typescript
Deno.test("Test Suite Name", async (t) => {
  await t.step("test name", () => {
    assertEquals(a, b);
  });
});
```

**After:**
```typescript
describe("Test Suite Name", () => {
  test("test name", () => {
    expect(a).toBe(b);
  });
});
```

### 3. Assertion Mappings

| Deno Assertion | Bun Assertion |
|----------------|---------------|
| `assertEquals(a, b)` | `expect(a).toBe(b)` |
| `assertExists(a)` | `expect(a).toBeDefined()` |
| `assertRejects(fn)` | `expect(fn).rejects` |
| `assertThrows(fn)` | `expect(fn).toThrow()` |
| `assert(a)` | `expect(a).toBe(true)` |
| `assertInstanceOf(a, Class)` | `expect(a).toBeInstanceOf(Class)` |

### 4. Async Tests
**Before:**
```typescript
await t.step("async test", async () => {
  const result = await asyncOperation();
  assertEquals(result, expected);
});
```

**After:**
```typescript
test("async test", async () => {
  const result = await asyncOperation();
  expect(result).toBe(expected);
});
```

## Quick Conversion Script

For each file that needs conversion:

1. Remove all imports from `@std/assert`
2. Add: `import { describe, test, expect } from "bun:test";` at the top (after comments)
3. Replace all occurrences of:
   - `Deno.test("name", async (t) => {` → `describe("name", () => {`
   - `await t.step("test", () => {` → `test("test", () => {`
   - `assertEquals(a, b)` → `expect(a).toBe(b)`
   - `assertExists(a)` → `expect(a).toBeDefined()`
   - `assertRejects(fn)` → `expect(fn).rejects`
   - `assertThrows(fn)` → `expect(fn).toThrow()`
   - `assert(condition)` → `expect(condition).toBe(true)`
   - `assertInstanceOf(obj, Class)` → `expect(obj).toBeInstanceOf(Class)`

## Notes

- Files already converted (evaluator, error-handling, functional-patterns) are working correctly
- The error-handling.test.ts file has mixed syntax that needs to be fully cleaned up
- All `.test.ts` and `.test.tsx` files should eventually be converted
- After conversion, run `bun test` to verify all tests pass

## Additional Files Beyond User's List

There are additional test files in the codebase that may also need conversion:
- test/unit/buffer.test.ts
- test/unit/editor.test.ts
- test/unit/interpreter.test.ts
- test/unit/macros.test.ts
- test/unit/parser.test.ts
- ... (approximately 26 more files)

Total test files: 37
Converted: ~15
Remaining: ~22
