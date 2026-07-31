/**
 * @file serialization.ts
 * @description JSON-safe serialization for opaque T-Lisp values.
 */

import type { JsonValue } from "../core/contracts/editor.ts";
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
  type: "nil" | "boolean" | "number" | "string" | "symbol" | "list" | "hashmap" | "promise";
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
    case "promise":
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

/** Convert a T-Lisp value to a JSON-serializable value (issue #20).
 *  Extracted from TmaxServer.tlispValueToJson — pure, no instance state.
 *  Note: asTlisp (server.ts) is the INVERSE (JSON→T-Lisp) — intentionally separate. */
export function tlispValueToJson(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  if (value.type !== undefined) {
    switch (value.type) {
      case 'nil':
        return null;
      case 'boolean':
      case 'number':
      case 'string':
        return value.value;
      case 'list':
        return value.value.map((v: any) => tlispValueToJson(v));
      case 'hashmap':
        const obj: Record<string, any> = {};
        value.value.forEach((v: any, k: string) => {
          obj[k] = tlispValueToJson(v);
        });
        return obj;
      case 'symbol':
        return value.value;
      default:
        return String(value);
    }
  }
  return value;
}
