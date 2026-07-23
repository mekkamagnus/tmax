# Feature: Versioned, Negotiated Daemon/Client Wire Protocol (RFC-025 Change #1)

## Feature Description

Make the tmax daemon/client wire protocol a **versioned, negotiated contract** rather than just "JSON-RPC 2.0". Today the router validates only `jsonrpc === '2.0'` (`src/server/rpc/router.ts:377`), so every client/daemon version skew is **silent** — an out-of-date client can attach to a newer daemon (or vice-versa) and corrupt a session with no diagnostic.

This feature introduces a `PROTOCOL_VERSION` constant and a per-request negotiation gate: clients declare the protocol version they speak; the daemon refuses — with a **machine-readable** `protocol_mismatch` error in the `-32600` (Invalid Request) family, plus stop/restart guidance — any client whose declared version mismatches, *before* dispatch. A transition window tolerates clients that omit the field for one release, then enforcement flips on.

This is the **anchor change (#1)** of [RFC-025](../rfcs/RFC-025-daemon-client-protocol-hardening.md), preempting the exact regression herdr hit and retrofitted late (machine-readable `protocol_mismatch`, herdr 0.7.5 / #1435, after bumping through v5→v14 with only silent attach). Full rationale and primary-source citations: [RFC-025 §1](../rfcs/RFC-025-daemon-client-protocol-hardening.md) and [herdr-client-server-lessons.md §2.1 / §3](../memos/herdr-client-server-lessons.md).

## User Story

As a **tmax user (or automation script) hitting a daemon/client version skew** (e.g. after a binary swap, or a long-lived daemon vs. a freshly built client)
I want **the mismatch to fail loudly and immediately with a machine-readable error and stop/restart guidance**
So that **I am never silently attached to an incompatible daemon corrupting my session, and tooling can detect and report the skew programmatically.**

## Problem Statement

The daemon/client protocol has no version. The single existing wire check is `request.jsonrpc !== '2.0'` → `-32600` (`router.ts:377`). Consequences:

- A client built against protocol shape A attaches silently to a daemon speaking shape B. The first symptom is a confusing `-32010` / `-32602` on some later method, or silently wrong behavior — never "you are talking to the wrong daemon."
- There is no field a client or `--status` consumer can read to learn which protocol version a running daemon speaks.
- The `connect-frame` **handshake** (the natural attach point) bypasses `routeRequest` entirely (`server.ts:1068` special-cases it and `continue`s before `processRequest` at `server.ts:1110`), so even a check added only inside the router would not gate the handshake — the most important place to refuse a skew.

herdr documented this exact failure: clients silently attached to mismatched servers, and the machine-readable mismatch error + early-fail detection were only retrofitted ~12 versions late (#1435). tmax can preempt it cheaply now.

## Solution Statement

Add a `PROTOCOL_VERSION = 1` constant in `src/server/rpc/types.ts` as the single source of truth. Make the version a **top-level field on the JSON-RPC request envelope** (`protocolVersion?: number`, sibling to `jsonrpc`) that clients stamp on every request — consistent with the existing per-request `jsonrpc === '2.0'` check, so any mismatched request fails on first contact, not just at handshake.

Gate it in a single pure helper exported from `router.ts` — `validateProtocolVersion(request, enforce?)` — and call it in **two** places so the whole wire surface (handshake included) is covered by one implementation:

1. Inside `routeRequest` as step 1b (after the `jsonrpc` check, before method lookup) — gates every routed method and is directly unit-testable via the existing router fixture harness.
2. In `server.ts` at the top of the `connect-frame` branch — gates the handshake, which otherwise bypasses the router.

On mismatch/omission-under-enforcement, return a `-32600` response whose `error.data` carries `{ kind: "protocol_mismatch", client: <declared|number|"omitted">, server: PROTOCOL_VERSION, guidance: <stop/restart string> }`. The `kind` discriminator makes it machine-readable (mirrors how this codebase already tags `-32010` with `data.kind: "tlisp-diagnostic"`).

Transition policy: an `ENFORCE_PROTOCOL_VERSION = false` const governs the omit path. Declared-but-wrong **always** refuses (that is real skew). Omission is tolerated while `false` (protects an old client binary against a brand-new daemon across a binary swap), then refused once flipped to `true` next release. All in-repo JSON-RPC clients (`RemoteEditor`, `bin/tmaxclient`, and `tmax-use/src/client.ts`) are updated to declare `protocolVersion: PROTOCOL_VERSION` immediately.

Surface the daemon's version in the `status` response (`StatusResult.protocolVersion`) and the `connect-frame` handshake result, so clients and `--status`/diagnostics can read it.

Finally, record the decision in the ADR that owns the wire protocol ([ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md)) and cross-reference it from [ADR-0018](../adrs/ADR-0018-basic-server-client-infrastructure.md)'s Protocol section.

## Relevant Files

Use these files to implement the feature:

- **`src/server/rpc/types.ts`** — add `PROTOCOL_VERSION` and `ENFORCE_PROTOCOL_VERSION` constants (single source of truth). Add `protocolVersion: number` to `StatusResult` (so the status response advertises the daemon's version). This is where the RFC places the constant.
- **`src/server/rpc/router.ts`** — add `protocolVersion?: number` to the `JSONRPCRequest` envelope interface (line 22). Export a pure `validateProtocolVersion(request, enforce?)` helper returning a `JSONRPCResponse` error or `null`. Call it as step 1b inside `routeRequest` (after the `jsonrpc !== '2.0'` check at line 377, before method lookup). Define the `protocol_mismatch` error shape here.
- **`src/server/server.ts`** — call `validateProtocolVersion(request)` at the top of the `connect-frame` branch (before `server.ts:1068` creates the frame) so the handshake refuses skew; write the error response and `continue`. Add `protocolVersion: PROTOCOL_VERSION` to the `connect-frame` result object (`server.ts:1090`) and to `buildStatus()` (`server.ts:705`).
- **`src/editor/remote-editor.ts`** — stamp `protocolVersion: PROTOCOL_VERSION` on every request envelope in `sendRequest` (line 148). This is the TUI client's wire exit.
- **`bin/tmaxclient`** — add `protocolVersion?: number` to the file-local `JSONRPCRequest` interface (line 15), then stamp `protocolVersion: PROTOCOL_VERSION` on every request envelope in `sendRequest` (lines 76–81). Import the constant from `src/server/rpc/types.ts` for single-source-of-truth (deliberate first src import in this file — see Notes).
- **`tmax-use/src/client.ts`** — import `PROTOCOL_VERSION` and stamp `protocolVersion: PROTOCOL_VERSION` in the direct JSON-RPC request constructed by `requestReal()`. This in-repo e2e client currently bypasses `bin/tmaxclient` for structured results, so relying on omission tolerance would make the future `ENFORCE_PROTOCOL_VERSION = true` flip break tmax's own e2e tooling.
- **`docs/adrs/ADR-0058-frame-based-daemon-client.md`** — the Accepted ADR owning the live daemon/client + socket architecture. Add a dated "Wire-protocol versioning (SPEC-070)" amendment recording that protocol versioning + handshake refusal are implemented per SPEC-070 / RFC-025 #1.
- **`docs/adrs/ADR-0018-basic-server-client-infrastructure.md`** — has the literal "Protocol" section a reader may land on first (historical/superseded). Add a one-line cross-reference pointing to ADR-0058 / SPEC-070 so the versioning decision is discoverable from there too.
- **`rules/daemon-client.md`** — path-scoped rules for this exact area. Add a short "Protocol versioning" subsection (the `protocolVersion` field, the omit-then-enforce transition, the `protocol_mismatch` error code/shape).
- **`test/unit/server-rpc-router.test.ts`** — extend with protocol-version coverage (matches existing `-32600`/`-32601`/`-32602` fixture style; drives `routeRequest` directly, no socket).

### New Files

- **`test/unit/server-protocol-version.test.ts`** (optional, only if router test grows too large) — dedicated coverage for `validateProtocolVersion` + the connect-frame handshake gate. Prefer extending `server-rpc-router.test.ts` first; create this only if the handshake/status integration assertions need a separate file. The handshake/status end-to-end assertions can also live in **`test/unit/server-daemon-hardening.test.ts`** alongside the existing `connect-frame` tests.

## Implementation Plan

### Phase 1: Foundation — the version constant and wire shape

Declare the single source of truth (`PROTOCOL_VERSION`, `ENFORCE_PROTOCOL_VERSION`) and extend the wire envelope type (`JSONRPCRequest.protocolVersion`) and the `StatusResult` shape. No behavior change yet — this makes the subsequent gates typecheck cleanly and gives every consumer one import.

### Phase 2: Core Implementation — the negotiation gate

Implement the pure `validateProtocolVersion` helper in `router.ts` (returns the `protocol_mismatch` `-32600` response or `null`). Wire it into `routeRequest` (step 1b) and into `server.ts`'s `connect-frame` branch (the handshake). Surface the daemon version in `status` and `connect-frame` results.

### Phase 3: Integration — clients declare the version

Update every in-repo JSON-RPC client (`RemoteEditor`, `bin/tmaxclient`, and `tmax-use/src/client.ts`) to stamp `protocolVersion: PROTOCOL_VERSION` on every request. Add unit + handshake/status tests. Update the ADR(s) and the daemon-client rules. Run the full validation suite.

## Step by Step Tasks

> NOTE: This is a TypeScript/Bun project. The skill template's defaults (`app/server/**`, `uv add`, `uv run pytest`) do **not** apply — use `src/server`, `src/client`, `bin`, and the `bun` commands listed under Validation Commands. No new dependencies are required (pure TS, no library add).

### Step 1 — Add the protocol-version constants to `types.ts`

- In `src/server/rpc/types.ts`, add near the top (after the imports, before `DiagnosticResult`):
  ```ts
  /**
   * The daemon/client wire-protocol version (RFC-025 change #1 / SPEC-070).
   * Bump ONLY on a breaking wire-protocol change. Clients declare this on every
   * request envelope (`protocolVersion`); the daemon refuses a mismatch with a
   * machine-readable `protocol_mismatch` error (-32600) before dispatch.
   * Single source of truth — import this everywhere; never hardcode `1`.
   */
  export const PROTOCOL_VERSION = 1;

  /**
   * Transition gate (RFC-025 #1). While `false`, clients that OMIT
   * `protocolVersion` are tolerated (protects an old client binary against a
   * new daemon across a binary swap). A DECLARED-but-wrong version is ALWAYS
   * refused. Flip to `true` next release to enforce the field on all clients.
   */
  export const ENFORCE_PROTOCOL_VERSION = false;
  ```
- Add `protocolVersion: number;` to the `StatusResult` interface (after `server: "tmax";`, ~line 316) so the status response advertises the daemon's version.
- Verify: `bun run typecheck:src` — expect errors in `server.ts` (`buildStatus`/connect-frame result don't yet supply the new field) — these are resolved in Step 4.

### Step 2 — Extend the wire envelope type in `router.ts`

- In `src/server/rpc/router.ts`, add the optional field to `JSONRPCRequest` (lines 22–27):
  ```ts
  export interface JSONRPCRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: unknown;
    /** Client-declared wire-protocol version (RFC-025 #1 / SPEC-070). Optional
     *  during the transition window; enforced once ENFORCE_PROTOCOL_VERSION. */
    protocolVersion?: number;
  }
  ```

### Step 3 — Implement `validateProtocolVersion` + the `protocol_mismatch` error

- In `src/server/rpc/router.ts`, add (above `routeRequest`) a pure helper:
  ```ts
  /** Result of the protocol-version gate: an error response to write, or null
   *  meaning "version OK, proceed to dispatch". Pure + exported so the
   *  connect-frame handshake path in server.ts reuses the exact same check. */
  export function validateProtocolVersion(
    request: JSONRPCRequest,
    enforce: boolean = ENFORCE_PROTOCOL_VERSION,
  ): JSONRPCResponse | null {
    const declared = request.protocolVersion;
    if (declared === undefined) {
      if (!enforce) return null;            // transition: tolerate omission
      return protocolMismatchResponse(request.id, 'omitted');
    }
    if (typeof declared !== 'number' || declared !== PROTOCOL_VERSION) {
      return protocolMismatchResponse(request.id, declared);
    }
    return null;
  }
  ```
- Add the error builder. Use `-32600` (Invalid Request family) with a `kind` discriminator for machine-readability and a human `guidance` string (mirrors herdr's "Stop and restart" text):
  ```ts
  function protocolMismatchResponse(
    id: string | number | null | undefined,
    client: number | 'omitted',
  ): JSONRPCResponse {
    const guidance = 'Daemon protocol version mismatch. Stop and restart the daemon (`tmax --stop`) and reconnect with a client whose protocolVersion matches the daemon.';
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32600,
        message: `Invalid Request: protocol_mismatch (client=${client}, server=${PROTOCOL_VERSION})`,
        data: {
          kind: 'protocol_mismatch',
          client,
          server: PROTOCOL_VERSION,
          guidance,
        },
      },
    };
  }
  ```
- Import `PROTOCOL_VERSION` and `ENFORCE_PROTOCOL_VERSION` from `./types.ts` at the top of `router.ts`.

### Step 4 — Wire the gate into `routeRequest` (step 1b)

- In `routeRequest` (`router.ts:376`), immediately after the existing `jsonrpc !== '2.0'` block (ends ~line 386) and before the method-lookup block, insert:
  ```ts
  // 1b. Protocol-version negotiation (RFC-025 #1 / SPEC-070). Refuses a
  // declared-but-wrong version (or an omitted one, once enforcing) before
  // dispatch. Connect-frame is gated separately in server.ts (it bypasses
  // routeRequest) via the same validateProtocolVersion helper.
  const protocolError = validateProtocolVersion(request);
  if (protocolError) return protocolError;
  ```
- Update the `routeRequest` JSDoc (lines 349–363) step list to mention "1b. Protocol-version check → -32600 `protocol_mismatch`".

### Step 5 — Gate the `connect-frame` handshake in `server.ts`

- In `src/server/server.ts`, import `validateProtocolVersion` from `./rpc/router.ts` and `PROTOCOL_VERSION` from `./rpc/types.ts` (extend the existing rpc imports near line 15/32).
- At the top of the `connect-frame` branch (right after `request.method === 'connect-frame'` at line 1068, before reading params/creating the frame), add:
  ```ts
  const protocolError = validateProtocolVersion(request);
  if (protocolError) {
    if (conn.writable) conn.write(JSON.stringify(protocolError) + '\n');
    continue;
  }
  ```
- Add `protocolVersion: PROTOCOL_VERSION` to the `connect-frame` success result object at `server.ts:1090`:
  ```ts
  result: { clientId, frameId: clientFrameId, protocolVersion: PROTOCOL_VERSION }
  ```

### Step 6 — Surface the version in the `status` response

- In `buildStatus()` (`server.ts:705`), add `protocolVersion: PROTOCOL_VERSION,` to the returned object (e.g. right after `server: 'tmax',` at line 712).
- Verify the `StatusResult.protocolVersion` field added in Step 1 is now satisfied.

### Step 7 — TUI client declares the version

- In `src/editor/remote-editor.ts`, import `PROTOCOL_VERSION` from `../server/rpc/types.ts`.
- In `sendRequest` (line 148), stamp the field:
  ```ts
  this.socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params, protocolVersion: PROTOCOL_VERSION }) + "\n");
  ```
  (Editor already imports from `../server/serialize.ts`, so importing a server rpc type is consistent with existing cross-layer imports.)

### Step 8 — One-shot CLI client declares the version

- In `bin/tmaxclient`, import the constant for single-source-of-truth (first src import in this file — deliberate; see Notes):
  ```ts
  import { PROTOCOL_VERSION } from '../src/server/rpc/types.ts';
  ```
  (Adjust the relative path to the repo root from `bin/`; verify with `bun ./bin/tmaxclient --help` and the explicit CLI build/check command in Validation Commands. `bun run build` does not compile this script.)
- In the same file-local `JSONRPCRequest` interface (near line 15), add:
  ```ts
  protocolVersion?: number;
  ```
  This keeps type-aware validation of the standalone script aligned with the request object shape.
- In `sendRequest` (lines 76–81), add `protocolVersion: PROTOCOL_VERSION,` to the `request` object.

### Step 9 — tmax-use direct JSON-RPC client declares the version

- In `tmax-use/src/client.ts`, import `PROTOCOL_VERSION` from `../../src/server/rpc/types.ts`.
- In `requestReal()`, update the direct JSON-RPC request object from:
  ```ts
  const request = { jsonrpc: '2.0' as const, id, method, params };
  ```
  to:
  ```ts
  const request = { jsonrpc: '2.0' as const, id, method, params, protocolVersion: PROTOCOL_VERSION };
  ```
- Do not rely on omission tolerance here: `tmax-use` is in-repo e2e tooling, and it must already be compatible with the future `ENFORCE_PROTOCOL_VERSION = true` flip.

### Step 10 — Unit tests for the router gate

- Extend `test/unit/server-rpc-router.test.ts`. Add a new `describe('protocol-version negotiation (RFC-025 #1 / SPEC-070)', …)` block mirroring the existing `-32600` block style. Cover:
  - Declared `protocolVersion === PROTOCOL_VERSION` → proceeds (success, handler called, id preserved).
  - Declared mismatched version (e.g. `PROTOCOL_VERSION + 1`) → `-32600`, `data.kind === 'protocol_mismatch'`, `data.server === PROTOCOL_VERSION`, `data.client === <wrong>`, `data.guidance` is a non-empty string, id preserved, **handler not called** (use a handler that sets a flag / throws if reached).
  - Omitted `protocolVersion`, default `enforce=false` → proceeds (tolerated).
  - Omitted `protocolVersion`, `validateProtocolVersion(req, true)` (enforce) → `-32600` with `data.client === 'omitted'`.
  - Non-number declared `protocolVersion` (e.g. a string) → treated as mismatch → `-32600 protocol_mismatch`.
- Also add a couple of direct `validateProtocolVersion(...)` assertions (no handlers needed) to cover the connect-frame path's helper without a socket.
- Verify: `bun test test/unit/server-rpc-router.test.ts`.

### Step 11 — Handshake + status integration tests

- In `test/unit/server-daemon-hardening.test.ts` (alongside existing `connect-frame` tests), add:
  - A `connect-frame` request carrying a mismatched `protocolVersion` → response is `-32600` with `data.kind === 'protocol_mismatch'` and **no frame is created** (assert the handshake was refused: no `frameId` in result, and `frames` count unchanged).
  - A `connect-frame` request omitting `protocolVersion` → succeeds (transition tolerance), result includes `protocolVersion === PROTOCOL_VERSION`.
  - A `status` request → result includes `protocolVersion === PROTOCOL_VERSION`.
- If a real-socket harness is heavy for the mismatch case, assert via `routeRequest`/`validateProtocolVersion` directly (Step 10) and keep the socket test to the status/handshake-success path. Do not skip the handshake-refusal assertion — it is a core acceptance criterion.

### Step 12 — Update the owning ADR (ADR-0058) and cross-reference ADR-0018

- In `docs/adrs/ADR-0058-frame-based-daemon-client.md`, add a dated amendment (e.g. a "## Amendment — Wire-protocol versioning (SPEC-070, 2026-07-23)" section under Consequences, or a note in Context/Decision) recording:
  - The daemon/client wire protocol is now a **versioned, negotiated contract** per SPEC-070 / RFC-025 change #1.
  - `PROTOCOL_VERSION` lives in `src/server/rpc/types.ts`; the daemon refuses a mismatched/omitted (once enforcing) client with a machine-readable `protocol_mismatch` error (`-32600`) before dispatch, including at the `connect-frame` handshake.
  - The transition policy (tolerate omission for one release, then enforce).
- In `docs/adrs/ADR-0018-basic-server-client-infrastructure.md`, in the "### Protocol" section, add a one-line note that the wire protocol is versioned and negotiated per ADR-0058 / SPEC-070 (so a reader landing on the historical Protocol section is redirected to the live decision).

### Step 13 — Update the daemon/client rules

- In `rules/daemon-client.md`, under "## Socket Protocol", add a short "### Protocol versioning" subsection documenting:
  - The `protocolVersion` top-level request field and that clients SHOULD send it on every request.
  - The omit-then-enforce transition (`ENFORCE_PROTOCOL_VERSION`).
  - The `protocol_mismatch` error: code `-32600`, `data.kind === 'protocol_mismatch'`, with `client`/`server`/`guidance`.
  - That `status` and `connect-frame` responses advertise the daemon's `protocolVersion`.

### Step 14 — Run the full validation suite

- Run **every** command under Validation Commands, top to bottom, and confirm zero regressions. Pay special attention to: `typecheck` (the new `StatusResult`/envelope fields must be satisfied everywhere), the targeted router + hardening tests, the explicit `bin/tmaxclient` smoke/build check (because `bun run build` does not include that entrypoint), and `test:tmax-use` (e2e, which exercises real daemon/client traffic that now carries `protocolVersion`).

## Testing Strategy

### Unit Tests

- `validateProtocolVersion` and the `routeRequest` step-1b gate, driven directly via the existing `uniformHandlers`/`req` harness in `server-rpc-router.test.ts` — no socket, no Editor. Covers: matching version proceeds; mismatched version refuses (`-32600` + `protocol_mismatch` data, handler not called); omission tolerated under default `enforce=false`; omission refused under `enforce=true`; non-number declared version treated as mismatch; request-id preserved on every refusal.

### Integration Tests

- The `connect-frame` **handshake refusal** path over a real/loopback socket in `server-daemon-hardening.test.ts`: a mismatched-version attach is refused with `protocol_mismatch` and creates no frame. This is the end-to-end proof that the handshake (which bypasses `routeRequest`) is gated.
- The `status` response carries `protocolVersion === PROTOCOL_VERSION`.

### Edge Cases

- Client omits `protocolVersion` entirely (old binary) under the transition window → tolerated, succeeds.
- Client declares a **future** version (`PROTOCOL_VERSION + 1`) and a **past** version (`0` or `1` after a future bump) → both refused identically.
- Client declares a non-number `protocolVersion` (string/null) → refused as mismatch, not a `-32602` params error (it is an envelope field, so `-32600` family).
- `connect-frame` with mismatched version → refused **before** any frame/workspace mutation (no side effects: frame count unchanged, no `updateLastWorkspace`).
- Request with a null/missing `id` on a mismatch → refusal still returns a well-formed response (`id: null`), consistent with the existing `-32600` null-id test.
- All in-repo JSON-RPC clients (`RemoteEditor`, `bin/tmaxclient`, `tmax-use/src/client.ts`) continue to work against the daemon after declaring the field (covered by `test:tmax-use` e2e and the direct CLI smoke check).

## Acceptance Criteria

1. `PROTOCOL_VERSION = 1` and `ENFORCE_PROTOCOL_VERSION = false` are exported from `src/server/rpc/types.ts` as the single source of truth (no hardcoded `1` elsewhere).
2. `JSONRPCRequest` carries an optional `protocolVersion?: number`; `RemoteEditor.sendRequest`, `bin/tmaxclient.sendRequest`, and `tmax-use/src/client.ts`'s direct `requestReal()` helper stamp `protocolVersion: PROTOCOL_VERSION` on every request. `bin/tmaxclient`'s file-local `JSONRPCRequest` interface also includes `protocolVersion?: number`.
3. A client that declares a `protocolVersion` not equal to the daemon's is refused with a `-32600` response whose `error.data.kind === 'protocol_mismatch'`, carrying `client`, `server`, and a non-empty `guidance` string, **before** dispatch (handler not invoked), with the request id preserved.
4. The refusal also fires at the **`connect-frame` handshake** (which bypasses `routeRequest`): a mismatched attach creates no frame and returns the `protocol_mismatch` error.
5. Transition policy holds: while `ENFORCE_PROTOCOL_VERSION === false`, a client that **omits** `protocolVersion` is tolerated (succeeds); the same omission under `enforce=true` is refused with `data.client === 'omitted'`. A declared-but-wrong version is refused **regardless** of the flag.
6. The daemon advertises its version: the `status` result includes `protocolVersion === PROTOCOL_VERSION`, and the `connect-frame` success result includes `protocolVersion: PROTOCOL_VERSION`.
7. The single gate implementation (`validateProtocolVersion`) is shared by both `routeRequest` and the `connect-frame` branch — no duplicated version logic.
8. [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md) records that protocol versioning + handshake refusal are implemented per SPEC-070 / RFC-025 #1; [ADR-0018](../adrs/ADR-0018-basic-server-client-infrastructure.md) cross-references it from its Protocol section.
9. `rules/daemon-client.md` documents the `protocolVersion` field, the transition policy, and the `protocol_mismatch` error shape.
10. All Validation Commands pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Every command must execute without errors.

- `bun run typecheck:src` — the new `StatusResult.protocolVersion` field and `JSONRPCRequest.protocolVersion` must be satisfied everywhere in src.
- `bun run typecheck:test` — test-side types (router/hardening test changes) compile.
- `bun run typecheck` — full typecheck (src + test + tmax-use + bench).
- `bun ./bin/tmaxclient --help` — direct Bun runtime/syntax smoke check for the standalone CLI script and its new `PROTOCOL_VERSION` import.
- `bun build ./bin/tmaxclient --outfile /tmp/tmaxclient-protocol-version-check` — explicit build check for the `bin/tmaxclient` entrypoint, which is not included in `bun run build`.
- `bun test test/unit/server-rpc-router.test.ts` — protocol-version gate unit coverage (matching/mismatched/omitted/enforced/non-number).
- `bun test test/unit/server-daemon-hardening.test.ts` — connect-frame handshake refusal + status `protocolVersion` assertions.
- `bun run build` — confirms the repo's configured build targets still compile (`src/main.ts`, `src/tlisp/cli.ts`, and `tmax-use/test/cli.ts`). It does **not** compile `bin/tmaxclient`; that is covered by the explicit command above.
- `bun run test:integration` — daemon/client integration suite (exercises real JSON-RPC traffic now carrying `protocolVersion`).
- `bun run test:tmax-use` — e2e playbooks + TypeScript e2e (real daemon auto-start + TUI client attach + eval), proving the TUI client and `tmax-use/src/client.ts` direct JSON-RPC helper still interoperate after declaring the version.
- `bun run test:unit` — full unit suite (note: per project memory, `test:unit` can occasionally false-hang under full-suite concurrent-daemon load due to BUG-16; if it hangs, re-run with the dots reporter per the BUG-16 fix rather than skipping it).

## Notes

- **No new dependencies.** Pure TypeScript; the gate is plain type guards + a const, consistent with the existing `router.ts` validation style.
- **Why `protocolVersion` is a top-level envelope field (not a handshake-only or params field):** consistency with the existing per-request `jsonrpc === '2.0'` check, and so *any* mismatched request fails on first contact — not only the handshake. The cost is trivial: the few in-repo request construction sites stamp it.
- **Why the handshake needs a separate gate:** `connect-frame` is special-cased in `server.ts:1068` and `continue`s before `processRequest`/`routeRequest`, so a router-only check would miss the most important attach point. The shared `validateProtocolVersion` helper avoids duplicating the logic.
- **Why `bin/tmaxclient` imports from `src/`:** this is the first src import in that file, and it is deliberate. The entire bug class this feature prevents is version drift; a second hardcoded copy of the version in the client would re-create the hazard. Single source of truth (`PROTOCOL_VERSION` in `types.ts`) outweighs the file's prior self-containment.
- **Error code choice:** `-32600` (Invalid Request family, as the task requires) with a `data.kind: "protocol_mismatch"` discriminator — mirroring how this codebase already tags `-32010` with `data.kind: "tlisp-diagnostic"`. This keeps it machine-readable without inventing a non-standard integer code.
- **Enforcement flip:** to enforce next release, set `ENFORCE_PROTOCOL_VERSION = true` in `types.ts` (single line) — no other code changes. Record the flip in the ADR amendment when it happens.
- **Out of scope (RFC-025 explicitly defers):** per-client bounded queues / event-push backpressure (herdr #726/#265) — only relevant if/when tmax adopts server-push (ADR-0093). The other RFC-025 changes (#2 two-phase `--stop`, #3 fd-limit raise, #4 resume-path docs, #5 resume reconcile) are separate SPECs; this SPEC implements **only change #1**.
- **`rpc.schema` (self-describing method schema):** listed as an *optional follow-on* in RFC-025 §1, deliberately not included here to keep the anchor change minimal.
