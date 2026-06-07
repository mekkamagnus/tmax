"use client";

import { motion } from "framer-motion";

const codeExample = `;; ~/.config/tmax/init.tlisp
;; Custom key binding
(key-bind "C-x C-s" '(quick-save) "normal")

;; Define a custom command
(defun word-count ()
  "Count words in the current buffer."
  (let ((text (buffer-text)))
    (length (split-string text " "))))

;; Macro for quick save-and-quit
(defmacro save-and-quit ()
  '(progn
     (quick-save)
     (editor-quit)))

;; Register as an M-x command
(register-command 'word-count "word-count")`;

export default function TlispShowcase() {
  const highlightLine = (line: string) => {
    if (line.startsWith(";;"))
      return <span className="tlisp-comment">{line}</span>;
    if (line.startsWith("(key-bind"))
      return (
        <>
          <span className="tlisp-paren">(</span>
          <span className="tlisp-fn">key-bind</span>
          <span className="tlisp-string"> "C-x C-s"</span>
          <span className="text-zinc-300"> </span>
          <span className="tlisp-paren">'(</span>
          <span className="tlisp-fn">quick-save</span>
          <span className="tlisp-paren">)</span>
          <span className="tlisp-string"> "normal"</span>
          <span className="tlisp-paren">)</span>
        </>
      );
    if (line.startsWith("(defun"))
      return (
        <>
          <span className="tlisp-paren">(</span>
          <span className="tlisp-keyword">defun</span>
          <span className="tlisp-accent"> word-count</span>
          <span className="tlisp-paren"> ()</span>
        </>
      );
    if (line.includes('"Count words'))
      return (
        <span className="tlisp-string">  "Count words in the current buffer."</span>
      );
    if (line.startsWith("(let"))
      return (
        <>
          <span className="tlisp-paren">    (</span>
          <span className="tlisp-keyword">let</span>
          <span className="tlisp-paren"> ((</span>
          <span className="text-zinc-300">text </span>
          <span className="tlisp-paren">(</span>
          <span className="tlisp-fn">buffer-text</span>
          <span className="tlisp-paren">)))</span>
        </>
      );
    if (line.includes("length"))
      return (
        <>
          <span className="tlisp-paren">      (</span>
          <span className="tlisp-fn">length</span>
          <span className="tlisp-paren"> (</span>
          <span className="tlisp-fn">split-string</span>
          <span className="text-zinc-300"> text </span>
          <span className="tlisp-string">" "</span>
          <span className="tlisp-paren">)))</span>
        </>
      );
    if (line.startsWith("(defmacro"))
      return (
        <>
          <span className="tlisp-paren">(</span>
          <span className="tlisp-keyword">defmacro</span>
          <span className="tlisp-accent"> save-and-quit</span>
          <span className="tlisp-paren"> ()</span>
        </>
      );
    if (line.includes("'(progn"))
      return (
        <>
          <span className="tlisp-paren">  '(</span>
          <span className="tlisp-keyword">progn</span>
        </>
      );
    if (line.includes("quick-save"))
      return (
        <>
          <span className="tlisp-paren">     (</span>
          <span className="tlisp-fn">quick-save</span>
          <span className="tlisp-paren">)</span>
        </>
      );
    if (line.includes("editor-quit"))
      return (
        <>
          <span className="tlisp-paren">     (</span>
          <span className="tlisp-fn">editor-quit</span>
          <span className="tlisp-paren">)))</span>
        </>
      );
    if (line.startsWith("(register"))
      return (
        <>
          <span className="tlisp-paren">(</span>
          <span className="tlisp-fn">register-command</span>
          <span className="tlisp-paren"> '</span>
          <span className="tlisp-accent">word-count</span>
          <span className="tlisp-string"> "word-count"</span>
          <span className="tlisp-paren">)</span>
        </>
      );
    return <span className="text-zinc-300">{line}</span>;
  };

  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Code */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="terminal-window glow-violet">
              <div className="terminal-titlebar">
                <div className="terminal-dot bg-red-500/80" />
                <div className="terminal-dot bg-yellow-500/80" />
                <div className="terminal-dot bg-green-500/80" />
                <span className="text-xs text-zinc-500 ml-2 font-mono">
                  init.tlisp
                </span>
              </div>
              <div className="terminal-body">
                {codeExample.split("\n").map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-8 text-right mr-4 text-zinc-600 select-none">
                      {i + 1}
                    </span>
                    {highlightLine(line)}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Description */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Your editor,{" "}
              <span className="text-violet">your language</span>
            </h2>
            <p className="text-zinc-400 leading-relaxed mb-6">
              T-Lisp is a Lisp-1 dialect with full quasiquote support, tail-call
              optimization, and a macro system. Every editor command — from key
              bindings to modes to the completion stack — is written in T-Lisp.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-accent mt-1">→</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    100+ Editor API Functions
                  </p>
                  <p className="text-sm text-zinc-500">
                    Buffer ops, cursor, modes, files, search, kill ring
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-accent mt-1">→</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Macro System with Quasiquote
                  </p>
                  <p className="text-sm text-zinc-500">
                    `, ,, @, for compile-time metaprogramming
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-accent mt-1">→</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Module System
                  </p>
                  <p className="text-sm text-zinc-500">
                    defmodule, require-module, provide
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
