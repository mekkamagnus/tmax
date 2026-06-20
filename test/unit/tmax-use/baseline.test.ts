/**
 * @file baseline.test.ts
 * @description Unit tests for HTML baseline comparison. Uses the
 *   `__baselineInternals` exports to access the tokenizer and comparator
 *   directly; also exercises `matchBaseline` against real temp files.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  matchBaseline, writeBaseline, updateBaseline, __baselineInternals,
} from '../../../tmax-use/assert/baseline.ts';
import { Either } from '../../../src/utils/task-either.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tmax-use-baseline-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const { tokenizeHtml, compareHtml } = __baselineInternals;

describe('tokenizeHtml — basic shapes', () => {
  test('empty string yields no tokens', () => {
    const r = tokenizeHtml('');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.length).toBe(0);
  });

  test('plain text becomes a text token', () => {
    const r = tokenizeHtml('hello');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.length).toBe(1);
      expect(r.right[0]!.kind).toBe('text');
    }
  });

  test('doctype skipped', () => {
    const r = tokenizeHtml('<!DOCTYPE html>hi');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.length).toBe(1);
      expect(r.right[0]!.kind).toBe('text');
    }
  });

  test('opening tag with attrs', () => {
    const r = tokenizeHtml('<span class="x" style="color:red">hi</span>');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      // <span> + text "hi" + </span>
      expect(r.right.length).toBe(3);
      expect(r.right[0]!.kind).toBe('tag');
      expect(r.right[0]!.value).toBe('span');
    }
  });

  test('self-closing tag', () => {
    const r = tokenizeHtml('<br/>');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right[0]!.kind).toBe('tag');
      expect(r.right[0]!.value).toBe('br');
    }
  });

  test('entity decoding in text', () => {
    const r = tokenizeHtml('a&nbsp;b&lt;c&gt;d');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right[0]!.value).toBe('a b<c>d');
    }
  });

  test('whitespace-only text trimmed to nothing', () => {
    const r = tokenizeHtml('<span>   </span>');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      // Just the two tag tokens; the whitespace text node is dropped.
      expect(r.right.length).toBe(2);
    }
  });
});

describe('compareHtml — matching', () => {
  test('identical HTML matches', () => {
    const a = '<span>hi</span>';
    expect(compareHtml(a, a).match).toBe(true);
  });

  test('semantically equal but whitespace-different matches', () => {
    const a = '<span>hi</span>';
    const b = '<span>  hi  </span>';
    expect(compareHtml(a, b).match).toBe(true);
  });

  test('different text does not match', () => {
    expect(compareHtml('<span>hi</span>', '<span>bye</span>').match).toBe(false);
  });

  test('different tag does not match', () => {
    expect(compareHtml('<span>hi</span>', '<div>hi</div>').match).toBe(false);
  });

  test('style attr difference does not match', () => {
    expect(compareHtml('<span style="color:red">x</span>', '<span style="color:blue">x</span>').match).toBe(false);
  });

  test('id attr difference is ignored (not in keep set)', () => {
    expect(compareHtml('<span id="a">x</span>', '<span id="b">x</span>').match).toBe(true);
  });

  test('mismatch produces a non-empty diff', () => {
    const cmp = compareHtml('<span>hi</span>', '<span>bye</span>');
    expect(cmp.match).toBe(false);
    expect(cmp.diff.length).toBeGreaterThan(0);
  });
});

describe('matchBaseline — lifecycle', () => {
  test('update mode overwrites existing baseline', async () => {
    const path = join(tmpDir, 'b.html');
    writeFileSync(path, 'OLD');
    const r = await matchBaseline('NEW', path, { update: true }).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.updated).toBe(true);
      expect(readFileSync(path, 'utf-8')).toBe('NEW');
    }
  });

  test('update mode creates baseline if missing', async () => {
    const path = join(tmpDir, 'new.html');
    const r = await matchBaseline('NEW', path, { update: true }).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.updated).toBe(true);
      expect(readFileSync(path, 'utf-8')).toBe('NEW');
    }
  });

  test('missing baseline + local → auto-create', async () => {
    const path = join(tmpDir, 'auto.html');
    const r = await matchBaseline('FIRST', path, { failOnMissing: false }).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.created).toBe(true);
      expect(r.right.passed).toBe(true);
    }
  });

  test('missing baseline + CI → fail', async () => {
    const path = join(tmpDir, 'missing.html');
    const r = await matchBaseline('FIRST', path, { failOnMissing: true }).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left._tag).toBe('BaselineMissing');
    }
  });

  test('existing baseline match → pass', async () => {
    const path = join(tmpDir, 'match.html');
    writeFileSync(path, '<span>hi</span>');
    const r = await matchBaseline('<span>hi</span>', path).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.passed).toBe(true);
      expect(r.right.created).toBe(false);
      expect(r.right.updated).toBe(false);
    }
  });

  test('existing baseline mismatch → fail with diff', async () => {
    const path = join(tmpDir, 'mismatch.html');
    writeFileSync(path, '<span>hi</span>');
    const r = await matchBaseline('<span>bye</span>', path).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.passed).toBe(false);
      expect(r.right.diff.length).toBeGreaterThan(0);
    }
  });
});

describe('writeBaseline / updateBaseline', () => {
  test('writeBaseline creates parent dirs', async () => {
    const path = join(tmpDir, 'nested', 'deep', 'baseline.html');
    const r = await writeBaseline(path, 'CONTENT').run();
    expect(Either.isRight(r)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('CONTENT');
  });

  test('updateBaseline is alias for writeBaseline', async () => {
    const path = join(tmpDir, 'upd.html');
    const r = await updateBaseline(path, 'X').run();
    expect(Either.isRight(r)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('X');
  });
});
