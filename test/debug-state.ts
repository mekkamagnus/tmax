import { resetFixtureState, getGlobalSetupFunction, getGlobalTeardownFunction } from "../src/tlisp/test-framework.ts";

console.log("Setup:", getGlobalSetupFunction());
console.log("Teardown:", getGlobalTeardownFunction());
console.log("Fixture data:", (globalThis as any).__deffixture_data__?.size);
