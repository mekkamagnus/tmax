# RFC-021: Remote adw Dispatch — SSH Offload to a Build Host

**Status:** Proposed
**Created:** 2026-06-23
**Related:** SPEC-065 (worktree isolation — the prerequisite), ADR-0094 (pipeline architecture), `docs/memos/parallel-ai-agents-worktree-overview.md`

## Summary

The adw pipeline runs entirely on a single machine: local tmux, local `claude`/`codex`, local working tree, local `agents/` state. This RFC proposes a **two-phase path to offloading pipeline runs to a remote build host** (e.g. `mekkapi`, a DigitalOcean droplet), so long builds don't tie up the developer's machine and compute can be scaled horizontally.

- **Phase 1 (ssh-wrapped)** — run the *entire* pipeline on the remote host over ssh. Zero code changes; requires the remote to have bun, tmux, claude/codex, and the repo checked out. The developer pushes a branch and SSHes the resume command. Results come back via git fetch.
- **Phase 2 (remote-spawn-layer)** — split the pipeline: orchestrator + working tree stay local; only the LLM subprocesses (`claude -p`, `codex exec`) are dispatched to the remote. A `RemoteDeps` variant of the injected `run`/`runRaw`/`runCapture` shells each LLM call over ssh. Moderate code changes; preserves local observability and keeps the working tree local.

Phase 1 is the pragmatic "works today" option. Phase 2 is the proper architecture for "remote LLM, local tree" — a real feature, not a flag flip. SPEC-065 (worktree isolation) is the prerequisite for both: without per-run branches, there's nothing clean to push to the remote.

## Motivation

Two concrete problems this solves:

1. **Long builds tie up the developer's machine.** A `claude -p /implement` build runs 40-90 min. During that time, the developer's CPU, API rate limits, and tmux session are consumed. Offloading to `mekkapi` frees the local machine for other work (or other pipelines).

2. **Horizontal scaling.** With worktree isolation (SPEC-065), each pipeline run is a branch. Multiple branches can be dispatched to multiple hosts — `mekkapi`, a droplet, a cloud build runner — and developed concurrently. The developer's machine becomes a coordinator, not a bottleneck.

The current architecture makes this impossible: `adw-launch.ts` hardcodes `PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."))` and spawns `tmux new-window` locally. There are zero remote references in the codebase.

## Phase 1: ssh-wrapped (the "works today" option)

### Design

Run the *entire* pipeline on the remote host. The developer's machine is only the launch point + result fetcher.

```
Developer (local)                    Remote (mekkapi)
─────────────────                    ────────────────
git push mekkapi adw/<id>  ──────►   git fetch → branch adw/<id> present
ssh mekkapi '                      cd ~/tmax &&
  bun adws/adw-launch.ts            tmux new-window ...
    --resume <id>'                  └► adw-launch.ts runs locally on mekkapi
                                       plan/review/build/test/patch-review
                                       all execute on mekkapi
                                    agents/<id>/ state lives on mekkapi
                  ◄──────────────  (developer polls via ssh cat, or waits for push-back)
git fetch mekkapi adw/<id>  ◄────── git push origin adw/<id> (or the developer fetches)
```

### What it requires on the remote

- `bun` on PATH
- `tmux` installed
- `claude` and `codex` CLIs on PATH (or pointed at a gateway accessible from the remote)
- The tmax repo checked out at a known path (e.g. `~/tmax`)
- Network access to the LLM gateway (api.z.ai or equivalent)

### What it looks like operationally

```bash
# One-time setup per host:
ssh mekkapi 'git clone <origin> ~/tmax && cd ~/tmax && bun install'

# Per-run:
bun adws/adw-launch.ts "add feature X"   # local: plan creates spec + worktree + branch
git push mekkapi adw/<id>                 # push the branch to the remote
ssh mekkapi 'cd ~/tmax && \
  git fetch && git checkout adw/<id> && \
  bun adws/adw-launch.ts --resume <id>'   # remote: pipeline runs in tmux there

# Poll status from local:
ssh mekkapi 'cat ~/tmax/agents/<id>/adw-state.json'

# Fetch results back:
git fetch mekkapi adw/<id>
git worktree add ../tmax-<id>-result FETCH_HEAD   # inspect/merge the result
```

### Pros

- **Zero code changes.** The pipeline already works if you `cd` into a worktree and run `adw-launch.ts` from there (proven by SPEC-067's manual worktree launch earlier today). Phase 1 is just "do that over ssh."
- **Simple mental model.** The remote is a full build box; the pipeline is unchanged.
- **Full isolation.** The remote has its own tmux, its own `agents/`, its own CPU. No contention with local work.

### Cons

- **Remote must be a fully-configured build box.** bun + tmux + claude + codex + repo + gateway access. Heavy setup for a Pi; fine for a droplet.
- **No local observability.** `tmux attach -t tmax` doesn't reach the remote session without an ssh tunnel. Status checks require `ssh mekkapi 'cat ...'` round-trips.
- **`agents/` state lives on the remote.** It's gitignored, so it doesn't travel with the branch. You poll it over ssh or rsync it back.
- **Result fetch is manual.** The developer must `git fetch` the branch back and inspect/merge it.

### What SPEC-065 adds that makes Phase 1 viable

Without SPEC-065, pushing to the remote means pushing the developer's entire dirty main checkout. With SPEC-065, each run is a clean branch (`adw/<id>`) off main, containing only the spec + the build's committed work. The push is clean and the remote checkout is clean. SPEC-065's `commitSpecToMain` also ensures the spec is on main before the branch is pushed, so the remote sees the spec.

---

## Phase 2: remote-spawn-layer (the proper architecture)

### Design

Split the pipeline: the **orchestrator + working tree stay local**; only the **LLM subprocesses** (`claude -p`, `codex exec`) are dispatched to the remote. A `RemoteDeps` variant of the injected `run`/`runRaw`/`runCapture` shells each LLM call over ssh.

```
Developer (local)                              Remote (mekkapi)
─────────────────                              ────────────────
orchestrator runs locally
  spawnStage("adw-build.ts")
    adw-build.ts runs locally
      deps.run("claude", ["-p", ...])
        → ssh mekkapi 'claude -p ...'  ─────►  claude -p executes on mekkapi
                                               stream-json streams back over ssh stdout
                  ◄──────────────────────────  result line {type:"result",...}
      build parses result locally
      build edits working tree locally
  spawnStage("adw-test.ts")
    bun run test:unit runs locally (fast, no LLM)
```

### What it requires

- `claude` and `codex` on the remote's PATH (or a gateway accessible from the remote)
- ssh key-based auth to the remote (no interactive passwords — the pipeline is non-interactive)
- A `RemoteDeps` module (`adws/adws-modules/remote-exec.ts`) implementing the `run`/`runRaw`/`runCapture` interface over ssh

### The `RemoteDeps` module shape

```ts
// adws/adws-modules/remote-exec.ts
export interface RemoteExecConfig {
  host: string;           // ssh host alias (mekkapi, droplet-1, ...)
  remoteClaude?: string;  // path to claude on remote (default: "claude")
  remoteCodex?: string;   // path to codex on remote (default: "codex")
}

/** Wraps each LLM call as: ssh <host> '<binary> <args>'
 *  The stream-json output flows back over ssh stdout identically to a local
 *  spawn, so the existing tee/parse/heartbeat logic works unchanged. */
export function makeRemoteDeps(config: RemoteExecConfig): Pick<BuilderDeps, "run" | "runRaw" | "runCapture"> {
  // run: ssh <host> 'claude -p --model ... <prompt>'
  // runRaw: same, but returns { ok, exitCode, stdout, stderr }
  // runCapture: same, with tee-to-file on the LOCAL side (the tee file is local)
}
```

The orchestrator and child dispatchers already use dependency injection (`BuilderDeps`, `TesterDeps`, `PatchReviewerDeps`). Swapping `LocalDeps` for `RemoteDeps` is a one-line change at the deps-construction site — no stage code changes.

### What stays local vs. goes remote

| Component | Phase 2 location | Why |
|-----------|-----------------|-----|
| Orchestrator | **Local** | Owns tmux, state, the retry loop — must be observable locally |
| Working tree | **Local** | Build edits files; keeping the tree local avoids sync round-trips |
| `agents/` state | **Local** | Gitignored; stays with the local orchestrator |
| `bun run test:unit` / `test:tmax-use` | **Local** | Tests run against the local tree; no LLM involved |
| `claude -p /implement` (build) | **Remote** | The LLM call — the expensive, offloadable part |
| `codex exec` (spec-review) | **Remote** | The LLM call |
| `claude -p` (patch-review audit) | **Remote** | The LLM call |
| `claude -p` (test resolve) | **Remote** | The LLM call |

### How the developer selects it

```bash
# Local (default, today's behavior):
bun adws/adw-launch.ts docs/specs/SPEC-067.md

# Remote LLM, local tree (Phase 2):
bun adws/adw-launch.ts --remote-llm mekkapi docs/specs/SPEC-067.md
```

`--remote-llm <host>` tells the orchestrator to construct `RemoteDeps` instead of `LocalDeps` for the stage subprocesses. The orchestrator itself, the working tree, and the test stages all stay local. Only the `claude`/`codex` calls round-trip over ssh.

### Pros

- **Local observability preserved.** tmux, `agents/`, heartbeat stderr — all local. The developer sees everything in real time.
- **Working tree stays local.** No rsync, no sync conflicts, no push/fetch dance. The build edits the local worktree directly.
- **Tests run locally.** `bun run test:unit` and `test:tmax-use` don't touch the remote — they're fast and tree-local.
- **Composable with SPEC-065 worktrees.** Each remote-LLM run is still a worktree-isolated branch. Multiple `--remote-llm` runs can target different hosts concurrently.

### Cons

- **ssh per LLM call.** Each `claude -p` / `codex exec` invocation opens an ssh connection. For a build with 50+ tool calls inside a single `claude -p`, this is one ssh session (not 50) — acceptable. But a pipeline with many resolve iterations opens multiple sessions.
- **ssh latency on every call.** ssh connection setup adds ~200-500ms per LLM call. For a 60-min build with 1 long `claude -p` call, negligible. For a test stage with 5 resolve iterations, ~2.5s overhead — acceptable.
- **Remote must have `claude`/`codex` installed.** Lighter than Phase 1 (no bun/tmux/repo needed), but the LLM CLIs must be on the remote's PATH and authenticated to the gateway.
- **Stream-json over ssh must be reliable.** A dropped ssh connection mid-`claude -p` produces a truncated stream-json that the parser must handle gracefully (the existing `parseSkillResult` already handles truncation — verified during BUG-16 debugging).
- **Moderate code changes.** A new module (`remote-exec.ts`), a `--remote-llm` flag on the launcher, and a deps-swap in the orchestrator. Not a flag flip — a real feature.

---

## Phase comparison

| Aspect | Phase 1 (ssh-wrapped) | Phase 2 (remote-spawn) |
|--------|----------------------|----------------------|
| Code changes | **Zero** | New module + flag + deps-swap |
| Remote requirements | Full build box (bun, tmux, claude, codex, repo) | LLM CLIs only (claude, codex) |
| Working tree | Remote | Local |
| `agents/` state | Remote | Local |
| Observability | Requires ssh to see tmux/state | Local (unchanged from today) |
| Test runs | Remote | Local |
| Result fetch | Manual `git fetch` + worktree inspect | Not needed (tree is local) |
| Concurrent runs | One per remote host | Many per remote host (shared) |
| Setup effort | High (configure the remote fully) | Medium (install LLM CLIs on remote) |
| When to use | "I have a spare machine, run the whole thing there" | "Offload just the LLM calls, keep everything local" |

## Recommendation

**Phase 1 first, Phase 2 when the pain is felt.**

Phase 1 is available *today* with SPEC-065's worktree isolation — no code changes, just ssh + git. It's the right starting point for "run SPEC-067 on mekkapi while I keep working locally." If the lack of local observability becomes painful (polling ssh for status is annoying), that's the signal to invest in Phase 2.

Phase 2 is the architecturally correct long-term answer — it preserves local observability and keeps the working tree local. But it's a real feature with a new module, ssh reliability concerns, and a deps-swap. Build it when there's a concrete need (e.g. "I want to run 5 pipelines concurrently, each offloading LLM calls to a different host, all observable from one local terminal").

## Out of scope

- **A web dashboard / API server.** Neither phase adds a server. Observability in Phase 2 is local stderr + `agents/` files, same as today. A dashboard is a separate RFC.
- **Container-based dispatch (Docker/K8s).** Both phases assume bare-metal or VM hosts reachable via ssh. Container orchestration is a different problem.
- **Automatic host selection / load balancing.** Both phases use an explicit `--remote <host>` or `--remote-llm <host>` flag. Auto-selecting the least-loaded host is a future enhancement.
- **Bidirectional sync of `agents/` state.** Phase 1 polls the remote; Phase 2 keeps it local. A real-time sync mechanism (Mutagen, rsync daemon) is out of scope.

## Open questions

1. **Does `mekkapi` (the Pi) have enough CPU/RAM for a `claude -p` call?** The LLM itself runs on the gateway (api.z.ai); `claude -p` is a thin client that streams. So CPU/RAM requirements are low — a Pi 4 should handle it. Needs verification before relying on Phase 2.
2. **ssh connection reuse.** Should Phase 2 use a persistent ssh connection (ControlMaster) to avoid per-call connection setup? Probably yes for performance, but it adds complexity (connection lifecycle management).
3. **Gateway authentication on the remote.** If `claude`/`codex` read API keys from `~/.config/` or env vars, those must be present on the remote. How are they provisioned? (Manual for now; a setup script later.)
