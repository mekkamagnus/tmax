"use client";

import { useEffect, useRef, useState } from "react";

const TERMINAL_LINES = [
  { text: "$ tmax editor.ts", delay: 0, type: "command" as const },
  {
    text: "",
    delay: 800,
    type: "separator" as const,
    content: [
      "  1 │ /**",
      "  2 │  * editor.ts — tmax core editor module",
      "  3 │  */",
      "  4 │ import { Buffer } from './buffer'",
      "  5 │ import { Terminal } from './terminal'",
      "  6 │ ",
      "  7 │ export class Editor {",
      "  8 │   private buffers: Buffer[]",
      "  9 │   private active: number = 0",
      " 10 │ ",
      " 11 │   constructor() {",
      " 12 │     this.buffers = [Buffer.empty()]",
      " 13 │   }",
      " 14 │ }",
    ],
  },
  {
    text: "  NORMAL  editor.ts                    L1 C1    utf-8",
    delay: 3000,
    type: "statusline" as const,
  },
  { text: "", delay: 3500, type: "gap" as const },
  { text: ":", delay: 3800, type: "command" as const },
  { text: "eval (+ 1 2)", delay: 4000, type: "typing" as const },
  { text: "=> 3", delay: 5000, type: "result" as const },
  { text: "", delay: 5500, type: "gap" as const },
  {
    text: "  INSERT  editor.ts                    L4 C28   utf-8",
    delay: 5800,
    type: "statusline" as const,
  },
];

export default function TerminalDemo() {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [fileContent, setFileContent] = useState(false);
  const [typingText, setTypingText] = useState("");
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  const startAnimation = () => {
    const timeline: Array<{ time: number; action: () => void }> = [];

    // Show command
    timeline.push({ time: 0, action: () => setVisibleLines(1) });

    // Show file content
    timeline.push({ time: 800, action: () => setFileContent(true) });

    // Show status line
    timeline.push({ time: 3000, action: () => setVisibleLines(2) });

    // Show eval command
    timeline.push({ time: 3800, action: () => setVisibleLines(3) });

    // Typing effect for eval
    const evalText = "eval (+ 1 2)";
    evalText.split("").forEach((char, i) => {
      timeline.push({
        time: 4000 + i * 80,
        action: () => setTypingText((prev) => prev + char),
      });
    });

    // Show result
    timeline.push({ time: 5000, action: () => setVisibleLines(4) });

    // Show insert mode status
    timeline.push({ time: 5800, action: () => setVisibleLines(5) });

    timeline.forEach(({ time, action }) => {
      setTimeout(action, time);
    });
  };

  return (
    <section id="terminal-demo" ref={sectionRef} className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
          See it in action
        </h2>
        <p className="text-zinc-400 text-center mb-12 max-w-lg mx-auto">
          tmax combines the speed of vim with the extensibility of Emacs, all in
          your terminal.
        </p>

        <div className="terminal-window glow-accent">
          <div className="terminal-titlebar">
            <div className="terminal-dot bg-red-500/80" />
            <div className="terminal-dot bg-yellow-500/80" />
            <div className="terminal-dot bg-green-500/80" />
            <span className="text-xs text-zinc-500 ml-2 font-mono">
              tmax — editor.ts
            </span>
          </div>

          <div className="terminal-body min-h-[400px]">
            {/* Command */}
            {visibleLines >= 1 && (
              <div className="text-green-400 mb-4">
                <span className="text-zinc-500">$ </span>
                tmax editor.ts
              </div>
            )}

            {/* File content */}
            {fileContent && (
              <div className="mb-4 space-y-0 animate-fade-in-up">
                {TERMINAL_LINES[1].content!.map((line, i) => (
                  <div key={i} className="flex">
                    <span
                      className={`w-12 text-right mr-4 select-none ${
                        i === 0
                          ? "text-violet"
                          : "text-zinc-600"
                      }`}
                    >
                      {line.split("│")[0]?.trim() || ""}
                    </span>
                    <span className="text-zinc-600 mr-3">│</span>
                    <span
                      className={
                        line.includes("import")
                          ? "text-red-400"
                          : line.includes("class")
                          ? "text-yellow-400"
                          : line.includes("constructor")
                          ? "text-yellow-400"
                          : line.includes("this.")
                          ? "text-blue-400"
                          : line.includes("private")
                          ? "text-violet"
                          : line.includes("export")
                          ? "text-green-400"
                          : line.includes("/**") || line.includes("*/") || line.includes("*")
                          ? "tlisp-comment"
                          : "text-zinc-300"
                      }
                    >
                      {line.split("│")[1] || ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Status line - normal mode */}
            {visibleLines >= 2 && (
              <div className="bg-accent/20 text-accent px-4 py-1.5 rounded text-xs font-mono -mx-5 mb-4 animate-fade-in-up">
                {TERMINAL_LINES[2].text}
              </div>
            )}

            {/* Eval command */}
            {visibleLines >= 3 && (
              <div className="mb-2 animate-fade-in-up">
                <span className="text-accent">: </span>
                <span className="text-zinc-200">{typingText}</span>
                <span className="cursor-blink text-accent">▎</span>
              </div>
            )}

            {/* Eval result */}
            {visibleLines >= 4 && (
              <div className="text-green-400 mb-4 animate-fade-in-up">
                <span className="text-zinc-500">=&gt; </span>
                3
              </div>
            )}

            {/* Status line - insert mode */}
            {visibleLines >= 5 && (
              <div className="bg-green-500/20 text-green-400 px-4 py-1.5 rounded text-xs font-mono -mx-5 animate-fade-in-up">
                {TERMINAL_LINES[6].text}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
