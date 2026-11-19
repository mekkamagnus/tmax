# SPEC-265: capture popup — bottom-split compose with commit-stripped skeleton

## Issue

#285 (mockup `docs/mockups/tmax-capture.html`, every claim verified against Emacs 30.1 org-capture + org-roam source).

## Decision

`capture-daily` upgrades from full-buffer switch to the **popup shape**:

1. **Geometry** — single window → `split-window-below` (50/50, Emacs's exact ratio; Emacs adapts direction by frame width, tmax fixes always-bottom per user preference). Existing layout (≥2 windows) → reuse the current window, never stack a third.
2. **Skeleton** — compose buffer seeds `capture -> <path>` header + `- [ts] ` prefix, cursor after it (Emacs `%?` placement). `capture-opened-ts` stamps at open (`%U` semantics): the entry keeps its open time.
3. **Commit-strip** — `capture-strip-skeleton` drops the header; `capture-body` removes the untouched seeded prefix (bare-prefix + trailing-space-trim cases matched explicitly) so an untouched skeleton is a no-write abort; `capture-entry` honors an edited `- [` prefix or re-adds the open-time one. Skeleton never reaches the file.
4. **Restore** — commit/abort close the popup window (when we created it) + kill `*Capture*` + restore buffer/point/mode exactly.

## Codex r1 hardening (5/10 → re-grade)

1. Target path + date + timestamp stamped at OPEN and reused at commit — a capture left open across midnight files exactly where the header says.
2. In-progress captures are re-focused, never discarded (`capture-active-p`).
3. Header strip is the exact 11-char `capture -> ` seed prefix (named `capture-header-prefix` — no magic numbers; a miscounted 10 shipped for one round and filed the header); user lines starting with "capture" pass through.
4. Existing layouts compose in the BOTTOM pane (`capture-goto-bottom-pane`); the pane's buffer is restored and focus returns to the chord's origin window (`capture-refocus`).
5. Status hint includes `C-g`.

## Completion criteria

- [x] Popup split 50/50 single-window; reuse multi-window (no third pane)
- [x] Skeleton visible; skeleton-only commit writes nothing; edited prefix passes through; absent prefix re-added from open-time ts
- [x] Existing-file append (no clobber/dup header), flat journal-dir honored, fresh skeleton per capture
- [x] 8/8 popup tests + 4/4 daily-note + 66-test regression batch; typecheck clean

## Note

Test-infra gotcha recorded: Bun's `toLocaleDateString("sv-SE")` yields the **UTC** date — it diverges from shell `date` (local) between 00:00–08:00 local; date-expecting tests derive the date from tmax itself (`shell-command "date +%Y-%m-%d"`).
