# Chore: z.ai/glm API status checker script

## Chore Description

Create a simple bash script that tests whether the z.ai/glm API (the Anthropic-compatible gateway at `api.z.ai` that this project's `claude -p` invocations depend on) is reachable, authenticated, and actually responding to a minimal completion request — and reports per-model latency so it's easy to tell whether the gateway is up vs. a specific model hanging.

Context that shapes the design (from the existing codebase):

- `adws/adws-modules/agent.ts:32` documents that `glm-5.2[1m]` hangs silently on `api.z.ai` (returns nothing, never exits) as of 2026-06-17, while `glm-4.7` and `glm-4.5-air` work. The user's complaint ("sometimes it feels like its dropped") matches this exact failure mode.
- The project's runtime path is `claude -p --model <id>`, which authenticates to the Anthropic-compatible gateway via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`).
- The user's current shell env contains `ANTHROPIC_BASE_URL=https://api.z.zi/api/anthropic`, which is unresolvable (`api.z.zi` is a typo for `api.z.ai`). The script MUST NOT silently inherit a broken value — it should print the URL it's hitting and fail loudly on DNS errors.

A "simple bash script" per the user's words. No external deps beyond `curl` + `jq` (both already relied on elsewhere in the project). Plain bash, `set -euo pipefail`, formatting in the style of `scripts/tmax-tmux-audit.sh`.

## Relevant Files

Use these files to resolve the chore:

- `scripts/tmax-tmux-audit.sh` — the project's existing bash-script style reference: `#!/usr/bin/env bash`, `set -euo pipefail`, `printf` columnar output, `--flag` argument parsing, clear exit codes. The new script should match this shape.
- `adws/adws-modules/agent.ts:24-32` — documents the gateway URL (`api.z.ai`), the pinned model (`glm-5.2[1m]`), and the known-good/known-bad model list (`glm-4.5-air` and `glm-4.7` work; `glm-5.2[1m]` hangs). Source of truth for default model choices in the script.
- `adws/adws-modules/builder.ts:18-26` — confirms `glm-5.1` as the default build model and reinforces that `glm-5.2[1m]` is deliberately avoided. Useful for the `--all-models` sweep list.
- `README.md` — project overview; confirms `scripts/` as the canonical location for dev helper scripts.
- `.env` — where the user's local `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` are set (not committed). Read-only reference; the script must work whether or not these are sourced.

### New Files

- `scripts/zai-api-status.sh` — the new status checker. Bash. Executable (`chmod +x`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Create `scripts/zai-api-status.sh`

- Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Resolve the gateway URL in this priority order, and print which one was picked so the user can spot a bad env value:
  1. `--base-url <url>` flag (if passed)
  2. `$ANTHROPIC_BASE_URL` env var, **only if it resolves** (validate with a `curl --max-time 3 -I` style DNS check; if DNS fails, warn and fall through)
  3. Hardcoded fallback `https://api.z.ai/api/anthropic`
- Resolve the auth token from `$ANTHROPIC_AUTH_TOKEN`, falling back to `$ANTHROPIC_API_KEY`. If neither is set, print an error listing both variable names and exit `2`.
- Define a default test model of `glm-4.5-air` (known-good per `adws/adws-modules/agent.ts:32`). Support:
  - `--model <id>` — override the single model tested
  - `--all-models` — sweep a hardcoded list: `glm-4.5-air glm-4.7 glm-5.1 glm-5.2[1m]` (the four referenced in the codebase)
  - `--timeout <seconds>` — per-request curl timeout, default `15` (generous because the "dropped" symptom is exactly a long silent hang)
  - `--base-url <url>` — described above
  - `--help` / `-h` — short usage text
- Implement three layered checks, run in order, each printing a one-line PASS/FAIL with timing. Stop as soon as a layer fails (no point testing chat completions if DNS is broken):
  1. **Reachability** — `curl -sS -o /dev/null --max-time "$timeout" -w "%{http_code} %{time_total}" -I "$base_url/v1/messages"`. Treat HTTP `000` (curl couldn't connect / DNS / timeout) as FAIL with the curl exit-code explanation. Any HTTP code (even 401/404) means the host is reachable — record that.
  2. **Auth** — send the minimal request from check 3 and inspect the HTTP status. `401`/`403` → auth broken (FAIL with "check $ANTHROPIC_AUTH_TOKEN"). `200` → authed. `404`/`400` → endpoint reachable but path/body wrong (WARN, since it indicates API contract drift rather than downtime).
  3. **Per-model chat completion** — `POST "$base_url/v1/messages"` with body:
     ```json
     {"model":"<id>","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}
     ```
     Headers: `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`. Use `--max-time "$timeout"`. Report PASS only if HTTP is `200` AND `jq -e '.content[0]'` succeeds on the response body. Report FAIL with HTTP code + first 200 chars of body (truncated to avoid leaking full error payloads). Capture and print `%{time_total}` for every model so silent hangs are visible as a near-timeout slow request rather than no output.
- Format output like `scripts/tmax-tmux-audit.sh`: a header row with `printf '%-28s %-10s %-10s %s\n'`, then one row per check/model. Use plain ASCII (`PASS`/`FAIL`/`WARN`) — no emojis, no color (matches the existing script and works in every terminal).
- Exit codes: `0` if every model that ran returned PASS; `1` if any FAIL; `2` for misuse (bad args / missing env).
- Use `curl` (already a project tool per `README.md` §5) and `jq` (already a project tool per `README.md` §5). No new deps.

### Make it executable

- `chmod +x scripts/zai-api-status.sh`.

### Smoke-test the script manually

- Run `./scripts/zai-api-status.sh` against the live gateway and confirm it prints (a) which base URL it picked, (b) the reachability row, (c) the auth row, (d) one chat-completion row for `glm-4.5-air`. Inspect the output for false positives — e.g. a `PASS` when the user's `ANTHROPIC_BASE_URL` is the broken `api.z.zi` value would indicate the DNS-validation fallback isn't working and needs a fix.
- Run `./scripts/zai-api-status.sh --all-models` once to confirm `glm-5.2[1m]` either times out (FAIL, matching the codebase's documented hang) or eventually PASSes — this is the model the user is most likely to be asking "is it dropped?" about.
- Run `./scripts/zai-api-status.sh --help` to confirm usage text is sane.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bash -n scripts/zai-api-status.sh` — bash syntax check; must exit 0 with no output.
- `shellcheck scripts/zai-api-status.sh` — lint in the project's style; must exit 0 (install via `brew install shellcheck` if missing, but the script must pass cleanly once installed).
- `./scripts/zai-api-status.sh --help` — must print usage and exit 0.
- `./scripts/zai-api-status.sh` — must run end-to-end against the live gateway and exit 0 if the gateway is healthy, or exit 1 with a clear per-check FAIL row if it isn't. Either outcome is acceptable for validation; what matters is that the script runs without a bash error and produces the expected three-layer output.
- `./scripts/zai-api-status.sh --all-models` — must run a sweep across `glm-4.5-air`, `glm-4.7`, `glm-5.1`, `glm-5.2[1m]` and print one row per model. Confirms the `--all-models` flag works and surfaces the documented `glm-5.2[1m]` hang as a FAIL row.

## Notes

- The user's shell currently has `ANTHROPIC_BASE_URL=https://api.z.zi/api/anthropic` set, which is a typo (`api.z.zi` doesn't resolve). The script's DNS-validation step is specifically there so this typo is surfaced as a clear "WARN: env var ANTHROPIC_BASE_URL did not resolve, falling back to https://api.z.ai/api/anthropic" message rather than silently making every check FAIL with a confusing DNS error. Recommend the user also fix the typo in their shell rc once the script flags it.
- The script intentionally uses `glm-4.5-air` as the default rather than the project's production `glm-5.2[1m]`, because the purpose of a status check is to ask "is the gateway up at all?" — that question is best answered with a model known to be responsive, then the `--all-models` sweep can layer in the question "is the specific model I care about up?".
- Keep the script under ~120 lines. If it grows past that, the user's "simple bash script" requirement has been violated and the design should be reconsidered rather than expanded.
- The script does NOT need tests under `test/` — it's a dev utility that hits a live external service, which the existing test suite (correctly) avoids. Validation is the manual + syntax-check commands above.
