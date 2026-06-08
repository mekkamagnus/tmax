import { describe, expect, test } from "bun:test";
import { MessageLog, type LogLevel } from "../../src/editor/message-log.ts";

describe("MessageLog", () => {
  test("logs and renders entries with level", () => {
    const log = new MessageLog();
    log.log('info', 'hello');
    const rendered = log.render();
    expect(rendered).toContain('[info] hello');
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
  });

  test("logs entries with command context", () => {
    const log = new MessageLog();
    log.log('error', 'bad thing', 'my-command');
    const rendered = log.render();
    expect(rendered).toContain('[error] [my-command] bad thing');
  });

  test("renders without command bracket when no command", () => {
    const log = new MessageLog();
    log.log('info', 'simple');
    const rendered = log.render();
    expect(rendered).toContain('[info] simple');
    expect(rendered).not.toContain('[]');
  });

  test("filters by minimum level", () => {
    const log = new MessageLog();
    log.minLevel = 'warn';
    log.log('debug', 'hidden');
    log.log('info', 'also hidden');
    log.log('warn', 'visible');
    log.log('error', 'also visible');
    const entries = log.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.text).toBe('visible');
    expect(entries[1]!.text).toBe('also visible');
  });

  test("evicts oldest entries when over max", () => {
    const log = new MessageLog();
    log.maxSize = 3;
    log.log('info', 'a');
    log.log('info', 'b');
    log.log('info', 'c');
    log.log('info', 'd');
    const entries = log.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.text).toBe('b');
    expect(entries[2]!.text).toBe('d');
  });

  test("disables logging when max is 0", () => {
    const log = new MessageLog();
    log.maxSize = 0;
    log.log('info', 'hidden');
    expect(log.getEntries()).toHaveLength(0);
  });

  test("resumes logging after max restored", () => {
    const log = new MessageLog();
    log.maxSize = 0;
    log.log('info', 'hidden');
    log.maxSize = 100;
    log.log('info', 'visible');
    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe('visible');
  });

  test("clear removes all entries", () => {
    const log = new MessageLog();
    log.log('info', 'a');
    log.log('info', 'b');
    log.clear();
    expect(log.getEntries()).toHaveLength(0);
    expect(log.render()).toBe('');
  });

  test("getEntries filters by level", () => {
    const log = new MessageLog();
    log.log('info', 'info msg');
    log.log('warn', 'warn msg');
    log.log('error', 'error msg');
    const errors = log.getEntries({ level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.text).toBe('error msg');
  });

  test("getEntries returns last N entries", () => {
    const log = new MessageLog();
    log.log('info', 'a');
    log.log('info', 'b');
    log.log('info', 'c');
    const last2 = log.getEntries({ last: 2 });
    expect(last2).toHaveLength(2);
    expect(last2[0]!.text).toBe('b');
    expect(last2[1]!.text).toBe('c');
  });

  test("default max is 1000", () => {
    expect(new MessageLog().maxSize).toBe(1000);
  });

  test("default min level is info", () => {
    expect(new MessageLog().minLevel).toBe('info');
  });

  test("ring buffer at exactly max capacity does not evict", () => {
    const log = new MessageLog();
    log.maxSize = 3;
    log.log('info', 'a');
    log.log('info', 'b');
    log.log('info', 'c');
    expect(log.getEntries()).toHaveLength(3);
    expect(log.getEntries()[0]!.text).toBe('a');
  });
});
