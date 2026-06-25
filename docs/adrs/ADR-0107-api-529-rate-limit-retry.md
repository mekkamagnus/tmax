# API 529 Rate-Limit Retry — Exponential Backoff on LLM Gateway Overload

## Status

Accepted

## Context

The adw pipeline dispatches multiple `claude -p` subprocess calls per stage (build, test-resolve, patch-review audit). When two or more pipelines run concurrently (enabled by SPEC-065 worktree isolation), the LLM gateway (`api.z.ai`) returns HTTP 529 ("service overloaded" / rate limit) after `claude -p`'s own 10 internal retries are exhausted.

Observed on 2026-06-25: SPEC-065 and BUG-20 ran patch-review simultaneously. Both `claude -p` audit calls hit 529 after ~3 min of retries. The result was `is_error: true, api_error_status: 529`. The dispatchers treated this as a fatal error (exit code 2) and failed both stages — blocking both pipelines despite all prior stages (plan, review, build, test) passing.

The 529 is a **transient server-side condition** — the gateway is temporarily overloaded, not permanently rejecting the request. Retrying after a delay succeeds. But the dispatchers had no retry logic at the `runCapture` level; they relied entirely on `claude -p`'s internal retries (which are fast — 10 attempts over ~3 min), and when those exhausted, the stage failed permanently.

## Decision

Add a **dispatcher-level retry wrapper** (`adws/claude-529-retry.ts`) that detects 529 errors in the `claude -p` result and retries with **exponential backoff**:

1. **Detection:** Parse the `claude -p` result for `is_error: true` + `api_error_status: 529`. Also check the tee-file suffix for a structured 529 line (production `runCapture` may return stderr while the structured JSON is only in the tee file).

2. **Backoff schedule:** 30s → 60s → 120s between retries. Three retry attempts (so the total worst-case delay is 30+60+120 = 210s = 3.5 min of backoff, plus the ~3 min `claude -p` internal retry time per attempt = ~13 min worst case).

3. **Scope:** Applied to all three dispatchers that call `claude -p`:
   - `adw-patch-review.ts` — the audit call (where the 529 was first observed)
   - `adw-test.ts` — the resolve calls (resolve subprocesses also hit 529 under concurrent load)
   - `adw-build.ts` — the `/implement` call (the build stage is the heaviest LLM call; 529 here is catastrophic without retry)

4. **Design: `withClaude529Retry(fn, opts)`** — a higher-order function that wraps a `runCapture`-shaped function. It calls the wrapped function, checks the result for 529, and retries if detected. The wrapper is injectable (testable with a mock `sleep` function). It does NOT modify the underlying `runCapture` — it composes around it.

5. **Non-retryable errors:** Only 529 (rate limit / overload) triggers a retry. Other errors (`is_error: true` without `api_error_status: 529`, subprocess crashes, exit code 1) are passed through without retry. This avoids retrying on genuine bugs or malformed prompts.

## Consequences

**Easier:** Concurrent pipelines can run patch-review / build / resolve simultaneously without one failing because the other saturated the gateway. The retry absorbs transient 529s that are the gateway's normal backpressure mechanism. The worst case (3 retries × ~3 min each + 3.5 min backoff = ~13 min) is bounded and far better than a permanent stage failure.

**Harder:** The worst-case wall time for a single stage increases by up to ~13 min (3 retries). For a pipeline that's already running 60+ min, this is acceptable. But if the gateway is persistently overloaded (not transient), all 3 retries fail and the stage fails anyway — the retry just delays the failure by 13 min. The retry does NOT help with persistent outages.

**Why dispatcher-level, not module-level:** The modules (`tester.ts`, `patch-reviewer.ts`, `builder.ts`) return raw `claude -p` results. The dispatcher decides what to do with the result (retry, fail, proceed). Putting the retry in the dispatcher keeps the modules pure and the retry logic centralized in one place (`claude-529-retry.ts`). The dispatcher already knows the context (which stage, which workspace) and can make better retry decisions than a generic module-level wrapper.

**Why not a global rate limiter:** A token-bucket or semaphore limiting concurrent `claude -p` calls across all pipelines would prevent the 529 from happening in the first place. But that requires inter-process coordination (the pipelines run as separate tmux windows / separate Node processes). The retry approach is simpler (per-call, no coordination) and handles the 529 after it happens rather than trying to prevent it. A global rate limiter is a future optimization (RFC-021 Phase 2 territory — the remote-spawn layer could centralize all LLM calls through a single rate-limited gateway client).

**Related:** BUG-18 (the test-stage bug saga that this retry was added to), SPEC-065 (worktree isolation that enabled concurrent pipelines and thus concurrent LLM calls), RFC-021 (remote dispatch — Phase 2's remote-spawn layer would centralize LLM calls and make rate limiting natural).
