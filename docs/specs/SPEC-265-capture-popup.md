# SPEC-265: capture popup — bottom-split compose with commit-stripped skeleton

## Issue

#285 (mockup `docs/mockups/tmax-capture.html`, every claim verified against Emacs 30.1 org-capture + org-roam source).

## Decision

`capture-daily` upgrades from full-buffer switch to the **popup shape**:

1. **Geometry** — the compose pane is always a LOWER pane (mockup): single window splits 50/50 bottom (Emacs's exact ratio; Emacs adapts direction by frame width, tmax fixes always-bottom); an existing layout reuses a pane below the origin when one exists in its column, and otherwise SPLITS the column-bottom pane (side-by-side layouts grow a third pane this way — geometry beats pane-count).
2. **Skeleton** — compose buffer seeds `capture -> <path>` header + `- [ts] ` prefix, cursor after it (Emacs `%?` placement). `capture-opened-ts` stamps at open (`%U` semantics): the entry keeps its open time.
3. **Commit-strip** — `capture-strip-skeleton` drops the header; `capture-body` removes the untouched seeded prefix (bare-prefix + trailing-space-trim cases matched explicitly) so an untouched skeleton is a no-write abort; `capture-entry` honors an edited `- [` prefix or re-adds the open-time one. Skeleton never reaches the file.
4. **Restore** — commit/abort close the popup window (when we created it) + kill `*Capture*` + restore buffer/point/mode exactly.

## Codex r1 hardening (5/10 → re-grade)

1. Target path + date + timestamp stamped at OPEN and reused at commit — a capture left open across midnight files exactly where the header says.
2. In-progress captures are re-focused, never discarded (`capture-active-p`).
3. Header strip is the exact 11-char `capture -> ` seed prefix (named `capture-header-prefix` — no magic numbers; a miscounted 10 shipped for one round and filed the header); user lines starting with "capture" pass through.
4. Existing layouts compose in the BOTTOM pane (`capture-goto-bottom-pane`); the pane's buffer is restored and focus returns to the chord's origin window (`capture-refocus`).
5. Status hint includes `C-g`.

## Restore policy (codex r5-r6)

Abort/commit restore the ORIGIN pane (located by buffer), close the popup pane (located by buffer), and revert any pane the recovery used. A HIDDEN popup — the user switched its pane's buffer away — is unidentifiable afterwards; restore is CONSERVATIVE: the compose buffer is killed, the origin pane survives focused, and no pane the restore cannot identify is ever deleted (deleting by guess was the r5 bug).

## Completion criteria

- [x] Popup split 50/50 single-window; reuse multi-window (no third pane)
- [x] Skeleton visible; skeleton-only commit writes nothing; edited prefix passes through; absent prefix re-added from open-time ts
- [x] Existing-file append (no clobber/dup header), flat journal-dir honored, fresh skeleton per capture
- [x] 8/8 popup tests + 4/4 daily-note + 66-test regression batch; typecheck clean

## Note

Test-infra gotcha recorded: Bun's `toLocaleDateString("sv-SE")` yields the **UTC** date — it diverges from shell `date` (local) between 00:00–08:00 local; date-expecting tests derive the date from tmax itself (`shell-command "date +%Y-%m-%d"`).
