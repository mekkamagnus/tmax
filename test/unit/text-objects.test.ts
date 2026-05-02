/**
 * @file text-objects.test.ts
 * @description Tests for basic text objects functionality (US-1.8.1)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";
import { Either } from "../../src/utils/task-either.ts";
import {
  deleteInnerWord,
  deleteAroundWord,
  changeInnerSingleQuote,
  changeAroundSingleQuote,
  changeInnerDoubleQuote,
  changeAroundDoubleQuote,
  deleteInnerParen,
  changeInnerParen,
  deleteInnerBrace,
  changeInnerBrace,
  deleteInnerBracket,
  deleteInnerAngle,
  deleteInnerTag,
  getDeleteRegister,
  setDeleteRegister
} from "../../src/editor/api/text-objects.ts";

function createBuffer(content: string): FunctionalTextBuffer {
  return FunctionalTextBufferImpl.create(content);
}

function getBufferContent(buffer: FunctionalTextBuffer): string {
  const result = buffer.getContent();
  if (Either.isLeft(result)) {
    throw new Error(`Failed to get buffer content: ${result.left}`);
  }
  return result.right;
}

describe("Text Objects - US-1.8.1", () => {
  beforeEach(() => {
    // Reset register before each test
    setDeleteRegister("");
  });

  describe("delete-inner-word (diw)", () => {
    test("should delete word under cursor", () => {
      const buffer = createBuffer("The quick brown fox jumps");
      const result = deleteInnerWord(buffer, 0, 4);

      expect(Either.isRight(result)).toBe(true);
      expect(getBufferContent(result.right)).toBe("The  brown fox jumps");
    });

    test("should delete word leaving trailing space", () => {
      const buffer = createBuffer("word1 word2 word3");
      const result = deleteInnerWord(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe(" word2 word3");
    });

    test("should handle single word", () => {
      const buffer = createBuffer("word");
      const result = deleteInnerWord(buffer, 0, 2);

      expect(getBufferContent(result.right)).toBe("");
    });

    test("should handle punctuation", () => {
      const buffer = createBuffer("hello, world");
      const result = deleteInnerWord(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe(", world");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("word1 word2");
      deleteInnerWord(buffer, 0, 3);

      expect(getDeleteRegister()).toBe("word1");
    });
  });

  describe("delete-around-word (daw)", () => {
    test("should delete word with trailing space", () => {
      const buffer = createBuffer("word1 word2 word3");
      const result = deleteAroundWord(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("word2 word3");
    });

    test("should delete word at end of line without trailing space", () => {
      const buffer = createBuffer("word1 word2");
      const result = deleteAroundWord(buffer, 0, 8);

      expect(getBufferContent(result.right)).toBe("word1 ");
    });

    test("should handle punctuation with space", () => {
      const buffer = createBuffer("hello, world");
      const result = deleteAroundWord(buffer, 0, 3);

      // Word stops at punctuation, so only "hello" is deleted (comma is not part of word)
      expect(getBufferContent(result.right)).toBe(", world");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("word1 word2");
      deleteAroundWord(buffer, 0, 3);

      expect(getDeleteRegister()).toBe("word1 ");
    });
  });

  describe("change-inner-single-quote (ci')", () => {
    test("should delete inside single quotes", () => {
      const buffer = createBuffer("say 'hello' world");
      const result = changeInnerSingleQuote(buffer, 0, 6);

      expect(Either.isRight(result)).toBe(true);
      expect(getBufferContent(result.right)).toBe("say '' world");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("say 'hello' world");
      changeInnerSingleQuote(buffer, 0, 6);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("change-around-single-quote (ca')", () => {
    test("should delete including single quotes", () => {
      const buffer = createBuffer("say 'hello' world");
      const result = changeAroundSingleQuote(buffer, 0, 6);

      expect(getBufferContent(result.right)).toBe("say  world");
    });

    test("should store deleted text including quotes in register", () => {
      const buffer = createBuffer("say 'hello' world");
      changeAroundSingleQuote(buffer, 0, 6);

      expect(getDeleteRegister()).toBe("'hello'");
    });
  });

  describe("change-inner-double-quote (ci\")", () => {
    test("should delete inside double quotes", () => {
      const buffer = createBuffer('say "hello" world');
      const result = changeInnerDoubleQuote(buffer, 0, 6);

      expect(getBufferContent(result.right)).toBe('say "" world');
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer('say "hello" world');
      changeInnerDoubleQuote(buffer, 0, 6);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("delete-inner-paren (di))", () => {
    test("should delete inside parentheses", () => {
      const buffer = createBuffer("(hello world)");
      const result = deleteInnerParen(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("()");
    });

    test("should handle nested parentheses", () => {
      const buffer = createBuffer("((nested))");
      const result = deleteInnerParen(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("(())");
    });

    test("should handle parentheses in middle of text", () => {
      const buffer = createBuffer("function(arg1, arg2) call");
      const result = deleteInnerParen(buffer, 0, 10);

      expect(getBufferContent(result.right)).toBe("function() call");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("(hello)");
      deleteInnerParen(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("change-inner-paren (ci))", () => {
    test("should delete inside parens", () => {
      const buffer = createBuffer("(hello)");
      const result = changeInnerParen(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("()");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("(hello)");
      changeInnerParen(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("change-inner-brace (ci{)", () => {
    test("should delete inside braces", () => {
      const buffer = createBuffer("{key: value}");
      const result = changeInnerBrace(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("{}");
    });

    test("should handle nested braces", () => {
      const buffer = createBuffer("{{nested}}");
      const result = changeInnerBrace(buffer, 0, 3);

      // Deletes content inside outermost pair of braces
      expect(getBufferContent(result.right)).toBe("{{}}");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("{hello}");
      changeInnerBrace(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("delete-inner-brace (di{)", () => {
    test("should delete inside braces without mode change", () => {
      const buffer = createBuffer("{hello}");
      const result = deleteInnerBrace(buffer, 0, 2);

      expect(getBufferContent(result.right)).toBe("{}");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("{hello}");
      deleteInnerBrace(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("delete-inner-bracket (di])", () => {
    test("should delete inside square brackets", () => {
      const buffer = createBuffer("array[index]");
      const result = deleteInnerBracket(buffer, 0, 7);

      expect(getBufferContent(result.right)).toBe("array[]");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("[hello]");
      deleteInnerBracket(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("delete-inner-angle (di<)", () => {
    test("should delete inside angle brackets", () => {
      const buffer = createBuffer("vector<item>");
      const result = deleteInnerAngle(buffer, 0, 8);

      expect(getBufferContent(result.right)).toBe("vector<>");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("<hello>");
      deleteInnerAngle(buffer, 0, 2);

      expect(getDeleteRegister()).toBe("hello");
    });
  });

  describe("delete-inner-tag (dit)", () => {
    test("should delete inside HTML/XML tag", () => {
      const buffer = createBuffer("<div>content</div>");
      const result = deleteInnerTag(buffer, 0, 6);

      expect(getBufferContent(result.right)).toBe("<div></div>");
    });

    test("should handle nested tags", () => {
      const buffer = createBuffer("<outer><inner>text</inner></outer>");
      const result = deleteInnerTag(buffer, 0, 15);

      expect(getBufferContent(result.right)).toBe("<outer><inner></inner></outer>");
    });

    test("should handle self-closing tags", () => {
      const buffer = createBuffer("<img src='test.jpg' />");
      const result = deleteInnerTag(buffer, 0, 6);

      expect(getBufferContent(result.right)).toBe("<img src='test.jpg' />");
    });

    test("should store deleted text in register", () => {
      const buffer = createBuffer("<div>content</div>");
      deleteInnerTag(buffer, 0, 6);

      expect(getDeleteRegister()).toBe("content");
    });
  });

  describe("Edge cases", () => {
    test("should handle empty buffer", () => {
      const buffer = createBuffer("");
      const result = deleteInnerWord(buffer, 0, 0);

      expect(Either.isLeft(result)).toBe(true);
    });

    test("should handle cursor on whitespace for inner word", () => {
      const buffer = createBuffer("word1   word2");
      const result = deleteInnerWord(buffer, 0, 5);

      // Cursor on whitespace finds next word
      expect(getBufferContent(result.right)).toBe("word1   ");
    });

    test("should handle multiple spaces for around word", () => {
      const buffer = createBuffer("word1    word2");
      const result = deleteAroundWord(buffer, 0, 3);

      expect(getBufferContent(result.right)).toBe("word2");
    });

    test("should handle unmatched quotes", () => {
      const buffer = createBuffer("say 'hello world");
      const result = changeInnerSingleQuote(buffer, 0, 6);

      expect(Either.isLeft(result)).toBe(true);
    });

    test("should handle unmatched parentheses", () => {
      const buffer = createBuffer("(hello");
      const result = deleteInnerParen(buffer, 0, 2);

      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
