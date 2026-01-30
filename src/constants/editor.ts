/**
 * @file editor.ts
 * @description Constants for editor operations
 */

/** Maximum number of undo levels to keep */
export const MAX_UNDO_LEVELS = 100;

/** Default editor mode */
export const DEFAULT_EDITOR_MODE = 'normal';

/** Maximum file size to load in editor (bytes) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Auto-save interval in milliseconds */
export const AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds

/** Debounce time for rendering in milliseconds */
export const RENDER_DEBOUNCE_MS = 16; // ~60 FPS

/** Maximum history size for error manager */
export const MAX_ERROR_HISTORY_SIZE = 1000;

/** Default base delay for retry operations in milliseconds */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** Threshold for slow operations in milliseconds */
export const SLOW_OPERATION_THRESHOLD_MS = 1000;