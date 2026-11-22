# SPEC-289 — Stagehand span/overlay API + blame mode (#296)

## Goal

Stagehand T2: the persistent span/overlay API (a display-only face
layer over buffer text) and the blame mode that consumes it — two
separately-tested halves, landed as one issue.

## Design — the API half

- **Model**: spans are `(span-make BUFFER-NAME start-line start-col
  end-line end-col FACE)` records in a per-buffer registry;
  rendering applies the face as a text-property layer during
  captureFrame (the wiki-link-display precedent — display-only,
  never buffer text).
- **Coordinates**: the SAME convention as cursor-line/cursor-column
  (0-based line, 0-based column — matching search-find-all-matches
  and the buffer API), END-EXCLUSIVE (#232). Boundary tests pin it:
  a full line is (line, 0)→(line, line-length).
- **Overlap + precedence**: overlaps allowed; the LATEST-REGISTERED
  span wins per character cell; `span-remove` unregisters; buffer
  edits DO NOT auto-track — spans are INVALIDATED (dropped) when
  their buffer's text changes (conservative honest v1; consumers
  re-apply; recorded). buffer-kill drops its registry silently.

## Design — the blame half

- `blame` (M-x + a status/log row key): `git blame --porcelain HEAD
  -- <path>` (explicit HEAD, argv). The blame FACE tints the whole
  source line; attribution (`sha author date summary`) shows ONLY
  on the echo line under point (no phantom text, no gutter).
  `n`/`p` move point line-to-line updating the echo. `RET` opens
  #290's show view for the line's commit.
- **One preflight rule** (three checks): (a) tracked
  (ls-files --error-unmatch); (b) clean vs HEAD AND nothing staged;
  (c) buffer text == on-disk file. Any failure → refuse `file
  differs from HEAD — commit first`. HEAD recorded at popup-open;
  a refresh compares and re-runs preflight+blame against the new
  HEAD. Buffer edits invalidate the spans (the API contract) and
  offer re-run via status.

## Completion criteria

- [ ] API half: span CRUD + face rendering + overlap precedence +
      edit-invalidation + kill-cleanup — unit-tested WITHOUT blame
- [ ] Blame half: porcelain parsing matrix (normal, rename origin,
      boundary commits), echo, RET → show; refusal matrix incl.
      UNTRACKED and externally-changed-file-with-clean-buffer;
      re-run after edit
- [ ] The halves reference this spec; a landing split (if any) is
      recorded in the close comment
