/**
 * @file state.ts
 * @description State Monad pattern for immutable state management
 */

import { TaskEither } from "./task-either.ts";

/**
 * State monad represents a stateful computation that returns a value and a new state
 */
export class State<S, A> {
  constructor(private computation: (state: S) => [A, S]) {}
  
  /**
   * Create a State that returns a pure value without changing state
   */
  static of<S, A>(value: A): State<S, A> {
    return new State(state => [value, state]);
  }
  
  /**
   * Create a State that returns the current state as the value
   */
  static get<S>(): State<S, S> {
    return new State(state => [state, state]);
  }
  
  /**
   * Create a State that replaces the current state
   */
  static put<S>(newState: S): State<S, void> {
    return new State(() => [undefined, newState]);
  }
  
  /**
   * Create a State that modifies the current state
   */
  static modify<S>(f: (state: S) => S): State<S, void> {
    return new State(state => [undefined, f(state)]);
  }
  
  /**
   * Create a State that gets a specific part of the state
   */
  static gets<S, A>(f: (state: S) => A): State<S, A> {
    return new State(state => [f(state), state]);
  }
  
  /**
   * Run the state computation with an initial state
   */
  run(initialState: S): [A, S] {
    return this.computation(initialState);
  }
  
  /**
   * Run the state computation and return only the value
   */
  eval(initialState: S): A {
    return this.computation(initialState)[0];
  }
  
  /**
   * Run the state computation and return only the final state
   */
  exec(initialState: S): S {
    return this.computation(initialState)[1];
  }
  
  /**
   * Map over the value while preserving state management
   */
  map<B>(f: (value: A) => B): State<S, B> {
    return new State(state => {
      const [value, newState] = this.computation(state);
      return [f(value), newState];
    });
  }
  
  /**
   * FlatMap for chaining state computations
   */
  flatMap<B>(f: (value: A) => State<S, B>): State<S, B> {
    return new State(state => {
      const [value, newState] = this.computation(state);
      return f(value).run(newState);
    });
  }
  
  /**
   * Alias for flatMap
   */
  andThen<B>(f: (value: A) => State<S, B>): State<S, B> {
    return this.flatMap(f);
  }
  
  /**
   * Apply a function in a State to this State's value
   */
  apply<B>(stateF: State<S, (value: A) => B>): State<S, B> {
    return new State(state => {
      const [f, state1] = stateF.run(state);
      const [value, state2] = this.run(state1);
      return [f(value), state2];
    });
  }
  
  /**
   * Combine this State with another, returning a tuple
   */
  zip<B>(other: State<S, B>): State<S, [A, B]> {
    return new State(state => {
      const [valueA, state1] = this.computation(state);
      const [valueB, state2] = other.run(state1);
      return [[valueA, valueB], state2];
    });
  }
  
  /**
   * Run this state computation multiple times, collecting results
   */
  replicate(n: number): State<S, A[]> {
    const loop = (count: number): State<S, A[]> => {
      if (count <= 0) {
        return State.of([]);
      }
      return this.flatMap(value => 
        loop(count - 1).map(rest => [value, ...rest])
      );
    };
    return loop(n);
  }
  
  /**
   * Run a state computation only if a condition is met
   */
  when(condition: (state: S) => boolean): State<S, A | null> {
    return new State(state => {
      if (condition(state)) {
        return this.computation(state);
      }
      return [null, state];
    });
  }
  
  /**
   * Handle errors in state computation
   */
  tryCatch<E>(onError: (error: unknown) => E): State<S, A | E> {
    return new State(state => {
      try {
        return this.computation(state);
      } catch (error) {
        return [onError(error), state];
      }
    });
  }
}

/**
 * StateTaskEither combines State monad with TaskEither for async state operations
 */
export class StateTaskEither<S, L, A> {
  constructor(private computation: (state: S) => TaskEither<L, [A, S]>) {}
  
  /**
   * Create a StateTaskEither that returns a pure value
   */
  static of<S, L, A>(value: A): StateTaskEither<S, L, A> {
    return new StateTaskEither(state => TaskEither.right<[A, S], L>([value, state]));
  }
  
  /**
   * Create a StateTaskEither that fails with an error
   */
  static left<S, L, A>(error: L): StateTaskEither<S, L, A> {
    return new StateTaskEither(() => TaskEither.left<L, [A, S]>(error));
  }
  
  /**
   * Get the current state
   */
  static get<S, L>(): StateTaskEither<S, L, S> {
    return new StateTaskEither(state => TaskEither.right<[S, S], L>([state, state]));
  }
  
  /**
   * Set the state
   */
  static put<S, L>(newState: S): StateTaskEither<S, L, void> {
    return new StateTaskEither(() => TaskEither.right<[void, S], L>([undefined, newState]));
  }
  
  /**
   * Modify the state
   */
  static modify<S, L>(f: (state: S) => S): StateTaskEither<S, L, void> {
    return new StateTaskEither(state => TaskEither.right<[void, S], L>([undefined, f(state)]));
  }
  
  /**
   * Lift a TaskEither into StateTaskEither without changing state
   */
  static lift<S, L, A>(taskEither: TaskEither<L, A>): StateTaskEither<S, L, A> {
    return new StateTaskEither(state => 
      taskEither.map(value => [value, state] as [A, S])
    );
  }
  
  /**
   * Lift a State into StateTaskEither without error handling
   */
  static liftState<S, A>(state: State<S, A>): StateTaskEither<S, never, A> {
    return new StateTaskEither(s => TaskEither.right(state.run(s)));
  }
  
  /**
   * Run the StateTaskEither computation
   */
  run(initialState: S): TaskEither<L, [A, S]> {
    return this.computation(initialState);
  }
  
  /**
   * Run and return only the value
   */
  eval(initialState: S): TaskEither<L, A> {
    return this.computation(initialState).map(([value]) => value);
  }
  
  /**
   * Run and return only the final state
   */
  exec(initialState: S): TaskEither<L, S> {
    return this.computation(initialState).map(([, newState]) => newState);
  }
  
  /**
   * Map over the value
   */
  map<B>(f: (value: A) => B): StateTaskEither<S, L, B> {
    return new StateTaskEither(state => 
      this.computation(state).map(([value, newState]) => [f(value), newState])
    );
  }
  
  /**
   * Map over the error
   */
  mapLeft<L2>(f: (error: L) => L2): StateTaskEither<S, L2, A> {
    return new StateTaskEither(state => 
      this.computation(state).mapLeft(f)
    );
  }
  
  /**
   * FlatMap for chaining StateTaskEither computations
   */
  flatMap<B>(f: (value: A) => StateTaskEither<S, L, B>): StateTaskEither<S, L, B> {
    return new StateTaskEither(state => 
      this.computation(state).flatMap(([value, newState]) => 
        f(value).run(newState)
      )
    );
  }
  
  /**
   * Alias for flatMap
   */
  andThen<B>(f: (value: A) => StateTaskEither<S, L, B>): StateTaskEither<S, L, B> {
    return this.flatMap(f);
  }
  
  /**
   * Combine two StateTaskEither computations
   */
  zip<B>(other: StateTaskEither<S, L, B>): StateTaskEither<S, L, [A, B]> {
    return new StateTaskEither(state => 
      this.computation(state).flatMap(([valueA, state1]) => 
        other.run(state1).map(([valueB, state2]) => [[valueA, valueB], state2])
      )
    );
  }
  
  /**
   * Handle errors and recover
   */
  orElse(f: (error: L) => StateTaskEither<S, L, A>): StateTaskEither<S, L, A> {
    return new StateTaskEither(state => 
      TaskEither.from(async () => {
        const result = await this.computation(state).run();
        if (result._tag === 'Left') {
          return await f(result.left).run(state).run();
        }
        return result;
      })
    );
  }
  
  /**
   * Convert to regular TaskEither, providing initial state
   */
  toTaskEither(initialState: S): TaskEither<L, A> {
    return this.eval(initialState);
  }
  
  /**
   * Sequence multiple StateTaskEither operations
   */
  static sequence<S, L, A>(operations: StateTaskEither<S, L, A>[]): StateTaskEither<S, L, A[]> {
    return operations.reduce(
      (acc, operation) => acc.flatMap(arr => 
        operation.map(value => [...arr, value])
      ),
      StateTaskEither.of<S, L, A[]>([])
    );
  }
  
  /**
   * Traverse a list with a StateTaskEither operation
   */
  static traverse<S, L, A, B>(
    items: A[],
    f: (item: A) => StateTaskEither<S, L, B>
  ): StateTaskEither<S, L, B[]> {
    return StateTaskEither.sequence(items.map(f));
  }
}

/**
 * Utility functions for common state operations
 */
export const stateUtils = {
  /**
   * Atomically update a property in state
   */
  updateProperty: <S, K extends keyof S>(
    key: K,
    value: S[K]
  ): State<S, void> =>
    State.modify(state => ({ ...state as object, [key]: value } as S)),
  
  /**
   * Atomically update a property using a function
   */
  modifyProperty: <S, K extends keyof S>(
    key: K,
    f: (value: S[K]) => S[K]
  ): State<S, void> =>
    State.modify(state => ({ ...state as object, [key]: f(state[key]) } as S)),
  
  /**
   * Get a property from state
   */
  getProperty: <S, K extends keyof S>(key: K): State<S, S[K]> =>
    State.gets(state => state[key]),
  
  /**
   * Update multiple properties atomically
   */
  updateProperties: <S>(updates: Partial<S>): State<S, void> =>
    State.modify(state => ({ ...state as object, ...updates } as S)),
  
  /**
   * Conditionally update state
   */
  when: <S>(
    condition: (state: S) => boolean,
    update: State<S, void>
  ): State<S, void> =>
    State.get<S>().flatMap(state => 
      condition(state) ? update : State.of<S, void>(undefined)
    ),
  
  /**
   * Update state and return the old value
   */
  getAndSet: <S, A>(
    getter: (state: S) => A,
    setter: (state: S) => S
  ): State<S, A> =>
    State.get<S>().flatMap(state => 
      State.put(setter(state)).map(() => getter(state))
    ),
  
  /**
   * Swap two properties in state
   */
  swapProperties: <S, K1 extends keyof S, K2 extends keyof S>(
    key1: K1,
    key2: K2
  ): State<S, void> =>
    State.modify(state => ({
      ...state as object,
      [key1]: state[key2],
      [key2]: state[key1]
    } as S)),
  
  /**
   * Reset state to initial values
   */
  reset: <S>(initialState: S): State<S, void> =>
    State.put(initialState),
  
  /**
   * Push to an array property
   */
  pushToArray: <S, K extends keyof S, T>(
    key: K,
    item: T
  ): S[K] extends T[] ? State<S, void> : never =>
    State.modify(state => ({
      ...state as object,
      [key]: [...(state[key] as T[]), item]
    } as S)) as S[K] extends T[] ? State<S, void> : never,
  
  /**
   * Remove from array property by predicate
   */
  removeFromArray: <S, K extends keyof S, T>(
    key: K,
    predicate: (item: T) => boolean
  ): S[K] extends T[] ? State<S, void> : never =>
    State.modify(state => ({
      ...state as object,
      [key]: (state[key] as T[]).filter(item => !predicate(item))
    } as S)) as S[K] extends T[] ? State<S, void> : never,
  
  /**
   * Update Map property
   */
  updateMap: <S, K extends keyof S, MK, MV>(
    key: K,
    mapKey: MK,
    value: MV
  ): S[K] extends Map<MK, MV> ? State<S, void> : never =>
    State.modify(state => ({
      ...state as object,
      [key]: new Map(state[key] as Map<MK, MV>).set(mapKey, value)
    } as S)) as S[K] extends Map<MK, MV> ? State<S, void> : never,
  
  /**
   * Remove from Map property
   */
  removeFromMap: <S, K extends keyof S, MK, MV>(
    key: K,
    mapKey: MK
  ): S[K] extends Map<MK, MV> ? State<S, void> : never => {
    return State.modify(state => {
      const newMap = new Map(state[key] as Map<MK, MV>);
      newMap.delete(mapKey);
      return { ...state as object, [key]: newMap } as S;
    }) as S[K] extends Map<MK, MV> ? State<S, void> : never;
  }
};

/**
 * Higher-level state operations for complex scenarios
 */
export const stateCombiners = {
  /**
   * Run multiple state operations in sequence
   */
  sequence: <S, A>(states: State<S, A>[]): State<S, A[]> =>
    states.reduce(
      (acc, state) => acc.flatMap(arr => state.map(value => [...arr, value])),
      State.of<S, A[]>([])
    ),
  
  /**
   * Run state operations until a condition is met
   */
  whileDo: <S, A>(
    condition: (state: S) => boolean,
    operation: State<S, A>
  ): State<S, A[]> => {
    const loop = (): State<S, A[]> =>
      State.get<S>().flatMap(state => {
        if (condition(state)) {
          return operation.flatMap(value => 
            loop().map(rest => [value, ...rest])
          );
        } else {
          return State.of([]);
        }
      });
    return loop();
  },
  
  /**
   * Retry a state operation with a maximum number of attempts
   */
  retry: <S, A, E>(
    operation: StateTaskEither<S, E, A>,
    maxAttempts: number
  ): StateTaskEither<S, E | string, A> => {
    const attempt = (attemptsLeft: number): StateTaskEither<S, E | string, A> => {
      if (attemptsLeft <= 0) {
        return StateTaskEither.left("Maximum retry attempts exceeded");
      }
      
      return operation.orElse(() => attempt(attemptsLeft - 1));
    };
    
    return attempt(maxAttempts);
  },
  
  /**
   * Fold over a list with state accumulation
   */
  foldM: <S, A, B>(
    items: A[],
    initial: B,
    f: (acc: B, item: A) => State<S, B>
  ): State<S, B> =>
    items.reduce(
      (accState, item) => accState.flatMap(acc => f(acc, item)),
      State.of<S, B>(initial)
    ),
  
  /**
   * Map over a list with state
   */
  mapM: <S, A, B>(
    items: A[],
    f: (item: A) => State<S, B>
  ): State<S, B[]> =>
    stateCombiners.sequence(items.map(f)),
  
  /**
   * Filter a list with stateful predicate
   */
  filterM: <S, A>(
    items: A[],
    predicate: (item: A) => State<S, boolean>
  ): State<S, A[]> =>
    items.reduce(
      (accState, item) => accState.flatMap(acc => 
        predicate(item).map(keep => keep ? [...acc, item] : acc)
      ),
      State.of<S, A[]>([])
    )
};

// Example usage patterns for editor state (commented for documentation)
/*
// Editor state management example
interface EditorState {
  statusMessage: string;
  buffers: Map<string, TextBuffer>;
  currentBuffer: TextBuffer | null;
  mode: EditorMode;
  cursorLine: number;
  cursorColumn: number;
}

// Basic state operations
const updateStatusMessage = (message: string): State<EditorState, void> =>
  stateUtils.updateProperty('statusMessage', message);

const updateBufferAssociation = (filename: string, buffer: TextBuffer): State<EditorState, void> =>
  stateUtils.updateMap('buffers', filename, buffer);

const switchToInsertMode = (): State<EditorState, void> =>
  stateUtils.updateProperty('mode', 'insert');

// Complex state operations
const addNewBuffer = (name: string, content: string): State<EditorState, TextBuffer> =>
  State.get<EditorState>()
    .flatMap(state => {
      const buffer = new TextBuffer(content);
      return stateUtils.updateMap('buffers', name, buffer)
        .andThen(() => stateUtils.updateProperty('currentBuffer', buffer))
        .map(() => buffer);
    });

const saveCurrentBuffer = (filename: string): StateTaskEither<EditorState, string, void> =>
  StateTaskEither.get<EditorState, string>()
    .flatMap(state => {
      if (!state.currentBuffer) {
        return StateTaskEither.left("No buffer to save");
      }
      
      return StateTaskEither.lift(writeFileContent(filename, state.currentBuffer.getContent()))
        .flatMap(() => StateTaskEither.modify<EditorState, string>(state => ({
          ...state,
          statusMessage: `Saved ${filename}`,
          buffers: new Map(state.buffers).set(filename, state.currentBuffer!)
        })));
    });

// Batch state updates
const initializeEditor = (initialFile?: string): State<EditorState, void> =>
  stateCombiners.sequence([
    updateStatusMessage("Welcome to tmax"),
    stateUtils.updateProperty('mode', 'normal' as EditorMode),
    stateUtils.updateProperty('cursorLine', 0),
    stateUtils.updateProperty('cursorColumn', 0),
    initialFile ? addNewBuffer(initialFile, "") : State.of<EditorState, void>(undefined)
  ]).map(() => undefined);
*/