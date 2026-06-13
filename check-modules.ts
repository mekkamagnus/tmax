import { TLispParser } from "./src/tlisp/parser.ts";
import { readFileSync } from "fs";

for (const f of [
  "src/tlisp/core/commands/motions.tlisp",
  "src/tlisp/core/commands/operators.tlisp",
  "src/tlisp/core/commands/vim-dispatch.tlisp",
  "src/tlisp/core/bindings/normal.tlisp",
]) {
  try {
    const src = readFileSync(f, "utf-8");
    const parser = new TLispParser();
    const result = parser.parseProgram(src, f);
    if (result._tag === "Left") {
      console.log(f, "PARSE ERROR:", JSON.stringify(result.left));
    } else {
      console.log(f, "=> OK,", result.right.length, "forms");
    }
  } catch (e: any) {
    console.log(f, "EXCEPTION:", e.message);
  }
}
