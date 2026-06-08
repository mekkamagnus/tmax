/**
 * @file clojure.ts
 * @description Clojure syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/types.ts";

export const extensions = [".clj", ".cljs", ".cljc"];

export const rules: SyntaxRule[] = [
  // Comments
  { pattern: /;.*$/g, type: "comment", priority: 100 },
  // Strings
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  // Regex literals #"..."
  { pattern: /#"(?:[^"\\]|\\.)*"/g, type: "regexp", priority: 88 },
  // Anonymous function shorthand #(...)
  { pattern: /#\(/g, type: "function", priority: 85 },
  // Namespaced maps #:
  { pattern: /#:[:\w]+/g, type: "special", priority: 84 },
  // Special forms
  { pattern: /\b(?:defn|defn-|def|defmacro|defmethod|defmulti|defprotocol|defrecord|defstruct|deftype|let|letfn|if|cond|condp|case|when|when-not|when-first|when-let|when-some|do|loop|recur|fn|throw|try|catch|finally|binding|with-open|with-local-vars|ns|require|import|quote|var|set!|atom|ref|agent|future|promise|deliver|dosync|doseq|dotimes|while|declare|proxy|reify|extend-type|extend-protocol|assert|locking|with-meta|comp|partial|memoize)\b/g, type: "keyword", priority: 70 },
  // Built-in functions
  { pattern: /\b(?:map|mapv|mapcat|filter|filterv|remove|reduce|reduce-kv|into|conj|disj|assoc|dissoc|get|contains\?|count|seq|cons|first|rest|nth|take|drop|partition|group-by|sort|sort-by|apply|comp|complement|constantly|identity|juxt|memoize|every\?|some|not-every\?|not-any\?|interleave|interpose|flatten|distinct|dedupe|cat|range|repeat|iterate|butlast|drop-last|keep|keep-indexed|map-indexed|select-keys|keys|vals|merge|merge-with|zipmap|update|update-in|get-in|assoc-in|dissoc-in|inc|dec|max|min|abs|pos\?|neg\?|zero\?|even\?|odd\?|int|double|float|str|keyword|symbol|name|type|meta|with-meta|vary-meta|deref|swap!|reset!|compare-and-set!|alter|commute|ref-set|ensure|test|assert|instance\?|class|type|println|prn|format|subs|split|replace)\b/g, type: "builtin", priority: 60 },
  // Boolean / nil
  { pattern: /\b(?:true|false|nil)\b/g, type: "boolean", priority: 65 },
  // Numbers
  { pattern: /\b-?\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, type: "number", priority: 55 },
  // Keywords :something
  { pattern: /:[\w-]+/g, type: "constant", priority: 50 },
  // Parentheses
  { pattern: /[()\[\]{}]/g, type: "punctuation", priority: 40 },
];
