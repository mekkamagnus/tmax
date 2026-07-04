import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createList } from "../../tlisp/values.ts";
import type { Tab } from "../../core/types.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";

export function createTabOps(
  access: EditorModelAccess,
  setTabs: (tabs: Tab[]) => void,
  setCurrentTabIndex: (index: number) => void,
  createBuffer: (name: string, content: string) => unknown,
  switchToBuffer: (tab: Tab) => void,
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: tab/index reads flow through the State monad against
  // EditorModel; writes + buffer creation/switching stay on callbacks.
  const getTabs = (): Tab[] => [...(runModel(access, readModelField("tabs")) ?? [])];
  const getCurrentTabIndex = (): number => runModel(access, readModelField("currentTabIndex")) ?? 0;
  const ops = new Map<string, TLispFunctionImpl>();

  ops.set("tab-new", (args: TLispValue[]) => {
    const name = args.length > 0 && args[0]!.type === "string"
      ? args[0]!.value as string
      : `untitled-${Date.now()}`;

    const buffer = createBuffer(name, "") as Tab["buffer"];
    const tab: Tab = { id: `tab-${Date.now()}`, label: name, buffer, bufferName: name };
    const tabs = [...getTabs(), tab];
    setTabs(tabs);
    setCurrentTabIndex(tabs.length - 1);
    switchToBuffer(tab);
    return Either.right(createString(tab.id));
  });

  ops.set("tab-close", (args: TLispValue[]) => {
    const tabs = getTabs();
    if (tabs.length <= 1) return Either.right(createNil());

    const idx = args.length > 0 && args[0]!.type === "number"
      ? args[0]!.value as number
      : getCurrentTabIndex();

    const newTabs = tabs.filter((_, i) => i !== idx);
    setTabs(newTabs);
    const newIdx = Math.min(idx, newTabs.length - 1);
    setCurrentTabIndex(newIdx);
    switchToBuffer(newTabs[newIdx]!);
    return Either.right(createNil());
  });

  ops.set("tab-next", (args: TLispValue[]) => {
    const tabs = getTabs();
    if (tabs.length === 0) return Either.right(createNil());
    const nextIdx = (getCurrentTabIndex() + 1) % tabs.length;
    setCurrentTabIndex(nextIdx);
    switchToBuffer(tabs[nextIdx]!);
    return Either.right(createNil());
  });

  ops.set("tab-prev", (args: TLispValue[]) => {
    const tabs = getTabs();
    if (tabs.length === 0) return Either.right(createNil());
    const prevIdx = (getCurrentTabIndex() - 1 + tabs.length) % tabs.length;
    setCurrentTabIndex(prevIdx);
    switchToBuffer(tabs[prevIdx]!);
    return Either.right(createNil());
  });

  ops.set("tab-switch", (args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({ type: 'EvalError' as const, variant: 'RuntimeError' as const, message: 'tab-switch requires an index', details: {} });
    }
    const idx = args[0]!.value as number;
    const tabs = getTabs();
    if (idx < 0 || idx >= tabs.length) {
      return Either.left({ type: 'EvalError' as const, variant: 'RuntimeError' as const, message: `Tab index ${idx} out of range`, details: {} });
    }
    setCurrentTabIndex(idx);
    switchToBuffer(tabs[idx]!);
    return Either.right(createNil());
  });

  ops.set("tab-list", (args: TLispValue[]) => {
    const tabs = getTabs();
    const items = tabs.map((t, i) =>
      createList([createNumber(i), createString(t.label)])
    );
    return Either.right(createList(items));
  });

  ops.set("tab-count", (args: TLispValue[]) => {
    return Either.right(createNumber(getTabs().length));
  });

  return ops;
}
