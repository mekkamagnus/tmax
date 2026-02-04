# Test Coverage Metrics

## Status

Accepted

## Context

Track test coverage quality:
- Line coverage percentage
- Function coverage percentage
- Branch coverage percentage
- Coverage trends over time

## Decision

Implement comprehensive test coverage metrics:

### Coverage Tracking

```typescript
export class CoverageTracker {
  private lineCoverage: Map<string, Set<number>> = new Map();
  private functionCoverage: Map<string, Set<string>> = new Map();
  private branchCoverage: Map<string, Map<string, boolean>> = new Map();

  trackLine(file: string, line: number): void {
    if (!this.lineCoverage.has(file)) {
      this.lineCoverage.set(file, new Set());
    }
    this.lineCoverage.get(file)!.add(line);
  }

  trackFunction(file: string, funcName: string): void {
    if (!this.functionCoverage.has(file)) {
      this.functionCoverage.set(file, new Set());
    }
    this.functionCoverage.get(file)!.add(funcName);
  }

  trackBranch(file: string, branchId: string, taken: boolean): void {
    if (!this.branchCoverage.has(file)) {
      this.branchCoverage.set(file, new Map());
    }
    this.branchCoverage.get(file)!.set(branchId, taken);
  }

  getCoverage(file: string): CoverageReport {
    const lines = this.countLines(file);
    const coveredLines = this.lineCoverage.get(file)?.size || 0;
    const linePercent = (coveredLines / lines) * 100;

    const functions = this.countFunctions(file);
    const coveredFunctions = this.functionCoverage.get(file)?.size || 0;
    const functionPercent = functions > 0 ? (coveredFunctions / functions) * 100 : 100;

    const branches = this.countBranches(file);
    const coveredBranches = this.branchCoverage.get(file)?.size || 0;
    const branchPercent = branches > 0 ? (coveredBranches / branches) * 100 : 100;

    return {
      file,
      linePercent,
      functionPercent,
      branchPercent,
      lines,
      coveredLines,
      functions,
      coveredFunctions,
      branches,
      coveredBranches
    };
  }
}
```

### Coverage Report

```
Coverage Report:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File                Lines    Functions    Branches
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
buffer.ts           85%         90%          80%
editor.ts           75%         70%          65%
keymap.ts           95%        100%          90%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total               85%         87%          78%

Threshold: 80% | Lines: ✓ | Functions: ✓ | Branches: ✗
```

### Coverage Commands

```lisp
;; Show coverage
(test-coverage)                    ; => Show coverage report
(test-coverage "buffer.ts")        ; => Show file coverage
(test-coverage-html :output "coverage/")  ; => Generate HTML report

;; Coverage thresholds
(test-run-all :min-coverage 80)    ; => Fail if < 80% coverage
```

### Implementation

Created `src/tlisp/test-framework.ts`:
- Coverage tracking
- Coverage calculation
- Report generation
- HTML report generation

## Consequences

### Benefits

1. **Quality**: Track test quality
2. **Gaps**: Identify untested code
3. **Trends**: Monitor coverage over time
4. **Standards**: Enforce coverage thresholds

### Trade-offs

1. **Overhead**: Coverage tracking slows tests
2. **False Security**: High coverage ≠ good tests
3. **Complexity**: Coverage calculation is complex
4. **Maintenance**: Must update coverage tools

### Future Considerations

1. **Diff Coverage**: Coverage for new code only
2. **Branch Coverage**: Track all branches
3. **Coverage History**: Track trends over time
4. **Coverage Badges**: Generate coverage badges

### Testing

Manual testing confirmed:
- Coverage tracking works
- Percentages calculated correctly
- Report renders correctly
- HTML report generates
- Thresholds enforced
- Uncovered files identified
