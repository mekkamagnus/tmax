/**
 * @file functional-patterns.test.ts
 * @description Comprehensive tests for advanced functional programming patterns
 */

import { describe, test, it, expect } from "bun:test";

// Import all the functional patterns
import { pipe, kleisli, pipeUtils } from "../../src/utils/pipeline.ts";
import { Validation, ValidationUtils, lift2, lift3, validation } from "../../src/utils/validation.ts";
import { Lens, Optional, optics } from "../../src/utils/lens.ts";
import { State, StateTaskEither, stateUtils, stateCombiners } from "../../src/utils/state.ts";
import { Reader, ReaderTaskEither, readerUtils } from "../../src/utils/reader.ts";
import { Effect, EffectOps, effectPipe } from "../../src/utils/effect.ts";
import { TaskEither } from "../../src/utils/task-either.ts";

// Test data types
interface TestUser {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly age: number;
  readonly profile: {
    readonly bio: string;
    readonly tags: string[];
  };
}

interface TestState {
  readonly users: Map<number, TestUser>;
  readonly currentUserId: number | null;
  readonly statusMessage: string;
  readonly errorCount: number;
}

interface TestDependencies {
  readonly database: {
    getUser: (id: number) => Promise<TestUser | null>;
    saveUser: (user: TestUser) => Promise<void>;
    deleteUser: (id: number) => Promise<void>;
  };
  readonly logger: {
    info: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
  readonly config: {
    maxUsers: number;
    allowDelete: boolean;
  };
}

describe("Pipeline Pattern Tests", () => {
  test("should compose operations with pipeline builder", async () => {
    const result = await pipe
      .start(5)
      .map(x => x * 2)
      .step(x => TaskEither.right<number, never>(x + 3))
      .filter(x => x > 10, "TOO_SMALL" as const)
      .map(x => x.toString())
      .run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("13");
    }
  });

  test("should handle errors in pipeline", async () => {
    const result = await pipe
      .start("hello")
      .step(() => TaskEither.left<string, string>("ERROR"))
      .map(x => x.toUpperCase())
      .run();

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBe("ERROR");
    }
  });

  test("should support parallel operations", async () => {
    const pipeline1 = pipe.start(1).map(x => x * 2);
    const pipeline2 = pipe.start(3).map(x => x * 3);

    const result = await pipeline1
      .parallel(pipeline2, (a, b) => a + b)
      .run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe(11); // (1*2) + (3*3) = 2 + 9 = 11
    }
  });

  test("should support conditional execution", async () => {
    const result = await pipe
      .start(5)
      .when(x => x > 3, x => TaskEither.right<number, never>(x * 10))
      .run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe(50);
    }
  });

  test("should compose Kleisli arrows", async () => {
    const f = (x: number): TaskEither<string, string> => TaskEither.right(`num_${x}`);
    const g = (x: string): TaskEither<string, string> => TaskEither.right(`${x}_processed`);

    const composed = kleisli.compose(f, g);
    const result = await composed(42).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("num_42_processed");
    }
  });
});

describe("Validation Pattern Tests", () => {
  test("should accumulate validation errors", () => {
    const nameValidation = ValidationUtils.required(null, "Name is required");
    const emailValidation = ValidationUtils.required("", "Email is required")
      .flatMap(email => ValidationUtils.nonEmpty(email, "Email cannot be empty"));
    const ageValidation = ValidationUtils.numberInRange(-5, 0, 120, "Age must be 0-120");

    const result = lift3((name: string) => (email: string) => (age: number) => ({ name, email, age }))
      (nameValidation)(emailValidation)(ageValidation);

    expect(result.isFailure()).toBe(true);
    const errors = result.getErrors();
    expect(errors.length).toBe(3);
    expect(errors.includes("Name is required")).toBe(true);
    expect(errors.includes("Email cannot be empty")).toBe(true);
    expect(errors.includes("Age must be 0-120")).toBe(true);
  });

  test("should succeed with valid data", () => {
    const nameValidation = ValidationUtils.required("John", "Name is required");
    const emailValidation = ValidationUtils.email("john@example.com");
    const ageValidation = ValidationUtils.numberInRange(25, 0, 120, "Age must be 0-120");

    const result = lift3((name: string) => (email: string) => (age: number) => ({ name, email, age }))
      (nameValidation)(emailValidation)(ageValidation);

    expect(result.isSuccess()).toBe(true);
    expect(result.getValue().name).toBe("John");
    expect(result.getValue().email).toBe("john@example.com");
    expect(result.getValue().age).toBe(25);
  });

  test("should validate paths securely", () => {
    const maliciousPath = "../../../etc/passwd";
    const result = ValidationUtils.securePath(maliciousPath);

    expect(result.isFailure()).toBe(true);
    expect(result.getErrors().includes("Path contains directory traversal")).toBe(true);
  });

  test("should support validation builder pattern", () => {
    const passwordValidator = validation.builder<string, string>()
      .rule(password => ValidationUtils.nonEmpty(password, "Password is required"))
      .rule(password => ValidationUtils.lengthBetween(password, 8, 128, "Password must be 8-128 characters"))
      .rule(password => ValidationUtils.matches(password, /[A-Z]/, "Password must contain uppercase letter"))
      .rule(password => ValidationUtils.matches(password, /[a-z]/, "Password must contain lowercase letter"))
      .rule(password => ValidationUtils.matches(password, /\d/, "Password must contain a number"))
      .build();

    const weakPassword = passwordValidator("weak");
    expect(weakPassword.isFailure()).toBe(true);
    expect(weakPassword.getErrors().length >= 3).toBe(true);

    const strongPassword = passwordValidator("StrongPass123");
    expect(strongPassword.isSuccess()).toBe(true);
  });
});

describe("Lens/Optics Pattern Tests", () => {
  const testUser: TestUser = {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    age: 30,
    profile: {
      bio: "Software developer",
      tags: ["developer", "typescript"]
    }
  };

  it("should get and set properties with lenses", () => {
    const nameLens = Lens.of<TestUser, 'name'>('name');
    const ageLens = Lens.of<TestUser, 'age'>('age');

    expect(nameLens.get(testUser)).toBe("John Doe");
    expect(ageLens.get(testUser)).toBe(30);

    const updatedUser = nameLens.set("Jane Doe")(testUser);
    expect(updatedUser.name).toBe("Jane Doe");
    expect(updatedUser.id).toBe(1); // Other properties unchanged
  });

  it("should compose lenses for nested access", () => {
    const profileLens = Lens.of<TestUser, 'profile'>('profile');
    const bioLens = Lens.of<TestUser['profile'], 'bio'>('bio');
    const profileBioLens = profileLens.compose(bioLens);

    expect(profileBioLens.get(testUser)).toBe("Software developer");

    const updatedUser = profileBioLens.set("Senior developer")(testUser);
    expect(updatedUser.profile.bio).toBe("Senior developer");
    expect(updatedUser.profile.tags).toBe(testUser.profile.tags); // Sibling unchanged
  });

  it("should modify properties with functions", () => {
    const ageLens = Lens.of<TestUser, 'age'>('age');
    const olderUser = ageLens.modify(age => age + 1)(testUser);

    expect(olderUser.age).toBe(31);
    expect(olderUser.name).toBe(testUser.name); // Other properties unchanged
  });

  it("should work with arrays through traversals", () => {
    const profileLens = Lens.of<TestUser, 'profile'>('profile');
    const tagsLens = Lens.of<TestUser['profile'], 'tags'>('tags');
    const profileTagsLens = profileLens.compose(tagsLens);

    const updatedUser = profileTagsLens.modify(tags => [...tags, "functional"])(testUser);
    expect(updatedUser.profile.tags.length).toBe(3);
    expect(updatedUser.profile.tags.includes("functional")).toBe(true);
  });

  it("should batch multiple lens operations", () => {
    const nameLens = Lens.of<TestUser, 'name'>('name');
    const ageLens = Lens.of<TestUser, 'age'>('age');

    const updatedUser = optics.batch(
      nameLens.set("Jane Smith"),
      ageLens.set(32)
    )(testUser);

    expect(updatedUser.name).toBe("Jane Smith");
    expect(updatedUser.age).toBe(32);
  });
});

describe("State Pattern Tests", () => {
  const initialState: TestState = {
    users: new Map(),
    currentUserId: null,
    statusMessage: "",
    errorCount: 0
  };

  it("should manage state immutably", () => {
    const addUser = (user: TestUser): State<TestState, void> =>
      State.modify(state => ({
        ...state,
        users: new Map(state.users).set(user.id, user),
        currentUserId: user.id,
        statusMessage: `Added user: ${user.name}`
      }));

    const testUser: TestUser = {
      id: 1,
      name: "John",
      email: "john@example.com",
      age: 25,
      profile: { bio: "Developer", tags: ["js"] }
    };

    const [, newState] = addUser(testUser).run(initialState);

    expect(newState.users.size).toBe(1);
    expect(newState.users.get(1)?.name).toBe("John");
    expect(newState.currentUserId).toBe(1);
    expect(newState !== initialState).toBe(true); // Immutability check
  });

  it("should chain state operations", () => {
    const incrementError = State.modify<TestState>(state => ({
      ...state,
      errorCount: state.errorCount + 1
    }));

    const updateStatus = (message: string) => State.modify<TestState>(state => ({
      ...state,
      statusMessage: message
    }));

    const combined = incrementError
      .flatMap(() => updateStatus("Error occurred"))
      .flatMap(() => State.get<TestState>());

    const [finalState] = combined.run(initialState);

    expect(finalState.errorCount).toBe(1);
    expect(finalState.statusMessage).toBe("Error occurred");
  });

  it("should support state utilities", () => {
    const updateMessage = stateUtils.updateProperty<TestState, 'statusMessage'>('statusMessage', "Updated");
    const incrementErrors = stateUtils.modifyProperty<TestState, 'errorCount'>('errorCount', x => x + 5);

    const combined = updateMessage.flatMap(() => incrementErrors);
    const [, newState] = combined.run(initialState);

    expect(newState.statusMessage).toBe("Updated");
    expect(newState.errorCount).toBe(5);
  });

  it("should work with StateTaskEither for async operations", async () => {
    const asyncOperation = StateTaskEither.modify<TestState, never>(state => ({
      ...state,
      statusMessage: "Async operation completed"
    }));

    const result = await asyncOperation.run(initialState).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      const [, newState] = result.right;
      expect(newState.statusMessage).toBe("Async operation completed");
    }
  });
});

describe("Reader Pattern Tests", () => {
  const mockDependencies: TestDependencies = {
    database: {
      getUser: async (id: number) => 
        id === 1 ? { id: 1, name: "John", email: "john@example.com", age: 25, profile: { bio: "Dev", tags: [] } } : null,
      saveUser: async () => {},
      deleteUser: async () => {}
    },
    logger: {
      info: () => {},
      error: () => {}
    },
    config: {
      maxUsers: 100,
      allowDelete: true
    }
  };

  it("should inject dependencies with Reader", () => {
    const getMaxUsers = Reader.asks<TestDependencies, number>(deps => deps.config.maxUsers);
    const result = getMaxUsers.run(mockDependencies);

    expect(result).toBe(100);
  });

  it("should compose Reader operations", () => {
    const getConfig = Reader.asks<TestDependencies, TestDependencies['config']>(deps => deps.config);
    const getMaxUsers = getConfig.map(config => config.maxUsers);
    const doubleMax = getMaxUsers.map(max => max * 2);

    const result = doubleMax.run(mockDependencies);
    expect(result).toBe(200);
  });

  it("should work with ReaderTaskEither for async operations", async () => {
    const getUserReader = (id: number): ReaderTaskEither<TestDependencies, string, TestUser> =>
      ReaderTaskEither.asks<TestDependencies, string, TestDependencies['database']>(deps => deps.database)
        .flatMap(db => ReaderTaskEither.lift(
          TaskEither.tryCatch(
            () => db.getUser(id),
            () => "Database error"
          ).flatMap(user =>
            user ? TaskEither.right<TestUser, string>(user) : TaskEither.left<string, TestUser>("User not found")
          )
        ));

    const result = await getUserReader(1).run(mockDependencies).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.name).toBe("John");
    }
  });

  it("should transform dependencies with local", () => {
    interface SubDeps {
      readonly maxItems: number;
    }

    const useSubDeps = Reader.asks<SubDeps, number>(deps => deps.maxItems * 2);
    const transformedReader = useSubDeps.local<TestDependencies>(deps => ({
      maxItems: deps.config.maxUsers
    }));

    const result = transformedReader.run(mockDependencies);
    expect(result).toBe(200); // 100 * 2
  });
});

describe("Effect Pattern Tests", () => {
  const testDeps: TestDependencies = {
    database: {
      getUser: async (id: number) => 
        id === 1 ? { id: 1, name: "John", email: "john@example.com", age: 25, profile: { bio: "Dev", tags: [] } } : null,
      saveUser: async () => {},
      deleteUser: async () => {}
    },
    logger: {
      info: (message: string) => console.log(`INFO: ${message}`),
      error: (message: string, error?: unknown) => console.error(`ERROR: ${message}`, error)
    },
    config: {
      maxUsers: 100,
      allowDelete: true
    }
  };

  it("should create and run basic effects", async () => {
    const effect = Effect.succeed<TestDependencies, never, string>("Hello, World!");
    const result = await effect(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("Hello).toBe(World!");
    }
  });

  it("should handle errors in effects", async () => {
    const failingEffect = Effect.fail<TestDependencies, string, never>("Something went wrong");
    const result = await failingEffect(testDeps).run();

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBe("Something went wrong");
    }
  });

  it("should access dependencies", async () => {
    const getMaxUsers = EffectOps.map(Effect.access<TestDependencies, never>(), deps => deps.config.maxUsers);
    const result = await getMaxUsers(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe(100);
    }
  });

  it("should compose effects with flatMap", async () => {
    const effect1 = Effect.succeed<TestDependencies, never, number>(5);
    const effect2 = (x: number) => Effect.succeed<TestDependencies, never, string>(`Value: ${x}`);

    const composed = EffectOps.flatMap(effect1, effect2);
    const result = await composed(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("Value: 5");
    }
  });

  it("should support parallel execution", async () => {
    const effect1 = Effect.succeed<TestDependencies, never, number>(1);
    const effect2 = Effect.succeed<TestDependencies, never, number>(2);
    const effect3 = Effect.succeed<TestDependencies, never, number>(3);

    const parallel = EffectOps.parallel([effect1, effect2, effect3]);
    const result = await parallel(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe([1, 2, 3]);
    }
  });

  it("should support error recovery", async () => {
    const failingEffect = Effect.fail<TestDependencies, string, number>("Original error");
    const recovered = EffectOps.catchAll(
      failingEffect,
      () => Effect.succeed<TestDependencies, string, number>(42)
    );

    const result = await recovered(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe(42);
    }
  });

  it("should work with effect pipelines", async () => {
    const result = await effectPipe
      .succeed<TestDependencies, never, number>(10)
      .map(x => x * 2)
      .flatMap(x => Effect.succeed<TestDependencies, never, string>(`Result: ${x}`))
      .provide(testDeps)
      .run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("Result: 20");
    }
  });

  it("should support retry with exponential backoff", async () => {
    let attemptCount = 0;
    const flakyEffect = Effect.tryCatch<TestDependencies, string, string>(
      () => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error("Transient error"));
        }
        return Promise.resolve("Success!");
      },
      error => `Error: ${error}`
    );

    const retriedEffect = EffectOps.retry(flakyEffect, 5, 10); // 5 attempts, 10ms base delay
    const result = await retriedEffect(testDeps).run();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right).toBe("Success!");
    }
    expect(attemptCount).toBe(3);
  });
});

describe("Integration Tests", () => {
  it("should combine validation and lens patterns", () => {
    interface UserState {
      readonly user: TestUser | null;
      readonly status: string;
      readonly errors: string[];
    }

    const initialState: UserState = {
      user: null,
      status: "",
      errors: []
    };

    // Validate user data
    const userData = { name: "John", email: "john@example.com", age: 25 };
    const nameValidation = ValidationUtils.required(userData.name, "Name required");
    const emailValidation = ValidationUtils.email(userData.email);
    const ageValidation = ValidationUtils.numberInRange(userData.age, 18, 100, "Age must be 18-100");

    const userValidation = lift3((name: string) => (email: string) => (age: number): TestUser => ({
      id: 1, name, email, age, profile: { bio: "", tags: [] }
    }))(nameValidation)(emailValidation)(ageValidation);

    if (userValidation.isSuccess()) {
      // Use lenses to update state
      const userLens = Lens.of<UserState, 'user'>('user');
      const statusLens = Lens.of<UserState, 'status'>('status');

      const updatedState = optics.batch(
        userLens.set(userValidation.getValue()),
        statusLens.set("User created successfully")
      )(initialState);

      expect(updatedState.user?.name).toBe("John");
      expect(updatedState.status).toBe("User created successfully");
    }
  });

  it("should handle validation errors with lens updates", () => {
    interface ErrorState {
      readonly errors: string[];
      readonly hasErrors: boolean;
    }

    const initialState: ErrorState = {
      errors: [],
      hasErrors: false
    };

    // Invalid user data that will fail validation
    const validation = lift2((name: string) => (email: string) => ({ name, email }))
      (ValidationUtils.required(null, "Name is required"))
      (ValidationUtils.email("invalid-email"));

    if (validation.isFailure()) {
      const errorsLens = Lens.of<ErrorState, 'errors'>('errors');
      const hasErrorsLens = Lens.of<ErrorState, 'hasErrors'>('hasErrors');

      const updatedState = optics.batch(
        errorsLens.set(validation.getErrors()),
        hasErrorsLens.set(true)
      )(initialState);

      expect(updatedState.errors.length).toBe(2);
      expect(updatedState.hasErrors).toBe(true);
      expect(updatedState.errors.includes("Name is required"));
    }
  });
});