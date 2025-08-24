/**
 * @file task-either-usage.ts
 * @description Examples of using TaskEither for functional error handling in tmax
 */

import { TaskEither, TaskEitherUtils } from "../src/utils/task-either.ts";

// Example 1: File operations with TaskEither
const loadEditorConfig = (configPath: string) =>
  TaskEitherUtils.readFile(configPath)
    .flatMap(content => TaskEitherUtils.parseJSON<EditorConfig>(content))
    .flatMap(config => validateConfig(config))
    .mapLeft(error => `Config loading failed: ${error}`);

interface EditorConfig {
  theme: string;
  tabSize: number;
  autoSave: boolean;
  keyBindings: Record<string, string>;
}

const validateConfig = (config: EditorConfig): TaskEither<string, EditorConfig> => {
  if (config.tabSize < 1 || config.tabSize > 8) {
    return TaskEither.left("Invalid tab size: must be between 1 and 8");
  }
  if (!config.theme) {
    return TaskEither.left("Theme is required");
  }
  return TaskEither.right(config);
};

// Example 2: Buffer operations with error handling
const saveBufferSafely = (filePath: string, content: string) => {
  // Create backup, then save, with proper error handling
  const backupPath = `${filePath}.backup`;
  
  return TaskEitherUtils.readFile(filePath)
    .flatMap(currentContent => TaskEitherUtils.writeFile(backupPath, currentContent))
    .flatMap(() => TaskEitherUtils.writeFile(filePath, content))
    .mapLeft(error => `Save operation failed: ${error}`)
    .map(() => ({ saved: true, backupCreated: true }));
};

// Example 3: Multiple file operations in sequence
const processMultipleFiles = (filePaths: string[]) => {
  const fileProcessing = filePaths.map(path => 
    TaskEitherUtils.readFile(path)
      .map(content => ({ path, content, wordCount: content.split(/\s+/).length }))
      .mapLeft(error => `Failed to process ${path}: ${error}`)
  );
  
  return TaskEither.sequence(fileProcessing);
};

// Example 4: Retry mechanism for unreliable operations
const saveWithRetry = (filePath: string, content: string) => {
  const saveOperation = () => TaskEitherUtils.writeFile(filePath, content);
  
  return TaskEitherUtils.retry(saveOperation, 3, 1000)
    .mapLeft(error => `Save failed after 3 attempts: ${error}`);
};

// Example 5: Complex workflow with multiple operations
const initializeEditor = async (configPath: string) => {
  const workflow = loadEditorConfig(configPath)
    .flatMap(config => {
      // Initialize terminal with config settings
      return TaskEither.tryCatch(
        async () => {
          console.log(`Initializing editor with theme: ${config.theme}`);
          console.log(`Tab size: ${config.tabSize}`);
          return { config, initialized: true };
        },
        error => `Terminal initialization failed: ${error}`
      );
    })
    .flatMap(({ config }) => {
      // Load key bindings
      return TaskEither.right({
        config,
        keyBindings: Object.entries(config.keyBindings),
        ready: true
      });
    });
  
  const result = await workflow.run();
  
  if (result._tag === 'Right') {
    console.log("✅ Editor initialized successfully");
    return result.right;
  } else {
    console.error("❌ Editor initialization failed:", result.left);
    throw new Error(result.left);
  }
};

// Example 6: Combining parallel operations
const loadProjectFiles = (projectPath: string) => {
  const configFile = TaskEitherUtils.readFile(`${projectPath}/tmax.config.json`);
  const mainFile = TaskEitherUtils.readFile(`${projectPath}/main.ts`);
  const readmeFile = TaskEitherUtils.readFile(`${projectPath}/README.md`);
  
  return TaskEither.parallel([configFile, mainFile, readmeFile])
    .map(([config, main, readme]) => ({
      config: JSON.parse(config),
      main,
      readme,
      projectPath
    }))
    .mapLeft(error => `Failed to load project files: ${error}`);
};

// Example 7: Task composition with error accumulation
const validateProject = (projectPath: string) => {
  const checks = [
    TaskEitherUtils.readFile(`${projectPath}/package.json`).map(() => "package.json exists"),
    TaskEitherUtils.readFile(`${projectPath}/deno.json`).map(() => "deno.json exists"),
    TaskEitherUtils.readFile(`${projectPath}/src/main.ts`).map(() => "main.ts exists")
  ];
  
  return TaskEither.parallel(checks)
    .fold(
      errors => ({ valid: false, errors }),
      results => ({ valid: true, checks: results })
    );
};

// Usage examples
const runExamples = async () => {
  console.log("=== TaskEither Examples ===\n");
  
  // Example 1: Load config
  try {
    const config = await loadEditorConfig("./examples/sample.config.json").run();
    console.log("Config loaded:", config);
  } catch (error) {
    console.log("Config loading handled safely with TaskEither");
  }
  
  // Example 2: Process files with retry
  const files = ["./README.md", "./package.json"];
  const processed = await processMultipleFiles(files).run();
  console.log("Processed files:", processed);
  
  // Example 3: Validation
  const validation = await validateProject(".").run();
  console.log("Project validation:", validation);
};

// Uncomment to run examples
// if (import.meta.main) {
//   runExamples().catch(console.error);
// }

export {
  loadEditorConfig,
  saveBufferSafely,
  processMultipleFiles,
  saveWithRetry,
  initializeEditor,
  loadProjectFiles,
  validateProject
};