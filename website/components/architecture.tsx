"use client";

import { motion } from "framer-motion";

export default function Architecture() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          The Emacs Architecture, Reimagined
        </h2>
        <p className="text-zinc-400 mb-16 max-w-lg mx-auto">
          TypeScript does the heavy lifting. T-Lisp does everything else.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6"
        >
          {/* TypeScript Core */}
          <div className="bg-surface border border-cyan-500/20 rounded-2xl p-8 w-64 text-center glow-accent">
            <div className="text-accent font-mono text-sm mb-2">▲</div>
            <h3 className="font-semibold text-lg mb-2">TypeScript Core</h3>
            <div className="space-y-1 text-sm text-zinc-400">
              <p>Terminal I/O</p>
              <p>File System</p>
              <p>Buffer Management</p>
              <p>Viewport / Rendering</p>
              <p>T-Lisp Runtime</p>
            </div>
          </div>

          {/* Arrow */}
          <div className="text-zinc-600 text-2xl md:rotate-0 rotate-90">
            ↔
          </div>

          {/* T-Lisp Engine */}
          <div className="bg-surface border border-violet/20 rounded-2xl p-8 w-64 text-center glow-violet">
            <div className="text-violet font-mono text-sm mb-2">λ</div>
            <h3 className="font-semibold text-lg mb-2">T-Lisp Engine</h3>
            <div className="space-y-1 text-sm text-zinc-400">
              <p>Commands & Modes</p>
              <p>Key Bindings</p>
              <p>Completion Stack</p>
              <p>Operator System</p>
              <p>Plugin Loading</p>
            </div>
          </div>

          {/* Arrow */}
          <div className="text-zinc-600 text-2xl md:rotate-0 rotate-90">
            ↔
          </div>

          {/* User Config */}
          <div className="bg-surface border border-green-500/20 rounded-2xl p-8 w-64 text-center">
            <div className="text-green-400 font-mono text-sm mb-2">~</div>
            <h3 className="font-semibold text-lg mb-2">Your Config</h3>
            <div className="space-y-1 text-sm text-zinc-400">
              <p>init.tlisp</p>
              <p>Custom Functions</p>
              <p>Custom Macros</p>
              <p>Plugin System</p>
              <p>M-x Commands</p>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-3 gap-8 mt-16 max-w-xl mx-auto"
        >
          <div>
            <div className="text-2xl font-bold text-accent">5</div>
            <div className="text-xs text-zinc-500 mt-1">Editing Modes</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-violet">100+</div>
            <div className="text-xs text-zinc-500 mt-1">API Functions</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-400">0</div>
            <div className="text-xs text-zinc-500 mt-1">Dependencies</div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
