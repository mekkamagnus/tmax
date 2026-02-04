# Better CLI Output

## Status

Accepted

## Context

The initial testing framework had minimal output, making it difficult to:
- Understand test results at a glance
- See which tests failed and why
- Track progress during test execution
- Identify slow tests
- Get summary statistics

## Decision

Implement rich CLI output for test runner:

### Output Format

```
Running test suite...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ test-buffer-create (0.003s)
✓ test-buffer-insert (0.002s)
✗ test-buffer-delete (0.005s)
  Failed: Expected "" but got "Hello"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 2 passed, 1 failed, 0 skipped
Duration: 0.010s
```

### Progress Indicators

Show progress during execution:
```
Running tests... [████████░░░░░░░] 80% (12/15)
```

### Color Coding

- Green (✓): Passing tests
- Red (✗): Failing tests
- Yellow (⚠): Skipped tests
- Blue (ℹ): Info messages

### Verbose Mode

Detailed output with `--verbose` flag:
```
✓ test-buffer-create
  Buffer created: #<buffer test.txt>
  Duration: 0.003s
  Memory: 1024 bytes
```

### Quiet Mode

Minimal output with `--quiet` flag:
```
Results: 2 passed, 1 failed
```

### Implementation

Created output formatter in `src/tlisp/test-framework.ts`:

```typescript
export interface TestReporter {
  onSuiteStart(name: string): void;
  onTestStart(name: string): void;
  onTestEnd(name: string, result: TestResult): void;
  onSuiteEnd(results: SuiteResults): void;
}

export class ConsoleReporter implements TestReporter {
  onSuiteStart(name: string): void {
    console.log(`\nRunning ${name}...`);
    console.log('━'.repeat(60));
  }

  onTestStart(name: string): void {
    process.stdout.write(`  ${name}... `);
  }

  onTestEnd(name: string, result: TestResult): void {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? 'green' : 'red';
    const duration = `( ${(result.duration * 1000).toFixed(3)}s)`;

    console.log(
      colors[color](`${icon} ${name} ${duration}`)
    );

    if (!result.passed && result.error) {
      console.log(`  ${colors.red('Failed:')} ${result.error.message}`);
    }
  }

  onSuiteEnd(results: SuiteResults): void {
    console.log('━'.repeat(60));
    console.log(
      `Results: ${colors.green(`${results.passed} passed`)}, ` +
      `${colors.red(`${results.failed} failed`)}, ` +
      `${colors.yellow(`${results.skipped} skipped}`)}`
    );
    console.log(`Duration: ${(results.duration * 1000).toFixed(3)}s`);
  }
}
```

### Reporters

Support multiple reporter types:
- **Console**: Human-readable terminal output
- **JSON**: Machine-readable format for CI/CD
- **JUnit**: XML format for test result aggregation

## Consequences

### Benefits

1. **Readability**: Easy to understand test results
2. **Debugging**: Clear failure messages
3. **Progress Tracking**: See test execution in real-time
4. **CI/CD Integration**: JSON output for automation
5. **Performance Tracking**: Identify slow tests

### Trade-offs

1. **Output Volume**: Can be verbose for large test suites
2. **Terminal Dependence**: ANSI codes don't work everywhere
3. **Performance**: Output formatting adds overhead
4. **Complexity**: Multiple reporter formats to maintain

### Future Considerations

1. **HTML Report**: Generate HTML test reports
2. **Code Coverage**: Show coverage per test
3. **Flaky Test Detection**: Track intermittent failures
4. **Historical Data**: Compare test runs over time
5. **Parallel Execution**: Show concurrent test progress
6. **Real-Time Streaming**: Stream results to web dashboard

### Testing

Manual testing confirmed:
- Default output shows test names and results
- Colors render correctly in terminal
- Verbose mode shows detailed information
- Quiet mode shows minimal output
- JSON reporter produces valid JSON
- Progress indicator updates correctly
