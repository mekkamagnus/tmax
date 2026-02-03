/**
 * @file mx-handler.ts
 * @description M-x mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
import { getBestMatch, getFuzzyCompletions } from "../utils/fuzzy-completion.ts";

/**
 * Get all available T-Lisp function names for completion
 * @param editor - Editor instance
 * @returns Array of function names
 */
function getAvailableCommands(editor: Editor): string[] {
  const interpreter = (editor as any).getInterpreter();
  const globalEnv = interpreter.globalEnv;

  // Get all symbols from global environment
  const commands: string[] = [];
  if (globalEnv && globalEnv.bindings) {
    for (const [name, value] of globalEnv.bindings.entries()) {
      // Only include functions, not variables or other types
      if (value && value.type === "function") {
        commands.push(name);
      }
    }
  }

  return commands;
}

/**
 * Handle key input in M-x mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleMxMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  // Handle M-p (Alt+p) - previous command in history
  if (normalizedKey === "M-p") {
    const interpreter = (editor as any).getInterpreter();
    interpreter.execute("(minibuffer-history-previous)");
    return;
  }

  // Handle M-n (Alt+n) - next command in history
  if (normalizedKey === "M-n") {
    const interpreter = (editor as any).getInterpreter();
    interpreter.execute("(minibuffer-history-next)");
    return;
  }

  // Handle Tab for fuzzy completion (US-1.10.2)
  if (normalizedKey === "Tab") {
    const command = (editor as any).state.mxCommand;

    if (!command) {
      (editor as any).state.statusMessage = "No match";
      return;
    }

    // Get all available commands
    const commands = getAvailableCommands(editor);

    if (commands.length === 0) {
      (editor as any).state.statusMessage = "No commands available";
      return;
    }

    // Try to find best match
    const bestMatch = getBestMatch(command, commands);

    if (bestMatch) {
      // Single match - complete it
      (editor as any).state.mxCommand = bestMatch;
      (editor as any).state.statusMessage = `Completed: ${bestMatch}`;
    } else {
      // Multiple matches - show them
      const completions = getFuzzyCompletions(command, commands);

      if (completions.length === 0) {
        (editor as any).state.statusMessage = "No match";
      } else {
        // Show up to 5 matches in status message
        const matchesToShow = completions.slice(0, 5).map(c => c.command).join(", ");
        const more = completions.length > 5 ? ` (+${completions.length - 5} more)` : "";
        (editor as any).state.statusMessage = `Matches: ${matchesToShow}${more}`;
      }
    }
    return;
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    // Add character to M-x command
    (editor as any).state.mxCommand += key;
  } else if (normalizedKey === "Backspace") {
    // Remove last character from M-x command
    (editor as any).state.mxCommand = (editor as any).state.mxCommand.slice(0, -1);
  } else if (normalizedKey === "Enter") {
    // Execute M-x command
    const command = (editor as any).state.mxCommand;
    
    if (command) {
      // Add to command history
      const interpreter = (editor as any).getInterpreter();
      interpreter.execute(`(minibuffer-history-add "${command}")`);
      
      // Execute the command
      (editor as any).executeCommand(`(${command})`);
    }
    
    // Clear M-x command after execution and return to normal mode
    (editor as any).state.mxCommand = "";
    (editor as any).state.mode = "normal";
  } else if (normalizedKey === "Escape" || normalizedKey === "C-g") {
    (editor as any).state.mode = "normal";
    (editor as any).state.mxCommand = "";
  } else {
    // For other keys, treat as regular key mappings
    const keyMappings = (editor as any).keyMappings; // Access private property
    const mappings = keyMappings.get(normalizedKey);

    if (!mappings) {
      (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
    } else {
      // Find mapping for mx mode
      const mapping = mappings.find((m: any) => !m.mode || m.mode === "mx");
      if (!mapping) {
        (editor as any).state.statusMessage = `Unbound key in mx mode: ${normalizedKey}`;
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