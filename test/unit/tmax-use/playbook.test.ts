/**
 * @file playbook.test.ts
 * @description Unit tests for the YAML playbook parser + linter. No daemon.
 */
import { describe, test, expect } from 'bun:test';
import { parsePlaybook, validatePlaybook } from '../../../tmax-use/test/playbook.ts';
import { Either } from '../../../src/utils/task-either.ts';

const MINIMAL = `
name: smoke
steps:
  - keys: "i"
`;

const FULL = `
name: markdown
description: Full coverage
mode: markdown
width: 100
height: 30
setup:
  - action: setup_file
    var: FILE
    name: fixture.md
    content: |
      # Hello
steps:
  - name: open
    keys: "<Enter>"
    setup_cursor: [0, 0]
    wait: 100
    expect:
      cursor_line: 0
      cursor_column: 0
      mode: normal
      buffer_contains: "Hello"
      status_message: "ok"
      result_contains: "x"
      screen_contains: "Hello"
      screen_not_contains: "Missing"
      line_text: "abc"
      line_text_matches: "^a"
cleanup: true
`;

describe('parsePlaybook — valid inputs', () => {
  test('minimal playbook with just name + steps', () => {
    const r = parsePlaybook(MINIMAL);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.name).toBe('smoke');
      expect(r.right.steps.length).toBe(1);
    }
  });

  test('fully-populated playbook parses every field', () => {
    const r = parsePlaybook(FULL);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      const pb = r.right;
      expect(pb.name).toBe('markdown');
      expect(pb.mode).toBe('markdown');
      // Top-level width/height accepted as back-compat alias of terminal.width/height.
      expect(pb.terminal?.width).toBe(100);
      expect(pb.terminal?.height).toBe(30);
      expect(pb.setup?.[0]?.var).toBe('FILE');
      const step = pb.steps[0]!;
      expect(step.name).toBe('open');
      expect(step.setup_cursor).toEqual([0, 0]);
      expect(step.wait).toBe(100);
      const expect_ = step.expect!;
      expect(expect_.cursor_line).toBe(0);
      expect(expect_.mode).toBe('normal');
      expect(expect_.line_text_matches).toBe('^a');
    }
  });

  test('terminal: { width, height } mapping is accepted', () => {
    const yaml = `
name: t
terminal:
  width: 120
  height: 40
steps:
  - keys: x
`;
    const r = parsePlaybook(yaml);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.terminal?.width).toBe(120);
      expect(r.right.terminal?.height).toBe(40);
    }
  });

  test('open step action is accepted (mutually exclusive with keys/eval)', () => {
    const yaml = `
name: t
steps:
  - open: /tmp/foo.txt
`;
    const r = parsePlaybook(yaml);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.steps[0]!.open).toBe('/tmp/foo.txt');
    }
  });

  test('open + keys in same step rejected as mutually exclusive', () => {
    const yaml = `
name: t
steps:
  - open: /tmp/foo.txt
    keys: i
`;
    const r = parsePlaybook(yaml);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.some((e: string) => e.includes('mutually exclusive'))).toBe(true);
    }
  });

  test('unknown terminal key rejected', () => {
    const yaml = `
name: t
terminal:
  cols: 80
steps:
  - keys: x
`;
    const r = parsePlaybook(yaml);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('setup is optional', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: x`);
    expect(Either.isRight(r)).toBe(true);
  });

  test('description and cleanup optional', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: x`);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.description).toBeUndefined();
      expect(r.right.cleanup).toBeUndefined();
    }
  });
});

describe('parsePlaybook — error cases', () => {
  test('missing name fails', () => {
    const r = parsePlaybook(`steps:\n  - keys: x`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.some((e: string) => e.includes('name'))).toBe(true);
    }
  });

  test('missing steps fails', () => {
    const r = parsePlaybook(`name: t`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('empty steps array fails', () => {
    const r = parsePlaybook(`name: t\nsteps: []`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('keys + eval mutual exclusivity violated', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: "x"\n    eval: "(foo)"`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.some((e: string) => e.includes('mutually exclusive'))).toBe(true);
    }
  });

  test('backslash in eval rejected (JSON-RPC mangles them)', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - eval: "(foo \\\\)"`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.some((e: string) => e.includes('backslash'))).toBe(true);
    }
  });

  test('unknown top-level key rejected', () => {
    const r = parsePlaybook(`name: t\nbogus: x\nsteps:\n  - keys: x`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.some((e: string) => e.includes('unknown'))).toBe(true);
    }
  });

  test('unknown step key rejected', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: x\n    bogus: 1`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('unknown expect key rejected', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: x\n    expect:\n      bogus: 1`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('non-mapping top level fails', () => {
    const r = parsePlaybook(`- foo\n- bar`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('setup_cursor must be two numbers', () => {
    const r = parsePlaybook(`name: t\nsteps:\n  - keys: x\n    setup_cursor: [1]`);
    expect(Either.isLeft(r)).toBe(true);
  });

  test('setup.action must be setup_file', () => {
    const r = parsePlaybook(`name: t\nsetup:\n  - action: foo\n    name: x\n    content: y\nsteps:\n  - keys: x`);
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('parsePlaybook — error accumulation', () => {
  test('multiple errors all reported', () => {
    const r = parsePlaybook(`bogus: 1\nalso_bad: 2\nsteps: []`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r) && r.left._tag === 'PlaybookParseFailed') {
      expect(r.left.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('parsePlaybook — YAML subset enforcement', () => {
  test('malformed YAML fails with parse error', () => {
    const r = parsePlaybook(`name: t\n: bad\n  - x`);
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('validatePlaybook — direct', () => {
  test('returns Validation with errors array on failure', () => {
    const v = validatePlaybook({ steps: [] });
    expect(v.isFailure()).toBe(true);
    expect(v.getErrors().length).toBeGreaterThan(0);
  });

  test('returns Validation with value on success', () => {
    const v = validatePlaybook({ name: 't', steps: [{ keys: 'x' }] });
    expect(v.isSuccess()).toBe(true);
    expect(v.getValue().name).toBe('t');
  });
});
