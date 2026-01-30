/**
 * @file buffer.ts
 * @description Constants for buffer operations
 */

/** Default size for new buffers */
export const DEFAULT_BUFFER_SIZE = 64;

/** Factor by which to grow buffer when needed */
export const BUFFER_GROWTH_FACTOR = 2;

/** Maximum allowed buffer size */
export const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB limit

/** Maximum undo levels to store */
export const MAX_UNDO_LEVELS = 100;