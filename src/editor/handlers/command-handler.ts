/**
 * @file command-handler.ts
 * @description Command mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
import { resolveMapping } from "../editor.ts";
import { log } from "../../utils/logger.ts";

/**
 * Handle key input in command mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleCommandMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleCommandMode');

  // Log Escape key to return to normal mode
  if (normalizedKey === "Escape") {
    handlerLog.info('Cancelling command mode, returning to normal mode', {
      data: {
        triggerKey: 'Escape',
        fromMode: 'command',
        commandWasCancelled: true
      }
    });
  }

  // Log Enter key to execute command
  if (normalizedKey === "Enter") {
    const commandLine = editor.getModel().commandLine;
    handlerLog.info('Executing command line', {
      data: { command: commandLine }
    });
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    // Add character to command line
    editor.patchModel({ commandLine: editor.getModel().commandLine + key });
    return; // Don't process this key further
  } else if (normalizedKey === "Backspace") {
    // Remove last character from command line
    const model = editor.getModel();
    editor.patchModel({ commandLine: model.commandLine.slice(0, -1) });
    return; // Don't process this key further
  } else if (normalizedKey === "Escape") {
    editor.patchModel({ mode: "normal", commandLine: "" });
    return; // Don't process this key further
  } else if (normalizedKey === "Enter") {
    // Execute the command line through the T-Lisp key binding system
    const cmdLine = editor.getModel().commandLine;

    // SPEC-035: Dispatch special command patterns
    try {
      if (cmdLine === "dired" || cmdLine.startsWith("dired ")) {
        const dir = cmdLine === "dired" ? "." : cmdLine.slice(6).trim();
        editor.executeCommand(`(dired "${dir}")`);
      } else if (/^%s\/(.+)\/(.+)\/([gic]*)$/.test(cmdLine)) {
        // :%s/find/replace/flags — whole-buffer replace
        const m = cmdLine.match(/^%s\/(.+)\/(.+)\/([gic]*)$/)!;
        const escapedFind = m[1]!.replace(/"/g, '\\"');
        const escapedReplace = m[2]!.replace(/"/g, '\\"');
        editor.executeCommand(`(query-replace "${escapedFind}" "${escapedReplace}")`);
      } else if (/^s\/(.+)\/(.*)\/?$/.test(cmdLine)) {
        // :s/find/replace — current-line replace
        const m = cmdLine.match(/^s\/(.+)\/(.*)\/?$/)!;
        const escapedFind = m[1]!.replace(/"/g, '\\"');
        const escapedReplace = (m[2] || "").replace(/"/g, '\\"');
        editor.executeCommand(`(replace-find-matches "${escapedFind}")`);
        editor.executeCommand(`(replace-apply-all)`);
      } else {
        editor.executeCommand(`(editor-execute-command-line)`);
      }
      handlerLog.info('Command executed successfully', {
        data: { command: cmdLine }
      });
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        handlerLog.info('Quit signal received from command', {
          data: { signal: error.message }
        });
        throw new Error("EDITOR_QUIT_SIGNAL");
      }

      const err = error instanceof Error ? error : new Error(String(error));
      handlerLog.error('Command execution failed', err, {
        operation: 'command-line',
        data: { command: cmdLine }
      });

      const errorMsg = error instanceof Error ? error.message : String(error);
      editor.patchModel({ statusMessage: `Command error: ${errorMsg}` });
      editor.logMessage(`Command error: ${errorMsg}`, 'error');
    }

    // Clear command line and return to normal mode
    editor.patchModel({ commandLine: "", mode: "normal" });
    return; // Don't process this key further
  }
  // For other keys, fall through to key binding system
  else {
    const mappings = editor.getKeyMappings().get(normalizedKey);

    if (!mappings) {
      editor.patchModel({ statusMessage: `Unbound key: ${normalizedKey}` });
      editor.logMessage(`Unbound key: ${normalizedKey}`, 'warn');
    } else {
      // Find mapping for command mode
      const currentMajorMode = editor.getCurrentMajorMode();
      const mapping = resolveMapping(mappings, "command", currentMajorMode);
      if (!mapping) {
        editor.patchModel({ statusMessage: `Unbound key in command mode: ${normalizedKey}` });
        editor.logMessage(`Unbound key in command mode: ${normalizedKey}`, 'warn');
      } else {
        // Execute the mapped command
        try {
          editor.executeCommand(mapping.command);
        } catch (error) {
          if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
            throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
          }
          const errorMsg = error instanceof Error ? error.message : String(error);
          editor.patchModel({ statusMessage: `Command error: ${errorMsg}` });
          editor.logMessage(`Command error: ${errorMsg}`, 'error');
        }
      }
    }
  }
}
