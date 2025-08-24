/**
 * @file task-either.test.ts
 * @description Tests for TaskEither utility
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Either, Task, TaskEither, TaskEitherUtils } from "../../src/utils/task-either.ts";

Deno.test("TaskEither", async (t) => {
  await t.step("Either - should create Left and Right values", () => {
    const left = Either.left<string, number>("error");
    const right = Either.right<number, string>(42);
    
    assertEquals(Either.isLeft(left), true);
    assertEquals(Either.isRight(left), false);
    if (Either.isLeft(left)) {
      assertEquals(left.left, "error");
    }
    
    assertEquals(Either.isRight(right), true);
    assertEquals(Either.isLeft(right), false);
    if (Either.isRight(right)) {
      assertEquals(right.right, 42);
    }
  });
  
  await t.step("Either - should map Right values", () => {
    const right = Either.right(10);
    const left = Either.left("error");
    
    const mappedRight = Either.map(right, x => x * 2);
    const mappedLeft = Either.map(left, x => x * 2);
    
    assertEquals(Either.isRight(mappedRight) && mappedRight.right, 20);
    assertEquals(Either.isLeft(mappedLeft) && mappedLeft.left, "error");
  });
  
  await t.step("Either - should flatMap Right values", () => {
    const right = Either.right(10);
    const left = Either.left("error");
    
    const flatMappedRight = Either.flatMap(right, x => Either.right(x * 2));
    const flatMappedLeft = Either.flatMap(left, x => Either.right(x * 2));
    
    assertEquals(Either.isRight(flatMappedRight) && flatMappedRight.right, 20);
    assertEquals(Either.isLeft(flatMappedLeft) && flatMappedLeft.left, "error");
  });
  
  await t.step("Either - should fold values", () => {
    const right = Either.right(10);
    const left = Either.left("error");
    
    const rightFolded = Either.fold(right, err => `Error: ${err}`, val => `Value: ${val}`);
    const leftFolded = Either.fold(left, err => `Error: ${err}`, val => `Value: ${val}`);
    
    assertEquals(rightFolded, "Value: 10");
    assertEquals(leftFolded, "Error: error");
  });
  
  await t.step("Either - should handle tryCatch", () => {
    const success = Either.tryCatch(() => JSON.parse('{"test": true}'));
    const failure = Either.tryCatch(() => JSON.parse('invalid json'));
    
    assertEquals(Either.isRight(success), true);
    assertEquals(Either.isLeft(failure), true);
    assertEquals(Either.isRight(success) && success.right.test, true);
  });
  
  await t.step("Task - should create and run tasks", async () => {
    const task = Task.of(42);
    const result = await task.run();
    
    assertEquals(result, 42);
  });
  
  await t.step("Task - should map over values", async () => {
    const task = Task.of(10).map(x => x * 2);
    const result = await task.run();
    
    assertEquals(result, 20);
  });
  
  await t.step("Task - should flatMap tasks", async () => {
    const task = Task.of(10).flatMap(x => Task.of(x * 2));
    const result = await task.run();
    
    assertEquals(result, 20);
  });
  
  await t.step("Task - should convert to TaskEither with tryCatch", async () => {
    const successTask = Task.fromSync(() => JSON.parse('{"test": true}'));
    const failureTask = Task.fromSync(() => JSON.parse('invalid json'));
    
    const successTaskEither = successTask.tryCatch();
    const failureTaskEither = failureTask.tryCatch();
    
    const successResult = await successTaskEither.run();
    const failureResult = await failureTaskEither.run();
    
    assertEquals(Either.isRight(successResult), true);
    assertEquals(Either.isLeft(failureResult), true);
  });
  
  await t.step("TaskEither - should create Right and Left values", async () => {
    const rightTE = TaskEither.right(42);
    const leftTE = TaskEither.left("error");
    
    const rightResult = await rightTE.run();
    const leftResult = await leftTE.run();
    
    assertEquals(Either.isRight(rightResult) && rightResult.right, 42);
    assertEquals(Either.isLeft(leftResult) && leftResult.left, "error");
  });
  
  await t.step("TaskEither - should handle tryCatch", async () => {
    const successTE = TaskEither.tryCatch(
      () => Promise.resolve(JSON.parse('{"test": true}'))
    );
    const failureTE = TaskEither.tryCatch(
      () => Promise.resolve(JSON.parse('invalid json'))
    );
    
    const successResult = await successTE.run();
    const failureResult = await failureTE.run();
    
    assertEquals(Either.isRight(successResult), true);
    assertEquals(Either.isLeft(failureResult), true);
  });
  
  await t.step("TaskEither - should map Right values", async () => {
    const te = TaskEither.right(10);
    const mapped = te.map(x => x * 2);
    const result = await mapped.run();
    
    assertEquals(Either.isRight(result) && result.right, 20);
  });
  
  await t.step("TaskEither - should mapLeft values", async () => {
    const te = TaskEither.left("error");
    const mapped = te.mapLeft(err => `Mapped: ${err}`);
    const result = await mapped.run();
    
    assertEquals(Either.isLeft(result) && result.left, "Mapped: error");
  });
  
  await t.step("TaskEither - should flatMap Right values", async () => {
    const te = TaskEither.right(10);
    const flatMapped = te.flatMap(x => TaskEither.right(x * 2));
    const result = await flatMapped.run();
    
    assertEquals(Either.isRight(result) && result.right, 20);
  });
  
  await t.step("TaskEither - should short-circuit on Left in flatMap", async () => {
    const te = TaskEither.left("error");
    const flatMapped = te.flatMap(x => TaskEither.right(x * 2));
    const result = await flatMapped.run();
    
    assertEquals(Either.isLeft(result) && result.left, "error");
  });
  
  await t.step("TaskEither - should chain operations with andThen", async () => {
    const te = TaskEither.right(10)
      .andThen(x => TaskEither.right(x * 2))
      .andThen(x => TaskEither.right(x + 5));
    
    const result = await te.run();
    assertEquals(Either.isRight(result) && result.right, 25);
  });
  
  await t.step("TaskEither - should fold values", async () => {
    const rightTE = TaskEither.right(10);
    const leftTE = TaskEither.left("error");
    
    const rightTask = rightTE.fold(err => `Error: ${err}`, val => `Value: ${val}`);
    const leftTask = leftTE.fold(err => `Error: ${err}`, val => `Value: ${val}`);
    
    const rightResult = await rightTask.run();
    const leftResult = await leftTask.run();
    
    assertEquals(rightResult, "Value: 10");
    assertEquals(leftResult, "Error: error");
  });
  
  await t.step("TaskEither - should getOrElse", async () => {
    const rightTE = TaskEither.right<number, string>(10);
    const leftTE = TaskEither.left<string, number>("error");
    
    const rightTask = rightTE.getOrElse(0);
    const leftTask = leftTE.getOrElse(0);
    
    const rightResult = await rightTask.run();
    const leftResult = await leftTask.run();
    
    assertEquals(rightResult, 10);
    assertEquals(leftResult, 0);
  });
  
  await t.step("TaskEither - should zip values", async () => {
    const te1 = TaskEither.right<number, string>(10);
    const te2 = TaskEither.right<string, string>("hello");
    const te3 = TaskEither.left<string, number>("error");
    
    const zipped = te1.zip(te2);
    const zippedWithError = te1.zip(te3);
    
    const zippedResult = await zipped.run();
    const zippedErrorResult = await zippedWithError.run();
    
    assertEquals(Either.isRight(zippedResult) && zippedResult.right[0], 10);
    assertEquals(Either.isRight(zippedResult) && zippedResult.right[1], "hello");
    assertEquals(Either.isLeft(zippedErrorResult) && zippedErrorResult.left, "error");
  });
  
  await t.step("TaskEither - should sequence tasks", async () => {
    const tasks = [
      TaskEither.right(1),
      TaskEither.right(2),
      TaskEither.right(3)
    ];
    
    const tasksWithError = [
      TaskEither.right(1),
      TaskEither.left("error"),
      TaskEither.right(3)
    ];
    
    const sequenced = TaskEither.sequence(tasks);
    const sequencedWithError = TaskEither.sequence(tasksWithError);
    
    const sequencedResult = await sequenced.run();
    const sequencedErrorResult = await sequencedWithError.run();
    
    assertEquals(Either.isRight(sequencedResult) && sequencedResult.right, [1, 2, 3]);
    assertEquals(Either.isLeft(sequencedErrorResult) && sequencedErrorResult.left, "error");
  });
  
  await t.step("TaskEither - should run tasks in parallel", async () => {
    const tasks = [
      TaskEither.right(1),
      TaskEither.right(2),
      TaskEither.right(3)
    ];
    
    const parallel = TaskEither.parallel(tasks);
    const result = await parallel.run();
    
    assertEquals(Either.isRight(result) && result.right, [1, 2, 3]);
  });
  
  await t.step("TaskEitherUtils - should parse JSON", async () => {
    const validJSON = TaskEitherUtils.parseJSON('{"test": true}');
    const invalidJSON = TaskEitherUtils.parseJSON('invalid json');
    
    const validResult = await validJSON.run();
    const invalidResult = await invalidJSON.run();
    
    assertEquals(Either.isRight(validResult), true);
    assertEquals(Either.isLeft(invalidResult), true);
  });
  
  await t.step("TaskEitherUtils - should stringify JSON", async () => {
    const obj = { test: true, number: 42 };
    const stringify = TaskEitherUtils.stringifyJSON(obj);
    const result = await stringify.run();
    
    assertEquals(Either.isRight(result), true);
    if (Either.isRight(result)) {
      const parsed = JSON.parse(result.right);
      assertEquals(parsed.test, true);
      assertEquals(parsed.number, 42);
    }
  });
  
  await t.step("TaskEitherUtils - should handle delay", async () => {
    const start = Date.now();
    const delay = TaskEitherUtils.delay(100);
    const result = await delay.run();
    const elapsed = Date.now() - start;
    
    assertEquals(Either.isRight(result), true);
    assertEquals(elapsed >= 100, true);
  });
  
  await t.step("TaskEitherUtils - should retry failed operations", async () => {
    let attempts = 0;
    const maxAttempts = 3;
    
    const flakyTask = () => TaskEither.fromSync(() => {
      attempts++;
      if (attempts < maxAttempts) {
        throw new Error(`Attempt ${attempts} failed`);
      }
      return "success";
    });
    
    const retried = TaskEitherUtils.retry(flakyTask, maxAttempts, 10);
    const result = await retried.run();
    
    assertEquals(Either.isRight(result), true);
    assertEquals(Either.isRight(result) && result.right, "success");
    assertEquals(attempts, maxAttempts);
  });
  
  await t.step("Complex workflow example", async () => {
    // Simulate a complex workflow: read config, parse JSON, validate, and process
    const configContent = '{"apiUrl": "https://api.example.com", "timeout": 5000}';
    
    type Config = {apiUrl: string, timeout: number};
    
    const workflow = TaskEither.right<string, string>(configContent)
      .flatMap(content => TaskEitherUtils.parseJSON<Config>(content))
      .flatMap((config: Config) => {
        if (!config.apiUrl || config.timeout <= 0) {
          return TaskEither.left<string, Config>("Invalid configuration");
        }
        return TaskEither.right<string, Config>(config);
      })
      .map(config => ({
        ...config,
        processedAt: new Date().toISOString()
      }));
    
    const result = await workflow.run();
    
    assertEquals(Either.isRight(result), true);
    if (Either.isRight(result)) {
      assertEquals(result.right.apiUrl, "https://api.example.com");
      assertEquals(result.right.timeout, 5000);
      assertEquals(typeof result.right.processedAt, "string");
    }
  });
});