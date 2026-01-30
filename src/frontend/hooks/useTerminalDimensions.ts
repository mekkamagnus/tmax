/**
 * @file useTerminalDimensions.ts
 * @description Custom hook to get terminal dimensions in Ink
 * Handles both TTY and non-TTY environments with proper resize detection
 */

import { useState, useEffect } from 'react';
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from '../../constants/terminal.ts';

export interface TerminalDimensions {
  width: number;
  height: number;
}

/**
 * Hook to get terminal dimensions with automatic resize detection
 *
 * This hook:
 * - Uses process.stdout.columns/rows when available (TTY)
 * - Falls back to defaults in non-TTY environments
 * - Automatically updates when terminal resizes (SIGWINCH)
 * - Works correctly with Ink's rendering model
 */
export const useTerminalDimensions = (): TerminalDimensions => {
  const [dimensions, setDimensions] = useState<TerminalDimensions>(() => {
    // Initial dimensions from process.stdout or defaults
    return {
      width: process.stdout.columns || DEFAULT_TERMINAL_COLS,
      height: process.stdout.rows || DEFAULT_TERMINAL_ROWS,
    };
  });

  useEffect(() => {
    // Update dimensions from process.stdout
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || DEFAULT_TERMINAL_COLS,
        height: process.stdout.rows || DEFAULT_TERMINAL_ROWS,
      });
    };

    // Listen for terminal resize events
    process.stdout.on('resize', updateDimensions);

    // Initial update in case dimensions changed between render and effect
    updateDimensions();

    // Cleanup listener on unmount
    return () => {
      process.stdout.off('resize', updateDimensions);
    };
  }, []);

  return dimensions;
};
