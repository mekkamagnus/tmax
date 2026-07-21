/**
 * pipeline.ts — CHORE-44 Change 8: generic pipeline runner.
 *
 * One typed driver for the three pipeline variants:
 *
 *   - 2-stage: `plan → review`              (adw-plan-reviewspec.ts)
 *   - 3-stage: `plan → review → build`      (adw-plan-reviewspec-build.ts)
 *   - 5-stage: `plan → review → build → test → patch-review` (adw-plan-review-build-patch.ts)
 *
 * All variants execute child stages through `runConfiguredStage`. The linear
 * variants compose it in `runLinearPipeline`; the five-stage variant supplies
 * worktree, heartbeat, goal, and retry configuration around the same runner.
 *
 * The descriptor type carries everything `runLinearPipeline` needs to drive
 * each stage generically: the stage's name (for state/events), the human
 * label (for stderr progress), the runner that actually invokes the work
 * (injected so tests can mock without spawning subprocesses), the predicate
 * that decides whether to skip this stage on resume, and the event payload
 * written on stage-complete.
 *
 * CLI behavior is preserved exactly: orchestrator scripts stay thin CLI
 * adapters that parse argv, build the descriptor list, and delegate.
 */
import { Either } from "../../src/utils/task-either.ts";
import {
  adwId,
  appendEvent,
  writeState,
  spawnStage,
  tokensOf,
  type WorkspaceState,
} from "./dispatcher-runtime.ts";

// ---------------------------------------------------------------------------
// Stage + pipeline types
// ---------------------------------------------------------------------------

/**
 * Lightweight declarative description of one pipeline stage, without the
 * execution hooks. Used by orchestrators whose `runPipeline` body is too
 * custom to delegate to `runLinearPipeline` (currently the 5-stage), so they
 * can still declare their shape in the same vocabulary the linear variants
 * use. AC8.2: every pipeline variant is a CONFIGURATION — this is the
 * minimal config type for the non-linear ones.
 */
export interface PipelineStageInfo<S extends string> {
  /** Stage identifier written to events/state. */
  readonly name: S;
  /** Human-readable label used in stderr/error messages. */
  readonly label: string;
  /** Child script file name (e.g. "adw-plan.ts"). */
  readonly script: string;
  /** Agent subdir this stage writes its events under (e.g. "planner"). */
  readonly agentDir: string;
}

export interface ConfiguredStageRun<S extends string, R> {
  readonly pipelineName: string;
  readonly position: string;
  readonly stage: PipelineStageInfo<S>;
  readonly suffix?: string;
  readonly run: () => Promise<Either<string, R>>;
}

/**
 * Execute one configured stage with the canonical progress/error contract.
 * Pipeline variants own state/checkpoint policy, while this runner owns the
 * actual stage transition and human-visible progress format.
 */
export async function runConfiguredStage<S extends string, R>(
  config: ConfiguredStageRun<S, R>,
): Promise<Either<string, R>> {
  const suffix = config.suffix ? ` ${config.suffix}` : "";
  process.stderr.write(
    `${config.pipelineName}: stage ${config.position} — ${config.stage.label}${suffix}\n`,
  );
  return config.run();
}

/**
 * Per-stage descriptor. `S` is the orchestrator's `StageName` string union
 * (e.g. `"plan" | "review" | "build"`), which lets each orchestrator keep its
 * own strongly-typed stage identifier.
 */
export interface StageDescriptor<S extends string, Deps> {
  /** Stage identifier written to events/state (`plan`, `review`, `build`, ...). */
  readonly name: S;
  /**
   * Position label for stderr progress (e.g. "1/3", "2/3"). Combined with
   * `scriptName` to form the stderr line `${pipelineName}: stage ${posLabel} — ${scriptName}`.
   */
  readonly posLabel: string;
  /**
   * The child script name used in human messages (stderr progress + failure
   * error messages). The pre-refactor orchestrators used "plan", "spec-review",
   * "build", "test", "patch-review" here — NOT the StageName union member
   * (which is "review"). Pinned by tests like
   * `result.left.toContain("spec-review stage failed")`.
   */
  readonly scriptName: string;
  /**
   * Run the stage. Receives the orchestrator's injected deps and the runtime
   * context, returns Either<errorMsg, stage-result>. On Left the pipeline
   * finalizes as failed; on Right the pipeline records the stage-complete
   * event + any returned state mutation.
   */
  run: (deps: Deps, ctx: PipelineContext<S>) => Promise<Either<string, unknown>>;
  /**
   * Decide whether this stage should run, given resume state + args. Mirrors
   * the per-stage `shouldRunX` predicate in the pre-refactor orchestrators.
   * Examples:
   *   - plan:    `(args, resume) => !args.specPath && (!resume || resume.resumeFrom === "plan")`
   *   - review:  `(args, resume) => !resume || resume.resumeFrom === "review"`
   *   - build:   `() => true` (terminal — always runs)
   */
  shouldRun: (args: StageRunArgs, resume: ResumeInfo<S> | null) => boolean;
  /**
   * Human-readable reason used in the stderr "SKIPPED" message when this
   * stage doesn't run. The pre-refactor orchestrators used "spec path given
   * as input" for plan-via-spec and "already completed" otherwise.
   */
  skipReason: (args: StageRunArgs) => string;
  /**
   * Optional event payload appended on stage-complete (e.g.
   * `{ event: "stage-complete", stage: "review", kind, spec_path }`).
   *
   * Receives the stage result + ctx; can also mutate ctx (e.g. update
   * `specPath` after plan). Returning `null` skips the append (rare).
   */
  complete?: (
    result: unknown,
    ctx: PipelineContext<S>,
  ) => { event?: Record<string, unknown> | null; mutate?: (ctx: PipelineContext<S>) => void } | null;
  /**
   * Optional "stage produced no spec, abort" check — only plan uses this.
   * When the predicate returns true, the pipeline finalizes as failed with
   * the supplied error message.
   */
  abortOnEmptySpec?: (result: unknown) => string | null;
}

/** Args passed to a descriptor's `shouldRun` predicate. */
export interface StageRunArgs {
  /** True when a spec-path positional input was given (forces plan-skip). */
  specPathInput: boolean;
  /** True when a forced-type (--feature/--bug/--chore) was given. */
  forcedType?: string;
  /** Model override for the build stage, if any. */
  modelOverride?: string;
  /** Goal override for the build stage, if any (5-stage only). */
  goalOverride?: string;
}

/** Resume information threaded to `shouldRun`. */
export interface ResumeInfo<S extends string> {
  resumeFrom: S;
  completedStages: readonly S[];
  specPath: string | null;
  description: string;
}

/**
 * Mutable runtime context threaded through the pipeline. `specPath` is the
 * workspace-wide surviving spec path; `completedStages` is the persistent
 * record of finished stage names; `modelOverride` carries the optional
 * `--model` flag for the build stage.
 */
export interface PipelineContext<S extends string> {
  id: string;
  description: string;
  specPath: string | null;
  completedStages: S[];
  /** Optional build-stage model override (--model). */
  modelOverride?: string;
  /** Optional build-stage goal override (--goal, 5-stage only). */
  goalOverride?: string;
}

/**
 * Configuration of one pipeline variant. The 2-stage and 3-stage
 * orchestrators each declare one of these and delegate to
 * `runLinearPipeline`.
 */
export interface PipelineConfig<S extends string, Deps, Stages, Result> {
  /** Pipeline name used in stderr progress lines (e.g. "adw-plan-reviewspec"). */
  readonly pipelineName: string;
  /** Stage descriptors in execution order. */
  readonly stages: readonly StageDescriptor<S, Deps>[];
  /** Status written to adw-state.json on success. 2-stage="planned", others="completed". */
  readonly successStatus: "planned" | "completed";
  /** Computes the final `state.agents[]` from the stages bag. */
  readonly agentsFor: (stages: Stages) => string[];
  /** Builds the result object returned by runPipeline. */
  readonly buildResult: (ctx: PipelineContext<S>, stages: Stages) => Result;
  /** Injects the workspace id source so tests can pin the id (default: adwId). */
  readonly mintId?: () => string;
}

// ---------------------------------------------------------------------------
// Shared helpers (used by orchestrator scripts)
// ---------------------------------------------------------------------------

/** Detect whether a positional arg is a spec path (SPEC/BUG/CHORE-*.md). */
export function looksLikeSpecPath(s: string): boolean {
  const base = s.split("/").pop() ?? s;
  return /^(SPEC|BUG|CHORE)-.*\.md$/i.test(base);
}

/**
 * Append the orchestrator `start` or `resume` event to
 * agents/{id}/orchestrator/events.jsonl.
 */
export function appendStartOrResumeEvent<S extends string>(
  agentsDir: string,
  id: string,
  ctx: { description: string; resume?: { resumeFrom: S; completedStages: readonly S[]; specPath: string | null } },
): void {
  if (ctx.resume) {
    appendEvent(agentsDir, id, "orchestrator", {
      event: "resume",
      from_stage: ctx.resume.resumeFrom,
      completed_stages: ctx.resume.completedStages,
      recovered_spec_path: ctx.resume.specPath,
    });
  } else {
    appendEvent(agentsDir, id, "orchestrator", { event: "start", description: ctx.description });
  }
}

// ---------------------------------------------------------------------------
// runLinearPipeline — the generic driver (used by the 2- and 3-stage variants)
// ---------------------------------------------------------------------------

/**
 * Drive a linear pipeline. Loads resume state, runs each stage in order
 * (skipping completed ones), checkpoints after each stage, and finalizes
 * with `successStatus` on completion or `"failed"` on any stage error.
 *
 * Behavior is identical to the pre-refactor per-orchestrator `runPipeline`
 * bodies — same event payloads, same state shape, same stderr progress lines.
 */
export async function runLinearPipeline<S extends string, Deps, Stages, Result>(
  config: PipelineConfig<S, Deps, Stages, Result>,
  deps: Deps,
  args: StageRunArgs & { description?: string; specPath?: string; id?: string },
  resume: ResumeInfo<S> | null,
  agentsDir: string,
): Promise<Either<string, Result>> {
  const mintId = config.mintId ?? adwId;
  const id = args.id ?? mintId();

  // Resolve description: explicit args, specPath (plan skipped), or resume state.
  const description = args.description || args.specPath || resume?.description || "";
  if (!description) {
    return Promise.resolve(Either.left("description required for fresh runs (or pass --id to resume)"));
  }

  // State + stages setup.
  const completedStages: S[] = resume ? [...resume.completedStages] : [];
  let specPath: string | null = args.specPath ?? resume?.specPath ?? null;
  const stagesBag = {} as Record<S, unknown>;
  // Seed stages object for finalize's agents computation: skipped stages still
  // count as "ran" historically. When a spec path was given as input, plan is
  // treated as completed (the spec already exists) — seed it so plan is
  // skipped and agents includes "planner".
  if (args.specPath && !completedStages.includes("plan" as S)) {
    completedStages.push("plan" as S);
  }
  if (completedStages.includes("plan" as S)) {
    (stagesBag as Record<string, unknown>).plan = { id, specPath };
  }
  if (completedStages.includes("review" as S) && specPath) {
    (stagesBag as Record<string, unknown>).review = { id, specPath, kind: "pass" };
  }
  if (completedStages.includes("build" as S) && specPath) {
    (stagesBag as Record<string, unknown>).build = { id, specPath };
  }

  const ctx: PipelineContext<S> = {
    id,
    description,
    specPath,
    completedStages,
    ...(args.modelOverride ? { modelOverride: args.modelOverride } : {}),
    ...(args.goalOverride ? { goalOverride: args.goalOverride } : {}),
  };

  const state: WorkspaceState & { completed_stages: S[] } = {
    adw_id: id,
    description,
    status: "running",
    completed_stages: completedStages,
    ...(specPath ? { spec_path: specPath } : {}),
  };

  const finalize = async (result: Either<string, Result>): Promise<Either<string, Result>> => {
    const agents = config.agentsFor(stagesBag as unknown as Stages);
    const finalState: WorkspaceState & { completed_stages: S[] } = {
      ...state,
      agents,
      completed_stages: completedStages,
    };
    if (specPath) finalState.spec_path = specPath;
    if (Either.isLeft(result)) {
      finalState.status = "failed";
      finalState.error = result.left;
    } else {
      finalState.status = config.successStatus;
    }
    await writeState(agentsDir, id, finalState as unknown as Record<string, unknown>).run();
    return result;
  };

  const checkpoint = async (): Promise<void> => {
    const snapshot: WorkspaceState & { completed_stages: S[] } = {
      ...state,
      completed_stages: completedStages,
    };
    if (specPath) snapshot.spec_path = specPath;
    await writeState(agentsDir, id, snapshot as unknown as Record<string, unknown>).run();
  };

  // ── Initial state + start/resume event ───────────────────────────────────
  await writeState(agentsDir, id, state as unknown as Record<string, unknown>).run();
  if (resume) {
    appendStartOrResumeEvent(agentsDir, id, {
      description,
      resume: {
        resumeFrom: resume.resumeFrom,
        completedStages: resume.completedStages,
        specPath: resume.specPath,
      },
    });
    process.stderr.write(
      `${config.pipelineName}: resuming workspace ${id} from stage "${resume.resumeFrom}" ` +
      `(completed: ${resume.completedStages.join(",") || "none"})\n`,
    );
  } else {
    appendStartOrResumeEvent(agentsDir, id, { description });
  }

  // ── Drive each stage ─────────────────────────────────────────────────────
  for (const stage of config.stages) {
    const shouldRun = stage.shouldRun(args, resume);
    if (!shouldRun) {
      const reason = stage.skipReason(args);
      process.stderr.write(`${config.pipelineName}: stage ${stage.posLabel} — ${stage.scriptName} [SKIPPED, ${reason}]\n`);
      if (stage.name === "plan" && args.specPath) {
        appendEvent(agentsDir, id, "orchestrator", {
          event: "stage-complete",
          stage: "plan",
          spec_path: args.specPath,
          skipped: true,
          reason: "spec-path input",
        });
      }
      continue;
    }

    const res = await runConfiguredStage({
      pipelineName: config.pipelineName,
      position: stage.posLabel,
      stage: {
        name: stage.name,
        label: stage.scriptName,
        script: stage.scriptName,
        agentDir: "orchestrator",
      },
      run: () => stage.run(deps, ctx),
    });
    if (Either.isLeft(res)) {
      appendEvent(agentsDir, id, "orchestrator", { event: "stage-error", stage: stage.name, detail: res.left });
      state.failed_stage = stage.name;
      return finalize(Either.left(`${stage.scriptName} stage failed: ${res.left}`));
    }
    (stagesBag as Record<string, unknown>)[stage.name] = res.right;
    if (stage.abortOnEmptySpec) {
      const abortMsg = stage.abortOnEmptySpec(res.right);
      if (abortMsg !== null) {
        appendEvent(agentsDir, id, "orchestrator", { event: "stage-error", stage: stage.name, detail: "plan produced no spec (skill noop)" });
        state.failed_stage = stage.name;
        return finalize(Either.left(abortMsg));
      }
    }
    if (stage.complete) {
      const completion = stage.complete(res.right, ctx);
      if (completion) {
        if (completion.event) {
          appendEvent(agentsDir, id, "orchestrator", completion.event);
        }
        if (completion.mutate) {
          completion.mutate(ctx);
        }
        // After any completion hook, sync local specPath from ctx (the hook
        // may have updated it — e.g. plan sets the just-produced spec path).
        specPath = ctx.specPath;
        if (specPath) state.spec_path = specPath;
      }
    }
    if (!completedStages.includes(stage.name)) completedStages.push(stage.name);
    await checkpoint();
  }

  if (!specPath) {
    return finalize(Either.left("pipeline completed with no spec path"));
  }
  return finalize(Either.right(config.buildResult(ctx, stagesBag as unknown as Stages)));
}

// ---------------------------------------------------------------------------
// spawnStage + tokensOf re-exports (so orchestrators can import from pipeline)
// ---------------------------------------------------------------------------

export { spawnStage, tokensOf };
