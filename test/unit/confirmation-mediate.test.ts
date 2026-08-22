import { describe, expect, test, beforeEach } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { confirmationService } from "../../src/editor/api/confirmation-service.ts";
import { createConfirmationHandlers } from "../../src/server/rpc/handlers/confirmation.ts";

// #210 (RFC-027 §D5 L2, Phase 0) — the generic deferred-confirmation
// mechanism: park, resolve-later (first-wins), timeout/cancel/sweep → reject,
// unforgeable one-time tokens (primary control), client-kind FACT capture.
// Zero Fikra policy — a plain test handler exercises the machinery.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

function setupTestHandler(editor: Editor) {
  // T-Lisp handler records its invocation into globals the test can read.
  executeTlisp(editor, "(defvar *confirm-calls* (list))");
  executeTlisp(editor, "(defvar *confirm-last-detail* nil)");
  executeTlisp(editor, '(defun test-confirm-handler (id detail kind scope) (setq *confirm-last-detail* detail) (setq *confirm-calls* (cons (list id kind scope) *confirm-calls*)))');
  executeTlisp(editor, '(confirmation-handler-register "test-source" "test-confirm-handler")');
}

function mint(editor: Editor, source = "test-source", scope = "test-scope"): string {
  return String(executeTlisp(editor, `(confirmation-token-mint "${source}" "${scope}")`).value);
}

async function mediateRaw(params: {
  source?: string; token: string; kind?: string; detail?: string; timeoutMs?: number;
}) {
  const handlers = createConfirmationHandlers({} as Parameters<typeof createConfirmationHandlers>[0]);
  return handlers["confirmation/mediate"]({
    source: params.source ?? "test-source",
    token: params.token,
    kind: params.kind ?? "write-file",
    detail: params.detail ?? "write to src/x.ts",
    timeoutMs: params.timeoutMs,
  } as Parameters<ReturnType<typeof createConfirmationHandlers>["confirmation/mediate"]>[0]);
}

beforeEach(() => {
  confirmationService.reset();
});

describe("#210 confirmation/mediate — deferred resolution", () => {
  test("parks until resolved by a later eval; handler received (id detail kind)", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const pending = mediateRaw({ token });

    // Handler ran synchronously at enqueue with the detail.
    expect(String(executeTlisp(editor, "*confirm-last-detail*").value)).toBe("write to src/x.ts");
    // The request is pending; ids listed.
    const ids = executeTlisp(editor, "(confirmation-pending)");
    const idList = (ids.value as { value: unknown }[]).map((v) => Number(v.value));
    expect(idList).toHaveLength(1);
    const id = idList[0]!;

    // Resolve via T-Lisp → the parked RPC promise settles allow.
    expect(String(executeTlisp(editor, `(confirmation-resolve ${id} "allow")`).value)).toBe("true");
    const result = await pending;
    expect(result.decision).toBe("allow");
    expect(result.scope).toBe("test-scope");
  });

  test("timeout auto-rejects", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const result = await mediateRaw({ token, timeoutMs: 40 });
    expect(result.decision).toBe("reject");
    // Nothing pending afterwards.
    expect(String(executeTlisp(editor, "(confirmation-pending)").type)).toBe("list");
    expect((executeTlisp(editor, "(confirmation-pending)").value as unknown[]).length).toBe(0);
  });

  test("cancel sweep rejects (daemon shutdown / turn interrupt shape)", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const pending = mediateRaw({ token, timeoutMs: 5_000 });
    expect(confirmationService.sweepAll()).toBe(1);
    expect((await pending).decision).toBe("reject");
  });

  test("forged token: rejected BEFORE handler delivery, no prompt", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const result = await mediateRaw({ token: "deadbeef".repeat(6) });
    expect(result.decision).toBe("reject");
    expect(result.scope).toBe("unknown-token");
    // Handler never ran.
    expect((executeTlisp(editor, "*confirm-calls*").value as unknown[]).length).toBe(0);
  });

  test("stale token: one-time use enforced (second mediate rejected, no handler)", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const first = mediateRaw({ token, timeoutMs: 60 });
    await first; // consumed by timeout
    const second = await mediateRaw({ token });
    expect(second.decision).toBe("reject");
    expect(second.scope).toBe("stale-token");
  });

  test("cross-source token: rejected before prompt", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor, "other-source", "other-scope");
    const result = await mediateRaw({ token, source: "test-source" });
    expect(result.decision).toBe("reject");
    expect(result.scope).toBe("cross-source-token");
  });

  test("first-resolver-wins: second resolve is an idempotent no-op", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const pending = mediateRaw({ token, timeoutMs: 5_000 });
    const id = Number((executeTlisp(editor, "(confirmation-pending)").value as { value: unknown }[])[0]!.value);
    expect(String(executeTlisp(editor, `(confirmation-resolve ${id} "allow")`).value)).toBe("true");
    // Second resolver (e.g. a racing second client) — nil, no state change.
    expect(String(executeTlisp(editor, `(confirmation-resolve ${id} "reject")`).value)).toBe("false");
    const result = await pending;
    expect(result.decision).toBe("allow");
    // The contested attempt is recorded for audit.
    const record = confirmationService.resolution(id);
    expect(record?.contestedBy?.length).toBe(1);
  });

  test("client-kind FACT captured on resolution (interactive settles; headless is REFUSED by the #220 policy)", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const pending = mediateRaw({ token, timeoutMs: 5_000 });
    const id = Number((executeTlisp(editor, "(confirmation-pending)").value as { value: unknown }[])[0]!.value);
    // Simulate the daemon stamping the resolving dispatch's client kind
    // (#220's interactive-only policy consumes this fact). A HEADLESS
    // resolve is now refused at the primitive — the entry stays pending.
    confirmationService.resolverHint = "headless";
    expect(String(executeTlisp(editor, `(confirmation-resolve ${id} "allow")`).value)).toBe("false");
    expect(confirmationService.pendingList()).toHaveLength(1);
    // An INTERACTIVE resolver settles; the FACT is captured on the record.
    confirmationService.resolverHint = "interactive";
    executeTlisp(editor, `(confirmation-resolve ${id} "allow")`);
    await pending;
    expect(confirmationService.resolution(id)?.resolverKind).toBe("interactive");
  });

  test("unregistered source: immediate reject, no prompt", async () => {
    const editor = await createStartedEditor("");
    const token = mint(editor); // token valid but no handler registered
    const result = await mediateRaw({ token });
    expect(result.decision).toBe("reject");
    expect(result.scope).toBe("no-handler-registered");
  });

  test("T-Lisp validation: bad decision and bad arity error", async () => {
    const editor = await createStartedEditor("");
    setupTestHandler(editor);
    const token = mint(editor);
    const pending = mediateRaw({ token, timeoutMs: 5_000 });
    const id = Number((executeTlisp(editor, "(confirmation-pending)").value as { value: unknown }[])[0]!.value);
    for (const expr of [
      `(confirmation-resolve ${id} "maybe")`,
      `(confirmation-resolve ${id})`,
      `(confirmation-cancel)`,
    ]) {
      let threw = false;
      try { executeTlisp(editor, expr); } catch { threw = true; }
      expect(threw).toBe(true);
    }
    // Cleanup via sweep so the parked promise settles.
    confirmationService.sweepAll();
    await pending;
  });
});
