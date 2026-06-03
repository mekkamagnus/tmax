import type { AutoModeRule } from "./mode-state.ts";
import { normalizeExtension } from "./mode-state.ts";

export const createExtensionRule = (extension: string, mode: string): AutoModeRule => ({
  pattern: normalizeExtension(extension),
  isRegexp: false,
  mode,
});

export const createRegexpRule = (pattern: string, mode: string): AutoModeRule => ({
  pattern,
  isRegexp: true,
  mode,
});

export const detectAutoMode = (
  filename: string,
  rules: AutoModeRule[]
): string | null => {
  for (const rule of rules) {
    if (rule.isRegexp) {
      if (new RegExp(rule.pattern).test(filename)) return rule.mode;
      continue;
    }

    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
    if (normalizeExtension(ext) === normalizeExtension(rule.pattern)) return rule.mode;
  }

  return null;
};
