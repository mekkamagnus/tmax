/**
 * @file command-handler.ts
 * @description Command mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
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
    const commandLine = (editor as any).state.commandLine;
    handlerLog.info('Executing command line', {
      data: { command: commandLine }
    });
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    // Add character to command line
    (editor as any).state.commandLine += key;
    return; // Don't process this key further
  } else if (normalizedKey === "Backspace") {
    // Remove last character from command line
    (editor as any).state.commandLine = (editor as any).state.commandLine.slice(0, -1);
    return; // Don't process this key further
  } else if (normalizedKey === "Escape") {
    (editor as any).state.mode = "normal";
    (editor as any).state.commandLine = "";
    return; // Don't process this key further
  } else if (normalizedKey === "Enter") {
    // Execute the command line through the T-Lisp key binding system
    // This ensures proper integration with the T-Lisp interpreter
    try {
      (editor as any).executeCommand(`(editor-execute-command-line)`);
      handlerLog.info('Command executed successfully', {
        data: { command: (editor as any).state.commandLine }
      });
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        handlerLog.info('Quit signal received from command', {
          data: { signal: error.message }
        });
        throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
      }

      const err = error instanceof Error ? error : new Error(String(error));
      handlerLog.error('Command execution failed', err, {
        operation: 'command-line',
        data: { command: (editor as any).state.commandLine }
      });

      (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
    }

    // Clear command line and return to normal mode
    (editor as any).state.commandLine = "";
    (editor as any).state.mode = "normal";
    return; // Don't process this key further
  }
  // For other keys, fall through to key binding system
  else {
    const keyMappings = (editor as any).keyMappings; // Access private property
    const mappings = keyMappings.get(normalizedKey);

    if (!mappings) {
      (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
    } else {
      // Find mapping for command mode
      const mapping = mappings.find((m: any) => !m.mode || m.mode === "command");
      if (!mapping) {
        (editor as any).state.statusMessage = `Unbound key in command mode: ${normalizedKey}`;
      } else {
        // Execute the mapped command
        try {
          (editor as any).executeCommand(mapping.command);
        } catch (error) {
          if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
            throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
          }
          (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }
  }
}