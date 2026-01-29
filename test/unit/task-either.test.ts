/**
 * @file task-either.test.ts
 * @description Tests for TaskEither utility
 */

import { describe, test, expect } from 'bun:test';
import { Either, Task, TaskEither, TaskEitherUtils } from "../../src/utils/task-either.ts";

describe("TaskEither", () => {
  test("Either - should create Left and Right values", () => {
    const left = Either.left<string, number>("error");
    const right = Either.right<number, string>(42);
    
    expect(Either.isLeft(left)).toBe(true);
    expect(Either.isRight(left)).toBe(false);
    if (Either.isLeft(left)) {
      expect(left.left).toBe("error");
    }

    expect(Either.isRight(right)).toBe(true);
    expect(Either.isLeft(right)).toBe(false);
    if (Either.isRight(right)) {
      expect(right.right).toBe(42);
    }
  });
  
  test("Either - should map Right values", () => {
    const right = Either.right(10);
    const left = Either.left("error");
    
    const mappedRight = Either.map(right, x => x * 2);
    const mappedLeft = Either.map(left, x => x * 2);

    expect(Either.isRight(mappedRight) && mappedRight.right).toBe(20);
    expect(Either.isLeft(mappedLeft) && mappedLeft.left).toBe("error");
  });

  test("Either - should flatMap Right values", () => {
    const right = Either.right(10);
    const left = Either.left("error");

    const flatMappedRight = Either.flatMap(right, x => Either.right(x * 2));
    const flatMappedLeft = Either.flatMap(left, x => Either.right(x * 2));

    expect(Either.isRight(flatMappedRight) && flatMappedRight.right).toBe(20);
    expect(Either.isLeft(flatMappedLeft) && flatMappedLeft.left).toBe("error");
  });

  test("Either - should fold values", () => {
    const right = Either.right(10);
    const left = Either.left("error");

    const rightFolded = Either.fold(right, err => `Error: ${err}`, val => `Value: ${val}`);
    const leftFolded = Either.fold(left, err => `Error: ${err}`, val => `Value: ${val}`);

    expect(rightFolded).toBe("Value: 10");
    expect(leftFolded).toBe("Error: error");
  });

  test("Either - should handle tryCatch", () => {
    const success = Either.tryCatch(() => JSON.parse('{"test": true}'));
    const failure = Either.tryCatch(() => JSON.parse('invalid json'));

    expect(Either.isRight(success)).toBe(true);
    expect(Either.isLeft(failure)).toBe(true);
    expect(Either.isRight(success) && success.right.test).toBe(true);
  });

  test("Task - should create and run tasks", async () => {
    const task = Task.of(42);
    const result = await task.run();

    expect(result).toBe(42);
  });

  test("Task - should map over values", async () => {
    const task = Task.of(10).map(x => x * 2);
    const result = await task.run();

    expect(result).toBe(20);
  });

  test("Task - should flatMap tasks", async () => {
    const task = Task.of(10).flatMap(x => Task.of(x * 2));
    const result = await task.run();

    expect(result).toBe(20);
  });

  test("Task - should convert to TaskEither with tryCatch", async () => {
    const successTask = Task.fromSync(() => JSON.parse('{"test": true}'));
    const failureTask = Task.fromSync(() => JSON.parse('invalid json'));

    const successTaskEither = successTask.tryCatch();
    const failureTaskEither = failureTask.tryCatch();

    const successResult = await successTaskEither.run();
    const failureResult = await failureTaskEither.run();

    expect(Either.isRight(successResult)).toBe(true);
    expect(Either.isLeft(failureResult)).toBe(true);
  });

  test("TaskEither - should create Right and Left values", async () => {
    const rightTE = TaskEither.right(42);
    const leftTE = TaskEither.left("error");

    const rightResult = await rightTE.run();
    const leftResult = await leftTE.run();

    expect(Either.isRight(rightResult) && rightResult.right).toBe(42);
    expect(Either.isLeft(leftResult) && leftResult.left).toBe("error");
  });

  test("TaskEither - should handle tryCatch", async () => {
    const successTE = TaskEither.tryCatch(
      () => Promise.resolve(JSON.parse('{"test": true}'))
    );
    const failureTE = TaskEither.tryCatch(
      () => Promise.resolve(JSON.parse('invalid json'))
    );

    const successResult = await successTE.run();
    const failureResult = await failureTE.run();

    expect(Either.isRight(successResult)).toBe(true);
    expect(Either.isLeft(failureResult)).toBe(true);
  });

  test("TaskEither - should map Right values", async () => {
    const te = TaskEither.right(10);
    const mapped = te.map(x => x * 2);
    const result = await mapped.run();

    expect(Either.isRight(result) && result.right).toBe(20);
  });

  test("TaskEither - should mapLeft values", async () => {
    const te = TaskEither.left("error");
    const mapped = te.mapLeft(err => `Mapped: ${err}`);
    const result = await mapped.run();

    expect(Either.isLeft(result) && result.left).toBe("Mapped: error");
  });

  test("TaskEither - should flatMap Right values", async () => {
    const te = TaskEither.right(10);
    const flatMapped = te.flatMap(x => TaskEither.right(x * 2));
    const result = await flatMapped.run();

    expect(Either.isRight(result) && result.right).toBe(20);
  });

  test("TaskEither - should short-circuit on Left in flatMap", async () => {
    const te = TaskEither.left("error");
    const flatMapped = te.flatMap(x => TaskEither.right(x * 2));
    const result = await flatMapped.run();

    expect(Either.isLeft(result) && result.left).toBe("error");
  });

  test("TaskEither - should chain operations with andThen", async () => {
    const te = TaskEither.right(10)
      .andThen(x => TaskEither.right(x * 2))
      .andThen(x => TaskEither.right(x + 5));

    const result = await te.run();
    expect(Either.isRight(result) && result.right).toBe(25);
  });

  test("TaskEither - should fold values", async () => {
    const rightTE = TaskEither.right(10);
    const leftTE = TaskEither.left("error");

    const rightTask = rightTE.fold(err => `Error: ${err}`, val => `Value: ${val}`);
    const leftTask = leftTE.fold(err => `Error: ${err}`, val => `Value: ${val}`);

    const rightResult = await rightTask.run();
    const leftResult = await leftTask.run();

    expect(rightResult).toBe("Value: 10");
    expect(leftResult).toBe("Error: error");
  });

  test("TaskEither - should getOrElse", async () => {
    const rightTE = TaskEither.right<number, string>(10);
    const leftTE = TaskEither.left<string, number>("error");

    const rightTask = rightTE.getOrElse(0);
    const leftTask = leftTE.getOrElse(0);

    const rightResult = await rightTask.run();
    const leftResult = await leftTask.run();

    expect(rightResult).toBe(10);
    expect(leftResult).toBe(0);
  });

  test("TaskEither - should zip values", async () => {
    const te1 = TaskEither.right<number, string>(10);
    const te2 = TaskEither.right<string, string>("hello");
    const te3 = TaskEither.left<string, number>("error");

    const zipped = te1.zip(te2);
    const zippedWithError = te1.zip(te3);

    const zippedResult = await zipped.run();
    const zippedErrorResult = await zippedWithError.run();

    expect(Either.isRight(zippedResult) && zippedResult.right[0]).toBe(10);
    expect(Either.isRight(zippedResult) && zippedResult.right[1]).toBe("hello");
    expect(Either.isLeft(zippedErrorResult) && zippedErrorResult.left).toBe("error");
  });

  test("TaskEither - should sequence tasks", async () => {
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

    expect(Either.isRight(sequencedResult) && sequencedResult.right).toEqual([1, 2, 3]);
    expect(Either.isLeft(sequencedErrorResult) && sequencedErrorResult.left).toBe("error");
  });

  test("TaskEither - should run tasks in parallel", async () => {
    const tasks = [
      TaskEither.right(1),
      TaskEither.right(2),
      TaskEither.right(3)
    ];

    const parallel = TaskEither.parallel(tasks);
    const result = await parallel.run();

    expect(Either.isRight(result) && result.right).toEqual([1, 2, 3]);
  });

  test("TaskEitherUtils - should parse JSON", async () => {
    const validJSON = TaskEitherUtils.parseJSON('{"test": true}');
    const invalidJSON = TaskEitherUtils.parseJSON('invalid json');

    const validResult = await validJSON.run();
    const invalidResult = await invalidJSON.run();

    expect(Either.isRight(validResult)).toBe(true);
    expect(Either.isLeft(invalidResult)).toBe(true);
  });

  test("TaskEitherUtils - should stringify JSON", async () => {
    const obj = { test: true, number: 42 };
    const stringify = TaskEitherUtils.stringifyJSON(obj);
    const result = await stringify.run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const parsed = JSON.parse(result.right);
      expect(parsed.test).toBe(true);
      expect(parsed.number).toBe(42);
    }
  });

  test("TaskEitherUtils - should handle delay", async () => {
    const start = Date.now();
    const delay = TaskEitherUtils.delay(100);
    const result = await delay.run();
    const elapsed = Date.now() - start;

    expect(Either.isRight(result)).toBe(true);
    expect(elapsed >= 100).toBe(true);
  });

  test("TaskEitherUtils - should retry failed operations", async () => {
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

    expect(Either.isRight(result)).toBe(true);
    expect(Either.isRight(result) && result.right).toBe("success");
    expect(attempts).toBe(maxAttempts);
  });

  test("Complex workflow example", async () => {
    // Simulate a complex workflow: read config, parse JSON, validate, and process
    const configContent = '{"apiUrl": "https://api.example.com", "timeout": 5000}';

    type Config = {apiUrl: string, timeout: number};

    const workflow = TaskEither.right<string, string>(configContent)
      .flatMap(content => TaskEitherUtils.parseJSON<Config>(content))
      .flatMap((config: Config) => {
        if (!config.apiUrl || config.timeout <= 0) {
          return TaskEither.left("Invalid configuration");
        }
        return TaskEither.right(config);
      })
      .map(config => ({
        ...config,
        processedAt: new Date().toISOString()
      }));

    const result = await workflow.run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.apiUrl).toBe("https://api.example.com");
      expect(result.right.timeout).toBe(5000);
      expect(typeof result.right.processedAt).toBe("string");
    }
  });
});