#!/usr/bin/env bun
/**
 * @file cli.ts
 * @description `tmax-use` CLI entry point. Discovers playbooks + test files,
 *   executes them under fresh daemons, prints the terminal summary, and
 *   writes HTML + JUnit reports to the output directory.
 *
 * Usage:
 *   tmax-use [patterns...] [options]
 *
 * Options:
 *   --headed                Force headed (tmux) mode for steps that opt in.
 *   --headless              Force headless mode (default; CI-friendly).
 *   --update-baselines      Overwrite baselines instead of comparing.
 *   --output <dir>          Where to write reports + artifacts (default: ./tmax-use-out).
 *   --baselines <dir>       Where to read/write baselines (default: ./tmax-use/baselines).
 *   --socket <path>         Reuse a specific daemon socket.
 *   --reporter <term|html|junit|all>  Reporter to enable (default: all).
 *   --no-term               Suppress terminal output.
 *   --help, -h              Show help.
 *
 * Exit codes:
 *   0 — all tests passed (or no targets discovered).
 *   1 — one or more tests failed.
 *   2 — CLI usage error.
 */

import { resolve, isAbsolute } from 'path';
import { runAll, RunnerOptions, SuiteResult } from './runner.ts';
import { printTermReporter } from './reporter-term.ts';
import { writeHtmlReport } from './reporter-html.ts';
import { writeJUnitReport } from './reporter-junit.ts';
import { TaskEither, Either } from '../../src/utils/task-either.ts';

interface CliArgs {
  patterns: string[];
  headed: boolean;
  headless: boolean;
  updateBaselines: boolean;
  outputDir: string;
  baselinesDir: string;
  socketPath?: string;
  reporters: Set<'term' | 'html' | 'junit'>;
  showTerm: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
  const patterns: string[] = [];
  const reporters = new Set<'term' | 'html' | 'junit'>(['term', 'html', 'junit']);
  let headed = false;
  let headless = false;
  let updateBaselines = false;
  let outputDir = './tmax-use-out';
  let baselinesDir = './tmax-use/baselines';
  let socketPath: string | undefined;
  let showTerm = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '-h':
      case '--help':
        return { error: '__help__' };
      case 'test':
        // Subcommand: `tmax-use test [patterns...]`. Recognized but no-op here;
        // remaining args are patterns/options. Allows both `tmax-use test` and
        // `tmax-use <patterns>` styles.
        break;
      case '--headed':
        headed = true;
        break;
      case '--headless':
        headless = true;
        break;
      case '--update-baselines':
      case '--update':
        updateBaselines = true;
        break;
      case '--output':
      case '-o':
        outputDir = argv[++i] ?? '';
        if (!outputDir) return { error: '--output requires a value' };
        break;
      case '--baselines':
        baselinesDir = argv[++i] ?? '';
        if (!baselinesDir) return { error: '--baselines requires a value' };
        break;
      case '--socket':
        socketPath = argv[++i] ?? '';
        if (!socketPath) return { error: '--socket requires a value' };
        break;
      case '--no-term':
        showTerm = false;
        break;
      case '--reporter':
      case '--report': {
        const v = argv[++i];
        if (!v) return { error: `${arg} requires a value` };
        if (v === 'all') {
          reporters.add('term'); reporters.add('html'); reporters.add('junit');
        } else if (v === 'term' || v === 'html' || v === 'junit') {
          reporters.clear();
          reporters.add(v);
        } else {
          return { error: `--reporter value must be one of: term, html, junit, all (got ${v})` };
        }
        break;
      }
      default:
        if (arg.startsWith('--')) return { error: `unknown option: ${arg}` };
        patterns.push(arg);
    }
  }

  if (patterns.length === 0) {
    patterns.push('./tmax-use/playbooks', './tmax-use/tests');
  }

  return {
    patterns, headed, headless, updateBaselines,
    outputDir, baselinesDir, socketPath, reporters, showTerm,
  };
}

function showHelp(): void {
  process.stdout.write(`Usage: tmax-use [patterns...] [options]

Discovers tmax-use playbooks (*.yaml/*.yml) and test files (*.tmax-use.ts) and
runs them under fresh tmax daemons.

Options:
  --headed                Force headed (tmux) mode for opted-in steps.
  --headless              Force headless mode (default; CI-friendly).
  --update-baselines      Overwrite baselines instead of comparing.
  --output <dir>          Where to write reports + artifacts (default: ./tmax-use-out).
  --baselines <dir>       Where to read/write baselines (default: ./tmax-use/baselines).
  --socket <path>         Reuse a specific daemon socket.
  --reporter <term|html|junit|all>  Reporter to enable (default: all).
  --no-term               Suppress terminal output.
  -h, --help              Show this help.

Default patterns: ./tmax-use/playbooks ./tmax-use/tests
`);
}

/** Write all enabled reports. */
function writeReports(suite: SuiteResult, args: CliArgs): Promise<void[]> {
  const tasks: Promise<void>[] = [];
  if (args.reporters.has('html')) {
    tasks.push(writeHtmlReport(suite, args.outputDir, 'tmax-use report').run().then(() => undefined).catch(() => undefined));
  }
  if (args.reporters.has('junit')) {
    tasks.push(writeJUnitReport(suite, args.outputDir).run().then(() => undefined).catch(() => undefined));
  }
  return Promise.all(tasks);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    if (parsed.error === '__help__') {
      showHelp();
      return 0;
    }
    process.stderr.write(`tmax-use: ${parsed.error}\n`);
    process.stderr.write(`Run 'tmax-use --help' for usage.\n`);
    return 2;
  }

  const opts: RunnerOptions = {
    headed: parsed.headed,
    headless: parsed.headless,
    updateBaselines: parsed.updateBaselines,
    outputDir: isAbsolute(parsed.outputDir) ? parsed.outputDir : resolve(process.cwd(), parsed.outputDir),
    baselinesDir: isAbsolute(parsed.baselinesDir) ? parsed.baselinesDir : resolve(process.cwd(), parsed.baselinesDir),
    socketPath: parsed.socketPath,
  };

  const suite = await runAll(parsed.patterns, opts);

  if (parsed.showTerm && parsed.reporters.has('term')) {
    printTermReporter(suite);
  }

  await writeReports(suite, parsed);

  return suite.failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`tmax-use: uncaught error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
