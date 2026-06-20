# tmax-use baselines

Visual baselines live here as `*.html` files. Each baseline is the captured
HTML of a daemon frame (headless `capture` RPC, `format: 'html'`) at the
assertion moment of a `toMatchBaseline()` call.

## Lifecycle

- **Local first run**: missing baselines are auto-created from the captured
  HTML. The next run compares against them.
- **CI**: missing baselines fail with `BaselineMissing`. They must be
  generated locally, reviewed, and committed before CI relies on them.
- **`--update-baselines`** (or `update: true` in `BaselineOptions`):
  overwrites baselines unconditionally. Use this when an intentional change
  invalidates the baseline; review the diff in the resulting commit.

## Diff strategy

Baselines are compared via a zero-dependency HTML tokenizer that preserves
tag names, text content, and `style`/`class` attributes (everything the
project's `ansiToHtml` renderer emits). If either side fails to tokenize,
the comparator falls back to a normalized line-by-line text diff and labels
it as a fallback so the report is honest about which path produced the
mismatch.
