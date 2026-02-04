# Basic Coverage

## Status

Accepted

## Context

No visibility into how much of the codebase was tested:
- Unclear which code paths were tested
- Risk of untested code breaking
- No quality metrics for test coverage
- Hard to prioritize testing efforts

## Decision

Implement basic code coverage tracking for T-Lisp code:

### Coverage Collection

Track which expressions are evaluated during test execution:
```lisp
;; During test execution
(deftest test-math
  (assert-equal (+ 1 2) 3)  ; ✓ Covered
  (assert-equal (* 2 3) 6))  ; ✓ Covered

;; Coverage report
(test-coverage)
;; => { "+" => 5, "*" => 3, "-" => 0 }
```

### Coverage Types

1. **Line Coverage**: Which lines executed
2. **Function Coverage**: Which functions called
3. **Branch Coverage**: Which branches taken

### Coverage Report

```
Coverage Report:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File                Lines    Functions    Branches
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
math.tlisp           80%         75%          70%
buffer.tlisp         60%         50%          40%
editor.tlisp         40%         30%          20%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total               60%         52%          43%
```

### Coverage Thresholds

Fail if coverage below threshold:
```lisp
(test-run-all :min-coverage 70)  ; Fail if < 70% coverage
```

### Implementation

Created coverage tracking in `src/tlisp/evaluator.ts`:

```typescript
export interface CoverageData {
  file: string;
  lines: Set<number>;
  functions: Set<string>;
  branches: Map<string, boolean>; // branch id → taken
}

export class CoverageTracker {
  private coverage: Map<string, CoverageData> = new Map();

  trackLine(file: string, line: number): void {
    if (!this.coverage.has(file)) {
      this.coverage.set(file, {
        file,
        lines: new Set(),
        functions: new Set(),
        branches: new Map()
      });
    }
    this.coverage.get(file)!.lines.add(line);
  }

  trackFunction(file: string, funcName: string): void {
    this.coverage.get(file)!.functions.add(funcName);
  }

  trackBranch(file: string, branchId: string, taken: boolean): void {
    this.coverage.get(file)!.branches.set(branchId, taken);
  }

  getCoverage(file: string): CoverageData {
    return this.coverage.get(file) || {
      file,
      lines: new Set(),
      functions: new Set(),
      branches: new Map()
    };
  }
}
```

### Coverage Commands

```lisp
;; Get coverage for all files
(test-coverage)

;; Get coverage for specific file
(test-coverage "math.tlisp")

;; Generate HTML coverage report
(test-coverage-html :output "coverage/")
```

## Consequences

### Benefits

1. **Visibility**: See which code is tested
2. **Quality Gates**: Enforce minimum coverage standards
3. **Prioritization**: Focus testing on uncovered code
4. **Trend Tracking**: Monitor coverage over time
5. **Documentation**: Coverage serves as usage evidence

### Trade-offs

1. **Performance Overhead**: Tracking slows execution
2. **False Confidence**: High coverage ≠ good tests
3. **Complexity**: Additional infrastructure to maintain
4. **T-Lisp Only**: Doesn't track TypeScript coverage

### Future Considerations

1. **Branch Coverage**: Track if/else branches
2. **Condition Coverage**: Track boolean sub-expressions
3. **HTML Report**: Visual coverage overlay on source
4. **Diff Coverage**: Show coverage for new code only
5. **Coverage History**: Track coverage trends over time
6. **Integration Coverage**: Track TypeScript-TLisp boundary

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- Coverage tracking works correctly
- Line coverage percentages accurate
- Function coverage counts correct
- Coverage reports render correctly
- Coverage thresholds enforce minimums
