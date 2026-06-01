import type { TLispValue } from "./types.ts";

export interface TestDefinition {
  body: TLispValue[];
  name: string;
  params: TLispValue;
  isAsync?: boolean;
}

export interface TestRegistry {
  getTestDefinition(name: string): TestDefinition | undefined;
  getAllTestNames(): string[];
  clearRegistry(): void;
}

export class NoOpTestRegistry implements TestRegistry {
  getTestDefinition(): TestDefinition | undefined { return undefined; }
  getAllTestNames(): string[] { return []; }
  clearRegistry(): void {}
}
