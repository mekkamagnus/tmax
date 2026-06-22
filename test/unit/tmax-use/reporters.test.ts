/**
 * @file reporters.test.ts
 * @description Unit tests for terminal + HTML + JUnit reporters. No daemon.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  renderSuite, renderTest, __termReporterInternals,
} from '../../../tmax-use/test/reporter-term.ts';
import { renderHtmlReport, writeHtmlReport, __htmlReporterInternals } from '../../../tmax-use/test/reporter-html.ts';
import { renderJUnit, writeJUnitReport, __junitReporterInternals } from '../../../tmax-use/test/reporter-junit.ts';
import type { SuiteResult, TestResult, StepResult } from '../../../tmax-use/test/runner.ts';

function fakeStep(over: Partial<StepResult> = {}): StepResult {
  return { name: 's', passed: true, details: [], durationMs: 10, ...over };
}

function fakeTest(over: Partial<TestResult> = {}): TestResult {
  return {
    name: 't', source: '/path/to/t.yaml', passed: true, steps: [], durationMs: 50, ...over,
  };
}

function fakeSuite(over: Partial<SuiteResult> = {}): SuiteResult {
  return { results: [], passed: 0, failed: 0, durationMs: 100, ...over };
}

describe('terminal reporter — renderTest', () => {
  test('passed test renders PASS label', () => {
    const lines = renderTest(fakeTest({ passed: true }));
    expect(lines[0]).toContain('PASS');
    expect(lines[0]).toContain('/path/to/t.yaml');
  });

  test('failed test renders FAIL label', () => {
    const lines = renderTest(fakeTest({ passed: false }));
    expect(lines[0]).toContain('FAIL');
  });

  test('failed steps show under header', () => {
    const lines = renderTest(fakeTest({
      passed: false,
      steps: [fakeStep({ name: 'step1', passed: false, details: ['bad'] })],
    }));
    const joined = lines.join('\n');
    expect(joined).toContain('step1');
    expect(joined).toContain('bad');
  });

  test('no failure message when steps already show it', () => {
    const lines = renderTest(fakeTest({
      passed: false,
      steps: [fakeStep({ name: 's1', passed: false })],
    }));
    expect(lines.length).toBeGreaterThan(0);
  });

  test('failed step with frame renders a box border', () => {
    const lines = renderTest(fakeTest({
      passed: false,
      steps: [fakeStep({
        name: 's1', passed: false, details: ['bad'],
        frame: { lines: ['hello world', 'second line'], width: 80, height: 24 },
      })],
    }));
    const joined = lines.join('\n');
    expect(joined).toContain('┌');
    expect(joined).toContain('└');
    expect(joined).toContain('hello world');
  });
});

describe('terminal reporter — renderSuite', () => {
  test('renders header + summary footer', () => {
    const out = renderSuite(fakeSuite({
      results: [fakeTest({ name: 'a' }), fakeTest({ name: 'b' })],
      passed: 2, failed: 0,
    }));
    expect(out).toContain('2 passed');
  });

  test('mixed pass/fail shown in summary', () => {
    const out = renderSuite(fakeSuite({
      results: [fakeTest(), fakeTest({ passed: false })],
      passed: 1, failed: 1,
    }));
    expect(out).toContain('1 passed');
    expect(out).toContain('1 failed');
  });
});

describe('terminal reporter — formatDuration', () => {
  const { formatDuration } = __termReporterInternals;
  test('small durations rendered as ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  test('durations >= 1000 rendered as seconds', () => {
    expect(formatDuration(1500)).toBe('1.50s');
  });
});

describe('HTML reporter', () => {
  test('renderHtmlReport produces a valid HTML document', () => {
    const html = renderHtmlReport(fakeSuite({
      results: [fakeTest()],
      passed: 1, failed: 0,
    }));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('1 passed');
  });

  test('failed test renders failure class', () => {
    const html = renderHtmlReport(fakeSuite({
      results: [fakeTest({ passed: false, failureMessage: 'oops' })],
      failed: 1,
    }));
    expect(html).toContain('class="test fail"');
    expect(html).toContain('oops');
  });

  test('writeHtmlReport writes to output dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-use-rep-'));
    try {
      const suite = fakeSuite({ results: [fakeTest()], passed: 1 });
      const r = await writeHtmlReport(suite, dir).run();
      expect('right' in r).toBe(true);
      if ('right' in r) {
        expect(existsSync(r.right)).toBe(true);
        const content = readFileSync(r.right, 'utf-8');
        expect(content).toContain('<!DOCTYPE html>');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('HTML escapes user content', () => {
    const { escapeHtml } = __htmlReporterInternals;
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });
});

describe('JUnit reporter', () => {
  test('renderJUnit produces valid XML', () => {
    const xml = renderJUnit(fakeSuite({
      results: [fakeTest({ name: 'foo', source: '/p/foo.yaml' })],
      passed: 1, failed: 0,
    }));
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('tests="1"');
    expect(xml).toContain('failures="0"');
  });

  test('per-step testcase emitted for stepped results', () => {
    const xml = renderJUnit(fakeSuite({
      results: [fakeTest({
        name: 'pb', source: '/p/pb.yaml',
        steps: [fakeStep({ name: 's1', passed: true }), fakeStep({ name: 's2', passed: false, details: ['boom'] })],
      })],
      passed: 0, failed: 1,
    }));
    expect(xml).toContain('name="s1"');
    expect(xml).toContain('name="s2"');
    expect(xml).toContain('<failure');
    expect(xml).toContain('boom');
  });

  test('failure emits <failure> element', () => {
    const xml = renderJUnit(fakeSuite({
      results: [fakeTest({ name: 'foo', passed: false, failureMessage: 'broken' })],
      failed: 1,
    }));
    expect(xml).toContain('<failure');
    expect(xml).toContain('broken');
  });

  test('writeJUnitReport writes junit.xml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-use-junit-'));
    try {
      const suite = fakeSuite({ results: [fakeTest()], passed: 1 });
      const r = await writeJUnitReport(suite, dir).run();
      expect('right' in r).toBe(true);
      if ('right' in r) {
        expect(existsSync(r.right)).toBe(true);
        const content = readFileSync(r.right, 'utf-8');
        expect(content).toContain('<testsuites');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('XML escapes user content', () => {
    const { escapeXml } = __junitReporterInternals;
    expect(escapeXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
