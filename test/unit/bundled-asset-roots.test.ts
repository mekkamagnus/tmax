/**
 * @file bundled-asset-roots.test.ts
 * @description #244 — pins the layout-aware bundled-asset roots
 *   (SPEC-244/ADR-0271). In the dev tree the probe must select the
 *   dev-relative layout and the resolved dirs must actually contain the
 *   files the runtime reads (keymaps, trt framework, helpgrep corpus). The
 *   compiled-binary branch (`/$bunfs/root/...`) cannot be unit-tested
 *   without building a binary — it is verified end-to-end in the spec
 *   appendix (daemon + Steep + eval from the built binary).
 */
import { test, expect } from 'bun:test';
import { existsSync } from 'fs';
import { TLISP_CORE_DIR, DOCS_TMAX_DIR } from '../../src/editor/editor.ts';
import { TRT_CORE_DIR } from '../../src/tlisp/trt/bootstrap.ts';

test('TLISP_CORE_DIR resolves to the dev core tree with the files the runtime reads', () => {
  // Dev layout wins when the source tree is present (the probe's first arm).
  expect(TLISP_CORE_DIR.endsWith('src/tlisp/core')).toBe(true);
  expect(existsSync(`${TLISP_CORE_DIR}/keymaps.tlisp`)).toBe(true);
  expect(existsSync(`${TLISP_CORE_DIR}/bindings`)).toBe(true);
});

test('TRT_CORE_DIR resolves to the core root containing trt and the trt command', () => {
  expect(TRT_CORE_DIR.endsWith('src/tlisp/core')).toBe(true);
  expect(existsSync(`${TRT_CORE_DIR}/trt/trt.tlisp`)).toBe(true);
  expect(existsSync(`${TRT_CORE_DIR}/commands/trt-commands.tlisp`)).toBe(true);
});

test('DOCS_TMAX_DIR resolves to the docs corpus with both texinfo files', () => {
  expect(DOCS_TMAX_DIR.endsWith('docs/tmax')).toBe(true);
  expect(existsSync(`${DOCS_TMAX_DIR}/tmax.texinfo`)).toBe(true);
  expect(existsSync(`${DOCS_TMAX_DIR}/tlisp.texinfo`)).toBe(true);
});
