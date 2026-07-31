# ADR-0139 — resolveFrameOptional non-throwing (#27)
## Status: Accepted
## Context: resolveFrameOptional wrapped the throwing resolveFrame in try/catch to convert "Frame not found" to undefined.
## Decision: Added getFrameOption (non-throwing Map lookup). resolveFrameOptional uses it directly. resolveFrame (throwing) unchanged.
## Consequences: No exception-as-control-flow; same observable behavior.
