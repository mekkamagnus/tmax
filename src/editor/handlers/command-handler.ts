/**
 * @file command-handler.ts
 * @description Command mode key handler for the editor
 */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";
import { resolveMapping } from "../key-resolution.ts";
import { log } from "../../utils/logger.ts";

/**
 * Handle key input in command mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleCommandMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
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
    editor.applyUpdate({ type: "AppendCommandLine", char: key });
    return; // Don't process this key further
  } else if (normalizedKey === "Backspace") {
    // Remove last character from command line
    const model = editor.getModel();
    editor.applyUpdate({ type: "SetCommandLine", value: model.commandLine.slice(0, -1) });
    return; // Don't process this key further
  } else if (normalizedKey === "Escape") {
    editor.applyUpdate({ type: "SetMode", mode: "normal" });
    editor.applyUpdate({ type: "ClearCommandLine" });
    return; // Don't process this key further
  } else if (normalizedKey === "Enter") {
    // CHORE-44 Change 6 (AC6.2): the command-line parsing policy lives in
    // T-Lisp now. The handler passes the raw command line as a runtime
    // string argument to the T-Lisp dispatcher; it owns no command-specific
    // regex and no command-specific decisions.
    const cmdLine = editor.getModel().commandLine;
    const escaped = editor.escapeKeyForTLisp(cmdLine);

    try {
      editor.executeCommand(`(editor-dispatch-command-line "${escaped}")`);
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
      editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
      editor.logMessage(`Command error: ${errorMsg}`, 'error');
    }

    // Clear command line and return to normal mode
    editor.applyUpdate({ type: "ClearCommandLine" });
    editor.applyUpdate({ type: "SetMode", mode: "normal" });
    return; // Don't process this key further
  }
  // For other keys, fall through to key binding system
  else {
    const mappings = editor.getKeyMappings().get(normalizedKey);

    if (!mappings) {
      editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key: ${normalizedKey}` });
      editor.logMessage(`Unbound key: ${normalizedKey}`, 'warn');
    } else {
      // Find mapping for command mode
      const currentMajorMode = editor.getCurrentMajorMode();
      const mapping = resolveMapping(mappings, "command", currentMajorMode);
      if (!mapping) {
        editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key in command mode: ${normalizedKey}` });
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
          editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
          editor.logMessage(`Command error: ${errorMsg}`, 'error');
        }
      }
    }
  }
}
