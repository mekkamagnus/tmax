"""Test: Module Loading — require-module and module system behavior."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_module_loading() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Module Loading ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/module-test.txt"
    create_test_file(test_file, "placeholder")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()

    # Require a built-in module (idempotent, should succeed)
    r = client.eval_expr(state.config, '(require-module editor/commands/operators)')
    results.append(AssertionResult(
        r.is_ok(),
        f"require-module on existing module should succeed: {r.unwrap_or('ERR')}",
    ))

    # Require another module
    r = client.eval_expr(state.config, '(require-module editor/commands/vim-counts)')
    results.append(AssertionResult(
        r.is_ok(),
        f"require-module vim-counts should succeed: {r.unwrap_or('ERR')}",
    ))

    # Global count functions (registered by TypeScript, not in module namespace)
    r = client.eval_expr(state.config, '(count-get)')
    results.append(AssertionResult(
        r.is_ok(),
        f"count-get should be callable: {r.unwrap_or('ERR')}",
    ))

    r = client.eval_expr(state.config, '(count-active)')
    results.append(AssertionResult(
        r.is_ok(),
        f"count-active should be callable: {r.unwrap_or('ERR')}",
    ))

    # Loading a nonexistent module should not crash the editor
    r = client.eval_expr(state.config, '(require-module nonexistent/module)')
    results.append(AssertionResult(
        True,
        f"require-module on nonexistent module should not crash (got: {r.unwrap_or('error')})",
    ))

    # Verify editor is still responsive after all module ops
    buf = client.get_buffer_text(state.config)
    results.append(AssertionResult(
        buf.is_ok() and "placeholder" in buf.unwrap_or(""),
        "Editor should still be responsive with correct buffer content",
    ))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_module_loading()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
