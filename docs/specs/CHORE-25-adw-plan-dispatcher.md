# Chore: `adws/adw-plan.ts` — description → spec dispatcher

## Chore Description

Create a self-contained Bun TypeScript script at `adws/adw-plan.ts` that takes a free-text plan description, classifies it as `feature` | `bug` | `chore`, and then uses the corresponding skill to create a spec document in `docs/specs/`.

At the very start, the script mints an **`adw-id`** — a stable per-run identifier — and every step below is recorded to an agent-state log at `./agents/{adw-id}/adw-state.json`. Concretely, for the input:

```
bun adws/adw-plan.ts "the cursor disappears when splitting a wide unicode line"
```

the script will:

1. **Mint `adw-id`** = the first 10 characters of a ULID (the timestamp portion: ms-since-epoch in Crockford Base32). This is computable with zero dependencies. Example: `01KVA559H2`.
2. **Create** `./agents/{adw-id}/adw-state.json` (`{ adw_id, events: [] }`) and record a `{"ts","event":"start","description"}` event.
3. **Classify** the description → `bug`. Record `{"ts","event":"classify","type","reason"}`.
4. **Dispatch** — invoke the matching skill (`/bug`) headlessly via the `claude` CLI, passing the description as the skill argument. **Tee the planner's streamed output to `./agents/{adw-id}/planner/raw-output.jsonl`.** Record `{"ts","event":"dispatch","skill","status":"ok|err", ...}`.
5. The skill (per its `SKILL.md`) computes the correct `BUG-##-*.md` filename and writes a populated plan to `docs/specs/`.
6. **Record** `{"ts","event":"result","spec_path"}` in the state file. **Print `<adw-id>` then the spec path** to stdout (see stdout discipline below).

The script is a thin, deterministic dispatcher. All classification intelligence lives in the LLM (via `claude -p`); all spec-formatting intelligence lives in the skills (per their `Plan Format`). The script owns only: argv parsing, `adw-id` minting, the classify call, the dispatch call, state-file event recording, planner-output capture, and exit-code/error reporting.

### Design decisions (locked from the planning conversation)

- **Classifier = LLM via headless CLI.** The script shells out to `claude -p` with a classify prompt and parses a structured (`json`) response. No keyword heuristics.
- **Spec creation = shell out to `claude -p` running the skill.** The script invokes `claude -p '/bug "<desc>"'` (or `/feature`, `/chore`). The skill runs end-to-end and writes the doc. The script does **not** duplicate the skills' numbering or template logic.
- **Single external dependency: the `claude` CLI** (v2.1.153 confirmed on this machine at `/Users/mekael/.local/bin/claude`). It supports `-p/--print` headless mode, `--output-format json`, and resolves skills via `/skill-name`.
- **`adw-id` = first 10 chars of a ULID.** This is the ULID timestamp portion (ms-since-epoch as 10 chars of Crockford Base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`). It is purely time-derived, so it needs **no dependencies** and no randomness — consistent with the project's "Zero external dependencies" rule. It is the per-run key under which agent state is tracked.
- **Agent state tracked at `./agents/{adw-id}/adw-state.json`.** One JSON file per run (`{ adw_id, events: [...] }`) holding the lifecycle events (`start`, `classify`, `dispatch`, `result`, `error`). The planner agent's raw streamed output is captured separately at `./agents/{adw-id}/planner/raw-output.jsonl`. The `agents/` directory is machine state (like `.spec-loop/`, `.patch-reviews/`) and is gitignored.

## Relevant Files

Use these files to resolve the chore:

### New Files

- **`adws/adw-plan.ts`** — The dispatcher script (the deliverable). Self-contained: no imports beyond Node/Bun built-ins (`child_process`, `process`, `fs`/`path` for state-file read/write + dir creation). Shebang `#!/usr/bin/env bun`. Single file, ~220–280 lines (grew to cover `adw-id`, state logging, and planner-output capture).

### New runtime artifacts (created per run, gitignored)

- **`agents/{adw-id}/adw-state.json`** — The dispatcher's per-run state: a single JSON object `{ adw_id, events: [...] }` holding the lifecycle events (`start`, `classify`, `dispatch`, `result`, `error`). Rewritten in place on each event.
- **`agents/{adw-id}/planner/raw-output.jsonl`** — The verbatim streamed output of the planner `claude -p` call (the `/skill` dispatch in Task 5), captured via `--output-format stream-json`: one JSON message per line (system/assistant/result). This is the raw evidence of what the planner agent did; `adw-state.json` is the dispatcher's summary of it.
- The `agents/` directory is machine state (same convention as `.spec-loop/`, `.patch-reviews/` in this repo). **`.gitignore` must gain an `agents/` line** so none of it is committed.

### Existing Files to Read (reference, not modify)

- **`adws/adw-run-e2e.ts`** — The established house-style precedent for an `adws/*.ts` script: shebang, `PROJECT_ROOT` via `realpathSync(import.meta.dir + "/..")`, functional `Either`-returning shell-out helpers (`spawn` + capture), no external deps. Match its conventions exactly for the new script. Note in particular its pattern for capturing subprocess stdout cleanly and reporting errors.
- **`.zcode/skills/{feature,bug,chore}/SKILL.md`** — The skills the script dispatches to. The script invokes them as `/feature`, `/bug`, `/chore` (their declared `name:`), passing the description as the argument. The script does **not** read or parse these files; it relies on the skill's own `$ARGUMENTS` substitution.
- **`bin/tmax`** and **`bin/trt`** — Bash/bun launcher conventions for how scripts in this repo are structured and invoked from the project root. The new script is invoked from the project root (same as `bun adws/adw-run-e2e.ts`).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Scaffold `adws/adw-plan.ts` with argv parsing and `PROJECT_ROOT`

Create `adws/adw-plan.ts`. Start with the shebang, imports, and `PROJECT_ROOT` resolution, copying the established convention from `adws/adw-run-e2e.ts`:

```ts
#!/usr/bin/env bun
/**
 * adw-plan.ts — description → spec dispatcher.
 *
 * Takes a free-text plan description, classifies it (feature | bug | chore) via
 * the claude CLI in headless mode, then invokes the matching skill (/feature,
 * /bug, /chore) headlessly so the skill creates the spec doc in docs/specs/.
 *
 * Each run gets an adw-id = first 10 chars of a ULID (the timestamp portion),
 * and the run's lifecycle (start/classify/dispatch/result/error) is recorded in
 * ./agents/{adw-id}/adw-state.json. The planner agent's raw streamed output is
 * captured at ./agents/{adw-id}/planner/raw-output.jsonl.
 *
 *   bun adws/adw-plan.ts "<description>"
 *   bun adws/adw-plan.ts --feature "<description>"   # skip classifier
 *   bun adws/adw-plan.ts --bug "<description>"
 *   bun adws/adw-plan.ts --chore "<description>"
 *
 * Single external dependency: the `claude` CLI (v2.x), resolved from PATH.
 * Exit codes: 0 = spec created (adw-id + path printed to stdout); 1 = usage
 * error; 2 = classification/dispatch failure (message on stderr; the failure
 * is still recorded in the run's adw-state.json before exit).
 */
import { spawn } from "child_process";
import { realpathSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
```

- Verify: `bun adws/adw-plan.ts` (no args) prints a usage message to stderr and exits 1.
- Verify: `bun adws/adw-plan.ts --help` prints the usage block from the header comment and exits 0.

### Task 2 — Implement `adwId()` and the `agents/{adw-id}/adw-state.json` log

**`adwId()`** — mint the id from the current time. No dependencies: the ULID timestamp is ms-since-epoch encoded as 10 chars of Crockford Base32.

```ts
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function adwId(): string {
  // ULID timestamp portion: 48-bit ms-since-epoch → 10 chars Crockford Base32.
  let ms = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[ms & 31] + out;
    ms = Math.floor(ms / 32);
  }
  return out; // e.g. "01KVA559H2"
}
```

**State log** — a single JSON file per run holding an `events` array; the whole file is rewritten on each event. The dir `agents/{adw-id}/` is created lazily on first write.

```ts
function logState(adwId: string, event: Record<string, unknown>): void {
  // Single JSON object { adw_id, events: [...] }. Rewrite the whole file on
  // each call (read → push → write). Every event carries ts + its discriminator.
  const dir = join(AGENTS_DIR, adwId);
  const file = join(dir, "adw-state.json");
  mkdirSync(dir, { recursive: true });
  let state: { adw_id: string; events: unknown[] };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    state = { adw_id: adwId, events: [] };
  }
  state.events.push({ ts: new Date().toISOString(), ...event });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}
```

Lifecycle events the script emits (each is one element pushed onto `events`):
- `{"event":"start","description":<desc>}` — once, immediately after `adwId()`.
- `{"event":"classify","type":<t>,"reason":<r>}` — after a successful classify (skipped when `--feature/--bug/--chore` is passed).
- `{"event":"dispatch","skill":<name>,"status":"ok"|"err","detail":<...>}` — after the `claude -p '/skill'` call.
- `{"event":"result","spec_path":<path>}` — on success, the last event.
- `{"event":"error","stage":<stage>,"message":<msg>}` — on any failure, recorded before the exit-2.

- Verify: a tiny inline check — `adwId()` returns a 10-char string, all chars ∈ Crockford alphabet, and decodes back to within ~1s of `Date.now()` (the timestamp is ms-precision). A throwaway script or `bun -e` one-liner suffices.
- Verify: two `logState` calls leave `agents/<id>/adw-state.json` as a single JSON object whose `events` array has length 2 and each element parses as part of the whole (`jq '.events | length' agents/<id>/adw-state.json` → `2`).

### Task 3 — Implement a `run(cmd, args, opts) → Either<string, string>` subprocess helper

Port the shell-out pattern from `adws/adw-run-e2e.ts`: a small helper that spawns a process, captures stdout/stderr, and returns `Either` (left = stderr/exit-failure message, right = trimmed stdout). Do **not** throw; return `Left` on non-zero exit. Keep it minimal — only what classify + dispatch need.

```ts
type Either<L, R> = { ok: true; value: R } | { ok: false; error: L };

function run(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string,string> }): Promise<Either<string, string>> { /* ... */ }
```

- Verify: `await run("echo", ["hi"])` returns `{ ok: true, value: "hi" }`.
- Verify: `await run("false", [])` returns `{ ok: false, error: <non-empty> }`.

**`runCapture` variant.** The dispatcher (Task 5) needs to *tee* the planner's streamed stdout to a file while also collecting it. Add `runCapture(cmd, args, { cwd, teeTo })` — same shape as `run` but writes every stdout line to `teeTo` (via `appendFileSync`) as it arrives and returns the collected stdout in the `Either`. Defined here alongside `run` since they share the spawn/capture plumbing.

### Task 4 — Implement the classifier: `classify(adwId, description) → Either<string, "feature"|"bug"|"chore">`

Shell out to `claude -p` with `--output-format json` and a strict classify prompt. Parse the JSON response and validate the `type` field is one of the three allowed values. On success, **record a `classify` event** in the run's state log (Task 2).

The prompt must:
- State the three categories with the trigger vocabulary (matching the skills' own `description:` frontmatter):
  - **bug** — broken, fix, error, crash, defect, unexpected, not working.
  - **feature** — new functionality, add capability, build, extend, enhancement.
  - **chore** — cleanup, refactor, maintenance, dependency update, reorganize, migrate, config.
- Demand a single-line JSON object: `{"type": "feature" | "bug" | "chore", "reason": "<one short clause>"}`.
- Instruct: output ONLY the JSON, no prose, no markdown fence.

Parse defensively: if the JSON is malformed or `type` is not one of the three, record an `error` event (`stage:"classify"`) and return `Left` with the raw model output for debugging — do **not** guess a default.

```ts
const CLAUDE = "claude";
const CLASSIFY_PROMPT = (desc: string) => `...${desc}...`;  // as above

async function classify(adwId: string, desc: string): Promise<Either<string, "feature"|"bug"|"chore">> {
  const res = await run(CLAUDE, ["-p", "--output-format", "json", CLASSIFY_PROMPT(desc)], { cwd: PROJECT_ROOT });
  if (!res.ok) {
    logState(adwId, { event: "error", stage: "classify", message: res.error });
    return res;
  }
  // JSON.parse, validate .type ∈ {feature,bug,chore}
  //   on bad shape: logState(adwId, { event:"error", stage:"classify", message:<raw> }); return Left(<raw>)
  //   on good shape: logState(adwId, { event:"classify", type, reason }); return Right(type)
}
```

- Verify (manual, one of each): run the classifier against a clearly-buggy description ("X crashes when Y"), a clearly-feature one ("add a minimap"), and a clearly-chore one ("bump deps and run formatter"); confirm each returns the right branch **and** that each run's `agents/<id>/adw-state.json` contains a `start` line followed by a `classify` line with the correct `type`. Record the three invocations + the three jsonl files (or their relevant lines) as the acceptance evidence for this task.

### Task 5 — Implement the dispatcher: `dispatch(adwId, type, description) → Either<string, string>`

Shell out to `claude -p` invoking the matching skill as `/feature`, `/bug`, or `/chore`, passing the description as the skill argument. The skill writes the spec doc. **Capture the planner's raw streamed output to `agents/{adw-id}/planner/raw-output.jsonl`**, then locate the created file (see note below) and emit `dispatch` + `result` events to the state log. On failure, emit a `dispatch`/`error` event.

```ts
const SKILL_BY_TYPE = { feature: "feature", bug: "bug", chore: "chore" } as const;

async function dispatch(adwId: string, type: "feature"|"bug"|"chore", desc: string): Promise<Either<string, string>> {
  const skill = SKILL_BY_TYPE[type];
  const before = snapshotSpecsDir();                 // set of filenames before
  // Stream-json output → one JSON object per line on the planner's stdout.
  // We tee every line to agents/{adw-id}/planner/raw-output.jsonl (raw capture)
  // AND collect them so we can inspect the final assistant message if needed.
  const plannerDir = join(AGENTS_DIR, adwId, "planner");
  mkdirSync(plannerDir, { recursive: true });
  const plannerLog = join(plannerDir, "raw-output.jsonl");
  const res = await runCapture(
    CLAUDE, ["-p", "--output-format", "stream-json", `/${skill} ${desc}`],
    { cwd: PROJECT_ROOT, teeTo: plannerLog },
  );
  if (!res.ok) {
    logState(adwId, { event: "dispatch", skill, status: "err", detail: res.error });
    logState(adwId, { event: "error", stage: "dispatch", message: res.error });
    return res;
  }
  const created = diffSpecsDir(before);              // new file = the skill's output
  if (!created) {
    const msg = "skill ran but no new spec file appeared in docs/specs/";
    logState(adwId, { event: "dispatch", skill, status: "err", detail: msg });
    logState(adwId, { event: "error", stage: "dispatch", message: msg });
    return { ok: false, error: msg };
  }
  logState(adwId, { event: "dispatch", skill, status: "ok", detail: created });
  logState(adwId, { event: "result", spec_path: created });
  return { ok: true, value: created };
}
```

**`runCapture`** is a variant of the Task 3 `run` helper: it spawns the process, writes every stdout line to `teeTo` (the planner log) as well as collecting it, and returns the same `Either`. The planner log is a verbatim, line-for-line copy of `claude --output-format stream-json`'s output — one JSON message per line (system/assistant/result messages), untouched by the script. This is the raw evidence of what the planner agent did; `adw-state.json` is the dispatcher's summary of it.

Implementation note for locating the created file: snapshot the set of `docs/specs/{SPEC,BUG,CHORE}-*.md` filenames **before** dispatch, then after dispatch take the set difference — the new file is the one the skill just wrote. This avoids parsing the planner log. `snapshotSpecsDir()` / `diffSpecsDir(before)` are small `fs.readdirSync` helpers local to the script.

- Verify: against a trivial chore description (e.g. "rename the `foo` helper to `bar`"), confirm `dispatch("<id>", "chore", ...)` returns `Right("<path>/docs/specs/CHORE-##-rename-foo-to-bar.md")`, the file exists on disk, **`agents/<id>/planner/raw-output.jsonl` exists and is non-empty with each line valid JSON** (`jq -c . agents/<id>/planner/raw-output.jsonl` succeeds per line), **and** the run's `adw-state.json` ends its `events` array with `dispatch{status:ok}` then `result{spec_path}`. (This test creates a real spec — delete it afterward, or use a throwaway slug and clean up.)

### Task 6 — Wire `main()`: mint adw-id → log start → classify (or skip) → dispatch → print → exit

- **First thing `main` does:** `const id = adwId();` then `logState(id, { event: "start", description: desc });`. This guarantees every run — even a usage error handled before this point would have exited already — produces a state file with a `start` line.
- If `--feature` / `--bug` / `--chore` is passed, skip the classifier and go straight to `dispatch(id, type, desc)`.
- Otherwise, `await classify(id, desc)`. On `Left`, print the error to stderr and `exit 2` (the `error` event was already recorded inside `classify`). On `Right`, print the classified type + the LLM's reason to stderr as a progress line (`adw-plan: classified as bug (crash/error vocabulary) → /bug`), then `await dispatch(id, type, desc)`.
- On dispatch `Right`, print **`<adw-id> <spec-path>`** (two space-separated tokens) to stdout — the id first so downstream tooling can locate `agents/{adw-id}/adw-state.json` from the printed line. Exit 0.
- On dispatch `Left`, print to stderr, exit 2.

Keep stdout clean: **only the final `<adw-id> <spec-path>` line** on success. All diagnostics to stderr.

- Verify: `bun adws/adw-plan.ts --chore "tidy up the demos folder"` prints exactly one line (an `adw-id` token then a `docs/specs/CHORE-##-*.md` path) to stdout, that file exists, and `agents/<that adw-id>/adw-state.json` exists with `start`, `dispatch`, `result` lines.

### Task 7 — Make the script executable, gitignore `agents/`, and add a usage guard

- `chmod +x adws/adw-plan.ts`.
- **Add `agents/` to `.gitignore`** (alongside the existing `.spec-loop/` and `.patch-reviews/` lines). The state logs are machine state and must never be committed.
- Guard at startup: confirm `claude` is resolvable on PATH (e.g. `await run("command", ["-v", "claude"])` or a `which`-equivalent). If missing, print a clear error naming the dependency and exit 1. This guard runs **before** `adwId()`/`start`-log so a missing-dependency run does not litter an empty `agents/<id>/` dir.
- Verify: temporarily `PATH=/usr/bin:/bin bun adws/adw-plan.ts "x"` prints the dependency error and exits 1 **and** leaves no `agents/` directory behind (do this in a subshell so you don't lose your real PATH).

### Task 8 — Run `Validation Commands`

Run every command in the Validation Commands section. All must pass with zero errors.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun adws/adw-plan.ts` — prints usage to stderr, exits 1.
- `bun adws/adw-plan.ts --help` — prints the usage block, exits 0.
- `bun adws/adw-plan.ts --chore "scratch adw-plan smoke test"` — prints exactly one line `<adw-id> <docs/specs/CHORE-##-*.md path>` to stdout; **the adw-id is 10 chars, all in Crockford Base32**; the spec file exists; **`agents/<adw-id>/adw-state.json` is a single valid JSON object whose `events` array contains entries with `event` values `start`, `dispatch` (`status:ok`), and `result`** (`jq -e '.events | map(.event) | ["start","dispatch","result"] — index' agents/<adw-id>/adw-state.json` succeeds, or visually confirm with `jq '.events[].event'`); **`agents/<adw-id>/planner/raw-output.jsonl` exists, is non-empty, and each line is valid JSON** (`jq -c . agents/<adw-id>/planner/raw-output.jsonl` succeeds per line). **Then delete the scratch spec.**
- `bun adws/adw-plan.ts "the editor crashes when pressing C-c in insert mode"` — end-to-end: classifier returns `bug`, dispatches `/bug`, prints `<adw-id> <docs/specs/BUG-##-*.md path>`; file exists; **`adw-state.json`'s `events` array contains `start`, `classify` (`type:bug`), `dispatch` (`status:ok`), `result`**; **`planner/raw-output.jsonl` exists and is non-empty**. **Then delete the scratch spec.**
- `PATH=/usr/bin:/bin bun adws/adw-plan.ts "x"` — prints the missing-`claude` dependency error to stderr, exits 1, **and leaves no `agents/` directory behind** (run in a subshell; do not export this PATH).
- `grep -nE '^agents/$|^agents/' .gitignore` — confirms the `agents/` line is present (the guard for not committing machine state).
- `bun run typecheck` — zero TypeScript errors across the project (the new script must typecheck clean; if it isn't covered by the src/test tsconfigs, run `bunx tsc --noEmit adws/adw-plan.ts` directly and confirm clean).

## Notes

**Why `adw-id` = ULID timestamp (first 10 chars), not a full ULID or UUID.** Three reasons: (1) it's computable from `Date.now()` with ~10 lines and **zero dependencies**, honoring the project's "Zero external dependencies" rule; (2) the timestamp portion is monotonically non-decreasing, so ids sort chronologically — convenient for finding "the most recent run" (`ls agents/ | sort | tail`); (3) 10 Crockford chars is what the user asked for. **Caveat:** because only the timestamp is used (no random suffix), two runs started within the same millisecond collide on the same id. This is acceptable for an interactive, one-at-a-time dispatcher; if batch use ever appears, add the 16-char random suffix then.

**Why `adw-state.json` is a single JSON object (not JSON-Lines append).** The state file is small (a handful of lifecycle events per run) and always read whole by any consumer (the human, or a later inspect step). A single `{ adw_id, events: [...] }` object is trivially inspected with one `jq '.'` call and renders cleanly in an editor. The whole file is rewritten on each event — a non-issue at this event volume. (The planner's much larger streamed output is kept separately as JSON-Lines — see next note.)

**Two files: `adw-state.json` (summary) vs `planner/raw-output.jsonl` (raw).** They serve different readers. `adw-state.json` is the dispatcher's own ledger — short, structured, one entry per lifecycle transition, easy to scan. `planner/raw-output.jsonl` is the verbatim `claude --output-format stream-json` stream of the planner agent — every system/assistant/result message, unmodified, one per line. The planner log is what you reach for to answer "what did the planner actually do/say?"; the state file answers "what happened at the dispatcher level?". Keeping the raw stream as JSON-Lines (not a single object) is deliberate: stream-json emits incrementally, and teeing line-by-line as they arrive means the planner's output lands on disk even if the process is killed mid-run.

**stdout shape change (breaking).** The earlier draft printed only the spec path. This revision prints `<adw-id> <spec-path>` so a consumer of stdout can locate the agent-state log (`agents/<adw-id>/adw-state.json`) from the printed line alone. This trades a little pipe simplicity (consumers now split on the first space) for observability. Flagged here so implementers and downstream scripts (`xargs`, orchestrators) parse both tokens.

**Why two `claude -p` calls (classify, then dispatch) instead of one.** Keeping them separate means the classifier can be unit-tested, bypassed via `--feature/--bug/--chore`, and swapped (for keyword heuristics or a different LLM) without touching dispatch. One combined call would couple two concerns and make failures harder to diagnose. Both calls are recorded as separate `dispatch`/`classify` events in the state log.

**Why snapshot the `docs/specs/` dir to locate the created file, instead of parsing skill output.** The skills' output is free-form model prose with no contract about mentioning the filename. The skills *do* deterministically write to `docs/specs/{SPEC,BUG,CHORE}-##-*.md` (enforced by their `next_*.py` + `validate_*_name.py` hook). Set-difference on that directory is the robust contract. The before/after snapshot is taken inside `dispatch` (Task 5).

**Why `claude` and not `codex`.** Both are on PATH on this machine, but the project's skill loader is the ZCode/Claude-Code `SKILL.md` mechanism (`.zcode/skills/` + `.claude/skills/`), and `/skill-name` resolution is a Claude-Code feature. `codex` does not resolve these skills. If a headless `zcode` CLI lands later, the `CLAUDE` constant is a single swap point.

**Skills resolve from `.zcode/skills/` and `.claude/skills/`.** Both directories exist in this repo; the four planning skills (`feature`, `bug`, `chore`, `implement`) were just copied/patched into `.zcode/skills/` in the preceding task. `claude -p` invoked from `PROJECT_ROOT` will resolve `/bug` etc. against these. No path wiring is needed in the script.

**Not in scope (explicit non-goals):**
- Parallel multi-skill dispatch, batching, or queuing.
- Re-classification / confidence thresholds / "unsure" buckets (the classifier must always pick one of the three; ambiguous input defaults to the LLM's best guess).
- Editing or validating the spec content after creation (that's the `tmax-patch-review` skill's job, downstream).
- A test file for `adw-plan.ts`. The script shells out to a live LLM, so it is validated by the manual end-to-end commands above, not by `bun test`. If deterministic unit coverage is later wanted, the `run()` and `classify()`-parsing helpers are the testable seams; the `claude` call itself would be mocked.

**Risk: LLM non-determinism.** The classifier may occasionally misclassify ambiguous descriptions (e.g. "refactor the bug where…"). This is accepted and mitigated by (a) the `--feature/--bug/--chore` override flags and (b) the LLM's `reason` field printed to stderr so misclassifications are visible and correctable.
```
