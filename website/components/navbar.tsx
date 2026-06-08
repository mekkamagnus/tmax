"use client";

import { useState, useEffect } from "react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-bg/80 backdrop-blur-xl border-b border-white/5" : ""
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="font-mono font-semibold text-lg text-accent">
          tmax
        </a>
        <div className="flex items-center gap-8">
          <a
            href="#features"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Features
          </a>
          <a
            href="/docs"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Docs
          </a>
          <a
            href="https://github.com/mekkamagnus/tmax"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            GitHub
          </a>
          <a
            href="#install"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Install
          </a>
        </div>
      </div>
    </nav>
  );
}
