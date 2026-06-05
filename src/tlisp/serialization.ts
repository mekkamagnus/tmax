/**
 * @file serialization.ts
 * @description JSON-safe serialization for opaque T-Lisp values.
 */

import type { JsonValue } from "../core/types.ts";
import type { TLispValue } from "./types.ts";
import {
  createBoolean,
  createHashmap,
  createList,
  createNil,
  createNumber,
  createString,
  createSymbol,
} from "./values.ts";

type SerializedTLispValue = {
  type: "nil" | "boolean" | "number" | "string" | "symbol" | "list" | "hashmap";
  value: JsonValue;
};

/**
 * Convert a data-only T-Lisp value to a JSON-safe representation.
 */
export const serializeTlispValue = (value: TLispValue): JsonValue => {
  switch (value.type) {
    case "nil":
      return { type: "nil", value: null };
    case "boolean":
    case "number":
    case "string":
    case "symbol":
      return { type: value.type, value: value.value as boolean | number | string };
    case "list":
      return {
        type: "list",
        value: (value.value as TLispValue[]).map(serializeTlispValue),
      };
    case "hashmap":
      return {
        type: "hashmap",
        value: Object.fromEntries(
          Array.from((value.value as Map<string, TLispValue>).entries())
            .map(([key, entry]) => [key, serializeTlispValue(entry)]),
        ),
      };
    case "function":
    case "macro":
      throw new Error(`Cannot serialize T-Lisp ${value.type} value`);
  }
};

/**
 * Convert a JSON-safe serialized T-Lisp value back to a T-Lisp value.
 */
export const deserializeTlispValue = (serialized: JsonValue | undefined): TLispValue => {
  if (!serialized || Array.isArray(serialized) || typeof serialized !== "object") {
    return createNil();
  }

  const record = serialized as unknown as SerializedTLispValue;
  switch (record.type) {
    case "nil":
      return createNil();
    case "boolean":
      return createBoolean(record.value === true);
    case "number":
      return createNumber(typeof record.value === "number" ? record.value : 0);
    case "string":
      return createString(typeof record.value === "string" ? record.value : "");
    case "symbol":
      return createSymbol(typeof record.value === "string" ? record.value : "");
    case "list":
      return createList(
        Array.isArray(record.value)
          ? record.value.map(value => deserializeTlispValue(value))
          : [],
      );
    case "hashmap": {
      const value = record.value;
      if (!value || Array.isArray(value) || typeof value !== "object") {
        return createHashmap();
      }
      return createHashmap(
        Object.entries(value).map(([key, entry]) => [
          key,
          deserializeTlispValue(entry),
        ]),
      );
    }
    default:
      return createNil();
  }
};

/**
 * Deep-copy a JSON-safe value.
 */
export const cloneJsonValue = <T extends JsonValue | undefined>(value: T): T =>
  value === undefined ? value : structuredClone(value);
