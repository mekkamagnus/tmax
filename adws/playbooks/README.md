# adws/playbooks/ — legacy playbooks

**Deprecated.** The standalone runner that consumed these playbooks
(`adws/adw-run-e2e.ts`) was removed by SPEC-063 — tmax-use is its successor.

The YAML playbook format lives on in [`tmax-use/playbooks/`](../../tmax-use/playbooks/)
with the same schema (see [`tmax-use/playbooks/README.md`](../../tmax-use/playbooks/README.md)
for the current schema and runner CLI). tmax-use is wired into the adw pipeline as
the e2e track of the `test` stage, so e2e coverage of adw work continues to run
automatically.

The files in this directory (`_smoke.yaml`, `markdown.yaml`, `which-key.yaml`)
are kept as historical examples of the format. They are not run by any current
runner.

## Historical commands (no longer functional)

These commands referenced the deleted runner and are documented here only for
historical context — they no longer work:

```bash
# Removed — kept for reference:
# bun adws/adw-run-e2e.ts adws/playbooks/which-key.yaml
# bun adws/adw-run-e2e.ts
```

The equivalent tmax-use commands:

```bash
bin/tmax-use test tmax-use/playbooks/eval-01-cursor-movement.yaml
bun run test:tmax-use
```
