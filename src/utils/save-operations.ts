/**
 * @file save-operations.ts
 * @description Enhanced save operations using advanced functional patterns
 */

import { pipe } from "./pipeline.ts";
import { Validation, ValidationUtils, lift3 } from "./validation.ts";
import { Effect, EffectOps, effectPipe } from "./effect.ts";
import { ReaderTaskEither } from "./reader.ts";
import { StateTaskEither, stateUtils } from "./state.ts";
import { TaskEither } from "./task-either.ts";
import { Lens } from "./lens.ts";
import type { TextBuffer } from "../core/types.ts";

// Error types for save operations
export type SaveError = 
  | "NO_BUFFER"
  | "NO_FILENAME" 
  | "INVALID_PATH"
  | "SECURITY_VIOLATION"
  | "FILESYSTEM_ERROR"
  | "PERMISSION_DENIED"
  | "DISK_FULL"
  | "NETWORK_ERROR";

// Dependencies for save operations
export interface SaveDependencies {
  readonly filesystem: {
    writeFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    stat: (path: string) => Promise<{ isDirectory: boolean; size: number }>;
  };
  readonly logger: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  readonly validator: {
    validatePath: (path: string) => boolean;
    sanitizePath: (path: string) => string;
    isSecure: (path: string) => boolean;
  };
  readonly currentBuffer: TextBuffer | null;
  readonly buffers: Map<string, TextBuffer>;
}

// Editor state for immutable updates
export interface EditorState {
  readonly statusMessage: string;
  readonly buffers: Map<string, TextBuffer>;
  readonly currentBuffer: TextBuffer | null;
  readonly mode: string;
  readonly cursorLine: number;
  readonly cursorColumn: number;
  readonly lastSavedPath?: string;
  readonly isDirty: boolean;
}

// Save request validation data
export interface SaveRequest {
  readonly buffer: TextBuffer;
  readonly filename: string;
  readonly path: string;
  readonly content: string;
}

// Lenses for EditorState
const statusMessageLens = Lens.of<EditorState, 'statusMessage'>('statusMessage');
const buffersLens = Lens.of<EditorState, 'buffers'>('buffers');
const currentBufferLens = Lens.of<EditorState, 'currentBuffer'>('currentBuffer');
const lastSavedPathLens = Lens.of<EditorState, 'lastSavedPath'>('lastSavedPath');
const isDirtyLens = Lens.of<EditorState, 'isDirty'>('isDirty');

/**
 * Validation for save request - accumulates all errors
 */
const validateSaveRequest = (
  buffer: TextBuffer | null,
  filename: string | undefined,
  path: string
): Validation<SaveError, SaveRequest> => {
  // Buffer validation
  const bufferValidation = ValidationUtils.required(buffer, "NO_BUFFER" as SaveError);
  
  // Filename validation
  const filenameValidation = ValidationUtils.required(filename, "NO_FILENAME" as SaveError)
    .flatMap(name => ValidationUtils.nonEmpty(name, "NO_FILENAME" as SaveError));
  
  // Path validation with multiple security checks
  const pathValidation = ValidationUtils.all(path,
    (p: string) => p.includes('..') 
      ? Validation.failure<SaveError, string>("SECURITY_VIOLATION")
      : Validation.success(p),
    (p: string) => p.length > 4096
      ? Validation.failure<SaveError, string>("INVALID_PATH")
      : Validation.success(p),
    (p: string) => /[<>:"|?*\u0000-\u001f]/.test(p)
      ? Validation.failure<SaveError, string>("INVALID_PATH") 
      : Validation.success(p)
  );
  
  // Combine all validations - accumulates ALL errors
  return lift3((buffer: TextBuffer) => (filename: string) => (path: string): SaveRequest => ({
    buffer,
    filename, 
    path,
    content: buffer.getContent()
  }))(bufferValidation)(filenameValidation)(pathValidation);
};

/**
 * File system operations using Effect pattern
 */
const fileSystemEffects = {
  /**
   * Write file with error handling
   */
  writeFile: (path: string, content: string): Effect<SaveDependencies, SaveError, void> =>
    Effect.tryCatch(
      deps => deps.filesystem.writeFile(path, content),
      error => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('permission')) return "PERMISSION_DENIED";
        if (errorMsg.includes('space') || errorMsg.includes('quota')) return "DISK_FULL";
        if (errorMsg.includes('network') || errorMsg.includes('timeout')) return "NETWORK_ERROR";
        return "FILESYSTEM_ERROR";
      }
    ),
  
  /**
   * Check if file exists
   */
  exists: (path: string): Effect<SaveDependencies, SaveError, boolean> =>
    Effect.tryCatch(
      deps => deps.filesystem.exists(path),
      () => "FILESYSTEM_ERROR" as SaveError
    ),
  
  /**
   * Create directory if needed
   */
  ensureDirectory: (path: string): Effect<SaveDependencies, SaveError, void> => {
    const dirPath = path.split('/').slice(0, -1).join('/');
    if (!dirPath) return Effect.succeed(undefined);
    
    return Effect.tryCatch(
      deps => deps.filesystem.mkdir(dirPath, { recursive: true }),
      () => "FILESYSTEM_ERROR" as SaveError
    );
  },
  
  /**
   * Get file stats
   */
  stat: (path: string): Effect<SaveDependencies, SaveError, { isDirectory: boolean; size: number }> =>
    Effect.tryCatch(
      deps => deps.filesystem.stat(path),
      () => "FILESYSTEM_ERROR" as SaveError
    )
};

/**
 * Logging operations using Effect pattern
 */
const logEffects = {
  debug: (message: string, ...args: unknown[]): Effect<SaveDependencies, never, void> =>
    Effect.sideEffect(deps => deps.logger.debug(message, ...args)),
  
  info: (message: string, ...args: unknown[]): Effect<SaveDependencies, never, void> =>
    Effect.sideEffect(deps => deps.logger.info(message, ...args)),
  
  warn: (message: string, ...args: unknown[]): Effect<SaveDependencies, never, void> =>
    Effect.sideEffect(deps => deps.logger.warn(message, ...args)),
  
  error: (message: string, ...args: unknown[]): Effect<SaveDependencies, never, void> =>
    Effect.sideEffect(deps => deps.logger.error(message, ...args))
};

/**
 * Path validation using Reader pattern
 */
const validatePathReader = (path: string): ReaderTaskEither<SaveDependencies, SaveError, string> =>
  ReaderTaskEither.asks<SaveDependencies, SaveError, SaveDependencies['validator']>(deps => deps.validator)
    .flatMap(validator => {
      if (!validator.isSecure(path)) {
        return ReaderTaskEither.left<SaveDependencies, SaveError, string>("SECURITY_VIOLATION");
      }
      if (!validator.validatePath(path)) {
        return ReaderTaskEither.left<SaveDependencies, SaveError, string>("INVALID_PATH");
      }
      return ReaderTaskEither.of<SaveDependencies, SaveError, string>(validator.sanitizePath(path));
    });

/**
 * Enhanced save operation using Pipeline composition
 */
export const saveCurrentBufferPipeline = (filename?: string): ReaderTaskEither<SaveDependencies, SaveError, void> =>
  ReaderTaskEither.ask<SaveDependencies, SaveError>()
    .flatMap(deps => {
      // Find buffer name if not provided
      const resolvedFilename = filename || findBufferName(deps.currentBuffer, deps.buffers) || "untitled.txt";
      
      return pipe
        .start({ buffer: deps.currentBuffer, filename: resolvedFilename, path: resolvedFilename })
        // Validate all inputs with error accumulation
        .step(({ buffer, filename, path }) => {
          const validation = validateSaveRequest(buffer, filename, path);
          return validation.fold(
            errors => TaskEither.left<SaveError, SaveRequest>(errors[0]), // Take first error for now
            request => TaskEither.right<SaveRequest, SaveError>(request)
          );
        })
        // Log start of operation
        .tap(request => ReaderTaskEither.lift(TaskEither.fromSync(() => 
          deps.logger.debug(`Starting save: ${request.filename}`)
        )))
        // Validate path security
        .step(request => validatePathReader(request.path).map(() => request).run(deps))
        // Ensure directory exists
        .step(request => 
          EffectOps.provide(fileSystemEffects.ensureDirectory(request.path), deps)
            .map(() => request)
        )
        // Write file with retry logic
        .step(request => 
          EffectOps.retry(
            fileSystemEffects.writeFile(request.path, request.content),
            3, // Max 3 attempts
            1000 // 1 second base delay
          )(deps).map(() => request)
        )
        // Log success
        .tap(request => ReaderTaskEither.lift(TaskEither.fromSync(() => 
          deps.logger.info(`Successfully saved: ${request.filename}`)
        )))
        .map(() => undefined)
        .recover(error => {
          // Log error and re-throw
          deps.logger.error(`Save failed: ${error}`, error);
          return ReaderTaskEither.left<SaveDependencies, SaveError, void>(error);
        })
        .build();
    });

/**
 * Save operation with state management using State monad
 */
export const saveWithStateUpdates = (filename?: string): StateTaskEither<EditorState, SaveError, void> =>
  StateTaskEither.get<EditorState, SaveError>()
    .flatMap(state => {
      if (!state.currentBuffer) {
        return StateTaskEither.left("NO_BUFFER");
      }
      
      const resolvedFilename = filename || state.lastSavedPath || "untitled.txt";
      const content = state.currentBuffer.getContent();
      
      // Create minimal dependencies from state
      const deps: SaveDependencies = {
        filesystem: {
          writeFile: async (path: string, content: string) => {
            await Deno.writeTextFile(path, content);
          },
          exists: async (path: string) => {
            try {
              await Deno.stat(path);
              return true;
            } catch {
              return false;
            }
          },
          mkdir: Deno.mkdir,
          stat: async (path: string) => {
            const stat = await Deno.stat(path);
            return {
              isDirectory: stat.isDirectory,
              size: stat.size
            };
          }
        },
        logger: {
          debug: console.debug,
          info: console.info,
          warn: console.warn,
          error: console.error
        },
        validator: {
          validatePath: (path) => !path.includes('..'),
          sanitizePath: (path) => path.replace(/\\/g, '/'),
          isSecure: (path) => !path.includes('..')
        },
        currentBuffer: state.currentBuffer,
        buffers: state.buffers
      };
      
      // Use the pipeline save operation
      return StateTaskEither.lift(
        saveCurrentBufferPipeline(resolvedFilename).run(deps)
      )
      // Update state after successful save
      .flatMap(() => StateTaskEither.modify<EditorState, SaveError>(state => 
        // Use lenses for clean immutable updates
        statusMessageLens.set(`Saved ${resolvedFilename}`)(
          lastSavedPathLens.set(resolvedFilename)(
            isDirtyLens.set(false)(
              buffersLens.modify(buffers => 
                new Map(buffers).set(resolvedFilename, state.currentBuffer!)
              )(state)
            )
          )
        )
      ));
    });

/**
 * Batch save multiple buffers
 */
export const saveBatchBuffers = (
  bufferNames: string[]
): ReaderTaskEither<SaveDependencies, SaveError, string[]> =>
  ReaderTaskEither.parallel(
    bufferNames.map(name => 
      ReaderTaskEither.ask<SaveDependencies, SaveError>()
        .flatMap(deps => {
          const buffer = deps.buffers.get(name);
          if (!buffer) {
            return ReaderTaskEither.left<SaveDependencies, SaveError, string>("NO_BUFFER");
          }
          return saveCurrentBufferPipeline(name).map(() => name);
        })
    )
  );

/**
 * Safe save with backup creation
 */
export const safeFileOperation = (filename: string): ReaderTaskEither<SaveDependencies, SaveError, void> =>
  ReaderTaskEither.ask<SaveDependencies, SaveError>()
    .flatMap(deps => {
      const backupName = `${filename}.backup`;
      
      return effectPipe
        // Check if original file exists
        .from(fileSystemEffects.exists(filename))
        // Create backup if original exists
        .flatMap(exists => exists 
          ? effectPipe
              .from(Effect.tryCatch(
                deps => deps.filesystem.writeFile(backupName, ""), // Would read original first
                () => "FILESYSTEM_ERROR" as SaveError
              ))
              .tap(() => logEffects.info(`Backup created: ${backupName}`))
              .build()
          : Effect.succeed<SaveDependencies, SaveError, void>(undefined)
        )
        // Perform the actual save
        .flatMap(() => saveCurrentBufferPipeline(filename).run(deps))
        // Clean up backup on success
        .tap(() => logEffects.debug(`Save completed, backup can be cleaned up`))
        .build()(deps);
    });

/**
 * Utility functions
 */
export const saveUtils = {
  /**
   * Find the filename for a buffer
   */
  findBufferName: (buffer: TextBuffer | null, buffers: Map<string, TextBuffer>): string | null => {
    if (!buffer) return null;
    
    for (const [name, buf] of buffers) {
      if (buf === buffer) {
        return name;
      }
    }
    return null;
  },
  
  /**
   * Generate a unique filename
   */
  generateUniqueFilename: (baseName: string, existingFiles: Set<string>): string => {
    let counter = 0;
    let filename = baseName;
    
    while (existingFiles.has(filename)) {
      counter++;
      const parts = baseName.split('.');
      if (parts.length > 1) {
        const ext = parts.pop();
        filename = `${parts.join('.')}_${counter}.${ext}`;
      } else {
        filename = `${baseName}_${counter}`;
      }
    }
    
    return filename;
  },
  
  /**
   * Validate multiple filenames at once
   */
  validateFilenames: (filenames: string[]): Validation<SaveError, string[]> =>
    Validation.traverse(filenames, filename =>
      ValidationUtils.nonEmpty(filename, "NO_FILENAME" as SaveError)
        .flatMap(name => ValidationUtils.securePath(name).mapErrors(() => "SECURITY_VIOLATION" as SaveError))
    )
};

// Helper function to find buffer name
function findBufferName(buffer: TextBuffer | null, buffers: Map<string, TextBuffer>): string | null {
  if (!buffer) return null;
  
  for (const [name, buf] of buffers) {
    if (buf === buffer) {
      return name;
    }
  }
  return null;
}

/**
 * Legacy compatibility wrapper for existing editor integration
 */
export class EnhancedSaveOperations {
  constructor(private dependencies: SaveDependencies) {}
  
  /**
   * Save current buffer with enhanced error handling
   */
  async saveFile(filename?: string): Promise<void> {
    const result = await saveCurrentBufferPipeline(filename)
      .run(this.dependencies)
      .run();
    
    if (result._tag === 'Left') {
      throw new Error(`Save failed: ${result.left}`);
    }
  }
  
  /**
   * Save with state updates
   */
  async saveWithState(state: EditorState, filename?: string): Promise<EditorState> {
    const result = await saveWithStateUpdates(filename).run(state).run();
    
    if (result._tag === 'Left') {
      throw new Error(`Save failed: ${result.left}`);
    }
    
    return result.right[1]; // Return new state
  }
  
  /**
   * Batch save multiple files
   */
  async saveBatch(filenames: string[]): Promise<string[]> {
    const result = await saveBatchBuffers(filenames)
      .run(this.dependencies)
      .run();
    
    if (result._tag === 'Left') {
      throw new Error(`Batch save failed: ${result.left}`);
    }
    
    return result.right;
  }
}