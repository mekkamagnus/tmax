import { describe, expect, test } from "bun:test";
import { computeResolverKind } from "../../src/server/server.ts";

// #220 (RFC-027 §Security) — the resolver-kind stamp is the only barrier
// between an eval client and "headless", so the pure mapping is pinned
// directly (gate catch: the server-side stamping had no test coverage).

describe("#220 computeResolverKind", () => {
  const frames = new Map<string, unknown>([["frame-1", {}]]);

  test("eval dispatches are ALWAYS headless — even with a frameId", () => {
    expect(computeResolverKind("interactive", "eval", {}, frames)).toBe("headless");
    expect(computeResolverKind("unknown", "eval", { frameId: "frame-1" }, frames)).toBe("headless");
  });

  test("keypress with an ATTACHED frame is interactive", () => {
    expect(computeResolverKind("unknown", "keypress", { frameId: "frame-1" }, frames)).toBe("interactive");
  });

  test("FRAMELESS keypress is headless — a raw-socket forged keypress must not self-declare interactive", () => {
    expect(computeResolverKind("interactive", "keypress", { key: "y" }, frames)).toBe("headless");
  });

  test("keypress with an UNKNOWN frameId (forged/garbage) is headless", () => {
    expect(computeResolverKind("interactive", "keypress", { frameId: "not-a-frame" }, frames)).toBe("headless");
    expect(computeResolverKind("interactive", "keypress", { frameId: 42 }, frames)).toBe("headless");
  });

  test("every other method PRESERVES the current kind (unknown stays unknown — embedded startup)", () => {
    expect(computeResolverKind("unknown", "confirmation/mediate", {}, frames)).toBe("unknown");
    expect(computeResolverKind("interactive", "render-state", {}, frames)).toBe("interactive");
    expect(computeResolverKind("headless", "open", {}, frames)).toBe("headless");
  });
});
