"use client";

import { useState } from "react";

export default function Hero() {
  const [copied, setCopied] = useState(false);

  const installCmd = "bun install -g tmax";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      {/* Gradient orbs */}
      <div className="absolute top-20 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-40 right-1/4 w-96 h-96 bg-violet/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-4xl mx-auto text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-zinc-400 mb-8">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          v0.2.0 — Alpha
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
          The Extensible
          <br />
          <span className="text-accent">Terminal Editor</span>
        </h1>

        <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Vim keybindings. Lisp extensibility. Zero dependencies.
          <br />
          Built on Bun. Inspired by Emacs.
        </p>

        <div className="flex flex-col items-center gap-6">
          {/* Install command */}
          <div
            id="install"
            className="flex items-center gap-3 bg-surface border border-white/10 rounded-xl px-6 py-3 cursor-pointer hover:border-accent/30 transition-colors group"
            onClick={copyToClipboard}
          >
            <span className="text-zinc-500 text-sm">$</span>
            <code className="font-mono text-sm text-zinc-200">
              {installCmd}
            </code>
            <button className="text-zinc-500 group-hover:text-accent transition-colors ml-4 text-xs">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Quick links */}
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <a
              href="https://github.com/mekkamagnus/tmax"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              View on GitHub →
            </a>
            <span className="text-zinc-700">|</span>
            <a
              href="#terminal-demo"
              className="hover:text-accent transition-colors"
            >
              See it in action ↓
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
