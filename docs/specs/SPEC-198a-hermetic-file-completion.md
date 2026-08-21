# SPEC-198a: hermetic file-completion fixture (partial — #198 item 1)

**Issue:** #198 (CI green-up) — this spec covers ONLY the locally-verifiable
first item: make the environment-dependent `find-file shows candidates from
current directory` batch hermetic. Items 2 (4 runner-failing tmax-use
playbooks) and 3 (key-bind-enhancements behavioral decision) remain OPEN on
#198 and need CI-runner evidence / a user decision respectively.

## Goal

`test/unit/file-completion.test.ts` asserts the CHECKOUT's cwd listing
("src", "package.json") — on CI runners the listing differs, so the batch
fails and the halt-on-first-failing-batch runner stops there. Replace the
environment dependence with a fixture tree.

## Completion Criteria

- [x] The file's tests run against a temp fixture directory containing
      exactly the entries the assertions reference (src/core/, package.json,
      README.md) — created in `beforeAll`, cwd restored in `afterAll`.
- [x] All 6 tests in the file pass against the fixture locally.
- [x] No other unit test asserts the checkout cwd listing (grep-verified:
      file-completion.test.ts was the only cwd-coupled file).
- [x] `bun run typecheck:test` green.
- [x] #198 stays open with an evidence comment mapping item 1 → this landing
      and items 2–3 → their owners (CI evidence; user decision).

## Notes

- Full `bun run test:unit` green is NOT claimed here — the runner still halts
  on the pre-existing markdown-module-boundaries failures (#227) and
  key-bind-enhancements (deliberate decision, #198 item 3).
- The hermetic fixture relies on bun's per-file test isolation; cwd is
  restored unconditionally in afterAll.
