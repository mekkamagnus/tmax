/**
 * @file macro-persistence.ts
 * @description Macro persistence functionality (US-2.4.2)
 * Saves and loads keyboard macros from ~/.config/tmax/macros.tlisp
 */

import type { FileSystem } from "../../core/types.ts";
import type { TLispValue } from "../../tlisp/values.ts";
import { getMacros } from "./macro-recording.ts";

/**
 * Get the path to the macros file
 * @returns Path to macros.tlisp
 */
export function getMacrosFilePath(): string {
  const homeDir = process.env.HOME || "/Users/test";
  return `${homeDir}/.config/tmax/macros.tlisp`;
}

/**
 * Ensure the directory for macros file exists
 * @param fs - Filesystem instance
 * @returns Promise that resolves when directory is created
 */
async function ensureDirectoryExists(fs: FileSystem): Promise<void> {
  const homeDir = process.env.HOME || "/Users/test";
  const configDir = `${homeDir}/.config`;
  const tmaxDir = `${configDir}/tmax`;

  // Check if directories exist, create if needed
  try {
    await fs.readdir(tmaxDir);
  } catch {
    // Directory doesn't exist, create it
    try {
      await fs.mkdir(tmaxDir, { recursive: true });
    } catch (error) {
      // Ignore error if directory already exists
    }
  }
}

/**
 * Save recorded macros to file
 * @param fs - Filesystem instance
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function saveMacrosToFile(fs: FileSystem): Promise<boolean> {
  try {
    // Ensure directory exists
    await ensureDirectoryExists(fs);

    // Get all recorded macros
    const macros = getMacros();

    // Build T-Lisp code for each macro
    const lines: string[] = [
      ";; tmax macros file",
      ";; Auto-generated from recorded macros",
      ";; DO NOT EDIT this section - comments below",
      ""
    ];

    for (const [register, keys] of macros.entries()) {
      // Create defmacro form: (defmacro macro-<register> '(key1 key2 key3))
      const macroName = `macro-${register}`;
      const keysList = keys.map(k => `"${k}"`).join(" ");
      lines.push(`(defmacro ${macroName}`);
      lines.push(`  '(${keysList}))`);
      lines.push("");
    }

    const content = lines.join("\n");

    // Write to file
    const filePath = getMacrosFilePath();
    await fs.writeFile(filePath, content);

    return true;
  } catch (error) {
    console.error("Failed to save macros:", error);
    return false;
  }
}

/**
 * Load macros from file
 * @param fs - Filesystem instance
 * @returns Promise that resolves to true if successful, false if file doesn't exist or error
 */
export async function loadMacrosFromFile(fs: FileSystem): Promise<boolean> {
  try {
    const filePath = getMacrosFilePath();

    // Try to read the file
    let content: string;
    try {
      content = await fs.readFile(filePath);
    } catch (error) {
      // File doesn't exist, not an error
      return false;
    }

    // Parse the T-Lisp code to extract macro definitions
    // The format is:
    // (defmacro macro-a
    //   '("key1" "key2" "key3"))
    // We need to match this multi-line format

    // Import the setMacro function
    const { setMacro } = await import("./macro-recording.ts");

    // Split by lines and look for defmacro patterns
    const lines = content.split("\n");

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Look for defmacro line
      const defmacroMatch = line.match(/\(defmacro\s+macro-([a-z0-9]+)/);
      if (defmacroMatch) {
        const register = defmacroMatch[1];

        // The next line should contain the keys list
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();

          // Extract keys from '("key1" "key2" "key3") format
          // Find the position of '( and extract everything until the final ))
          const quotePos = nextLine.indexOf("'(");
          if (quotePos !== -1) {
            // Find the final closing )) by counting from the end
            const contentStart = quotePos + 2; // After '(
            // Find the matching )) by looking for the last ))
            const lastDoubleParen = nextLine.lastIndexOf("))");
            if (lastDoubleParen !== -1) {
              const keysList = nextLine.substring(contentStart, lastDoubleParen + 1); // Include the final )

              // Parse quoted strings like "key1" "key2" "key3"
              const keys: string[] = [];
              const quotedStrings = keysList.match(/"([^"]*)"/g);
              if (quotedStrings) {
                for (const quoted of quotedStrings) {
                  // Remove the surrounding quotes
                  keys.push(quoted.slice(1, -1));
                }
              }

              // Set the macro
              setMacro(register, keys);
            }
          }
        }
      }

      i++;
    }

    return true;
  } catch (error) {
    console.error("Failed to load macros:", error);
    return false;
  }
}
