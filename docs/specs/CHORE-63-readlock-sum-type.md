# Chore: readLock sum type (#28)
## Completion Criteria
- [x] LockReadResult = ok{data} | missing | corrupt (distinguishes file-missing from parse-failure).
- [x] readLock returns LockReadResult; acquireSocket + shutdown use kind/data.
- [x] Behavior preserved (missing + corrupt both → skip/remove, same as old null).
- [x] typecheck clean; router + sweep tests pass.
