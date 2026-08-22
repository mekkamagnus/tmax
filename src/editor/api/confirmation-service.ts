/**
 * @file confirmation-service.ts
 * @description #210 (RFC-027 §D5 L2, Phase 0) — the generic deferred-confirmation
 * mechanism. ZERO Fikra policy: the daemon primitive parks a confirmation
 * request, surfaces it to a registered handler, and resolves it later (or
 * times out / sweeps to reject). Interactive-only resolve POLICY is Phase 3
 * (#220); this module supplies the FACTS (resolver kind, first-wins log).
 *
 * Architecture: one service instance per process (a daemon runs one editor;
 * embedded mode simply never mediate()s). Both the RPC handler
 * (server/rpc/handlers/confirmation.ts) and the T-Lisp ops
 * (editor/api/confirmation-ops.ts) share this instance.
 */

export type ConfirmationDecision = "allow" | "reject" | "always";

export interface MediateRequest {
  /** Requesting source identifier (e.g. a backend adapter name). */
  source: string;
  /** Unforgeable one-time token from confirmation-token-mint (primary
   * control on every platform; peer credentials are defense-in-depth only). */
  token: string;
  /** Machine-readable action kind (display hint for the handler). */
  kind: string;
  /** Human-readable detail shown to the user by the handler. */
  detail: string;
  /** Auto-reject after this many ms (default 60_000). */
  timeoutMs?: number;
}

export interface MediateResult {
  decision: ConfirmationDecision;
  scope: string;
}

interface PendingEntry {
  id: number;
  source: string;
  scope: string;
  kind: string;
  detail: string;
  createdAt: number;
  expiresAt: number;
  resolve: (result: MediateResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ResolutionRecord {
  id: number;
  decision: ConfirmationDecision;
  /** How the request settled: a resolver call, timeout, or a sweep. */
  settledBy: "resolver" | "timeout" | "cancel" | "sweep" | "invalid";
  /** FACT for #220's interactive-only policy: the kind of client that
   * resolved ("interactive" | "headless" | "unknown"). Captured from the
   * resolver hint set around the resolving eval; the daemon's eval path
   * stamps it in Phase 3 wiring. */
  resolverKind: string;
  decidedAt: number;
  /** First resolver wins — subsequent attempts land here. */
  contestedBy?: string[];
}

/** Registered per source; called when a mediate parks. SCOPE is the minted
 * token's scope string (#220: fikra validates thread/turn liveness against
 * it before prompting — the service itself never interprets scopes). */
type HandlerFn = (id: number, detail: string, kind: string, scope: string) => void | Promise<void>;

interface TokenBinding {
  source: string;
  scope: string;
  used: boolean;
}

export class ConfirmationService {
  private nextId = 1;
  private handlers = new Map<string, HandlerFn>();
  private tokens = new Map<string, TokenBinding>();
  private pending = new Map<number, PendingEntry>();
  /** Bounded log of settled resolutions (first-resolver-wins evidence). */
  private resolutions = new Map<number, ResolutionRecord>();
  /** FACT channel: the daemon eval path stamps the resolving client's kind
   * around evals; resolve() reads it at decision time. Default "unknown". */
  resolverHint: string = "unknown";
  /** #220 (RFC-027 §Security): the PRIMITIVE enforces the default resolve
   * policy — "interactive-only" refuses headless resolvers (the wrapper
   * guard alone was bypassable by calling confirmation-resolve directly;
   * gate catch). Flipped to "permissive" only by the provenance-checked
   * setter op (which itself refuses headless callers). */
  resolvePolicy: "interactive-only" | "permissive" = "interactive-only";

  reset(): void {
    for (const entry of this.pending.values()) this.clearTimer(entry);
    this.pending.clear();
    this.handlers.clear();
    this.tokens.clear();
    this.resolutions.clear();
    this.nextId = 1;
    this.resolverHint = "unknown";
    this.resolvePolicy = "interactive-only";
  }

  registerHandler(source: string, handler: HandlerFn): void {
    this.handlers.set(source, handler);
  }

  /** Mint an opaque one-time token bound to source+scope. The token is the
   * PRIMARY auth control: a schema-valid mediate with a guessed, stale
   * (single-use), or cross-scope token is rejected BEFORE any prompt. */
  mintToken(source: string, scope: string): string {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    this.tokens.set(token, { source, scope, used: false });
    return token;
  }

  /** Park a confirmation request. Validation failures resolve IMMEDIATELY as
   * reject (settledBy "invalid") — no prompt, no handler call. */
  mediate(request: MediateRequest): Promise<MediateResult> {
    const binding = this.tokens.get(request.token);
    const invalid = (reason: string): Promise<MediateResult> => {
      this.recordResolution(this.nextId++, "reject", "invalid", reason);
      return Promise.resolve({ decision: "reject", scope: reason });
    };
    if (!binding) return invalid("unknown-token");
    if (binding.used) return invalid("stale-token");
    if (binding.source !== request.source) return invalid("cross-source-token");
    binding.used = true;

    const handler = this.handlers.get(request.source);
    if (!handler) return invalid("no-handler-registered");

    const id = this.nextId++;
    const timeoutMs = request.timeoutMs ?? 60_000;
    return new Promise<MediateResult>((resolve) => {
      const entry: PendingEntry = {
        id,
        source: request.source,
        scope: binding.scope,
        kind: request.kind,
        detail: request.detail,
        createdAt: Date.now(),
        expiresAt: Date.now() + timeoutMs,
        resolve,
        timer: null,
      };
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        this.recordResolution(id, "reject", "timeout", this.resolverHint);
        resolve({ decision: "reject", scope: entry.scope });
      }, timeoutMs);
      this.pending.set(id, entry);
      // Handler errors are logged, not fatal: the prompt stays parked until
      // resolved, cancelled, or timed out — a broken handler must never hang
      // the mediate silently with an unrecorded state.
      try {
        void Promise.resolve(handler(id, request.detail, request.kind, binding.scope)).catch((e: unknown) => {
          console.error(`confirmation handler for '${request.source}' threw:`, e);
        });
      } catch (e) {
        console.error(`confirmation handler for '${request.source}' threw:`, e);
      }
    });
  }

  /** First resolver wins. Returns the resolution record when this call
   * settled the request; null when already settled (idempotent no-op — the
   * contest is still AUDITED on the original record) or when the resolve
   * POLICY refused this caller (#220: a headless resolver under the default
   * interactive-only policy — the request stays pending, audited). */
  resolve(id: number, decision: ConfirmationDecision): ResolutionRecord | null {
    if (this.resolvePolicy === "interactive-only" && this.resolverHint === "headless") {
      // Refused BEFORE any settle: audit the attempt on the record if one
      // exists, leave the entry pending for an interactive client.
      const prior = this.resolutions.get(id);
      if (prior) {
        prior.contestedBy = prior.contestedBy ?? [];
        prior.contestedBy.push(`denied/headless/${decision}`);
      }
      return null;
    }
    const entry = this.pending.get(id);
    if (!entry) {
      // Already settled: audit the contested attempt on the original record.
      const prior = this.resolutions.get(id);
      if (prior) {
        prior.contestedBy = prior.contestedBy ?? [];
        prior.contestedBy.push(`resolver/${this.resolverHint}/${decision}`);
      }
      return null;
    }
    this.clearTimer(entry);
    this.pending.delete(id);
    const record = this.recordResolution(id, decision, "resolver", this.resolverHint);
    entry.resolve({ decision, scope: entry.scope });
    return record;
  }

  /** Cancel one pending request → reject. */
  cancel(id: number): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.clearTimer(entry);
    this.pending.delete(id);
    this.recordResolution(id, "reject", "cancel", this.resolverHint);
    entry.resolve({ decision: "reject", scope: entry.scope });
    return true;
  }

  /** Sweep ALL pending → reject (turn interrupt / daemon shutdown). */
  sweepAll(): number {
    let swept = 0;
    for (const entry of [...this.pending.values()]) {
      this.clearTimer(entry);
      this.pending.delete(entry.id);
      this.recordResolution(entry.id, "reject", "sweep", this.resolverHint);
      entry.resolve({ decision: "reject", scope: entry.scope });
      swept++;
    }
    return swept;
  }

  pendingList(): Array<{ id: number; source: string; scope: string; kind: string; detail: string }> {
    return [...this.pending.values()].map((e) => ({
      id: e.id, source: e.source, scope: e.scope, kind: e.kind, detail: e.detail,
    }));
  }

  /** Post-settlement record (first-resolver-wins evidence + resolver facts). */
  resolution(id: number): ResolutionRecord | undefined {
    return this.resolutions.get(id);
  }

  private clearTimer(entry: PendingEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  private recordResolution(
    id: number,
    decision: ConfirmationDecision,
    settledBy: ResolutionRecord["settledBy"],
    resolverKind: string,
  ): ResolutionRecord {
    const existing = this.resolutions.get(id);
    if (existing) {
      existing.contestedBy = existing.contestedBy ?? [];
      existing.contestedBy.push(`${settledBy}/${resolverKind}`);
      return existing;
    }
    const record: ResolutionRecord = {
      id, decision, settledBy, resolverKind, decidedAt: Date.now(),
    };
    this.resolutions.set(id, record);
    return record;
  }
}

/** Process-wide instance shared by the RPC handler and the T-Lisp ops. */
export const confirmationService = new ConfirmationService();
