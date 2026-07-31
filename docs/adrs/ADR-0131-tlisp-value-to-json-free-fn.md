# ADR-0131 — tlispValueToJson as a free function (#20)
## Status: Accepted
## Context: tlispValueToJson (TLisp→JSON) was a private method on TmaxServer, forcing ServerContext to carry it.
## Decision: Free function in src/tlisp/serialization.ts. server.ts delegates. asTlisp (JSON→TLisp, the inverse) stays separate.
## Consequences: Pure function testable in isolation; ServerContext method preserved for compatibility.
